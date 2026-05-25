# Privacy strategy: essays and pitches

## Goal

Make essay and pitch content unreadable to two parties:

1. **The operator** (you, the person with database access) — should not be
   able to read other users' essays or pitches via a casual `SELECT`.
2. **Third parties** (Anthropic, anyone else the system talks to) — should
   not receive essay or pitch content in a form that lets them reconstruct
   any user's ideas.

This is about removing the ability to read other people's ideas, not just
removing names and emails. Identifier-level PII (the second phase) is
deliberately deferred until after the structural decisions below land.

## Decisions

### 1. Storage: operator-escrow encryption

Essays, drafts, and unpublished pitches stored in `TinkerUserData` are
encrypted at rest with a per-user data-encryption key (DEK).

- The DEK is wrapped two ways:
  - Once with a key derived from the user's authenticated session, so the
    user's own device can decrypt their content.
  - Once with a recovery key held by the operator in a separate vault
    (e.g. AWS KMS, GCP KMS, or equivalent).
- Day-to-day, `SELECT data FROM TinkerUserData` returns ciphertext.
- Emergency recovery (user lost device, etc.) is possible through a
  deliberate operator ceremony that unwraps the DEK via the escrowed key.
- The escrow ceremony is not a casual operation — it leaves an audit
  trail and is not part of any normal workflow.

This is **not** pure operator-blind storage. The tradeoff is deliberate:
pure operator-blind would force users to manage their own recovery
passphrases and risk losing essays on a phone swap, which is the worst
possible failure for a product built around capturing in-progress ideas.

Out of scope for v1: published pitches stay plaintext, because they're
public by design.

### 2. Embeddings: generated on device, stored as plaintext server-side

Plaintext essay text never leaves the user's device. A local embedding
model (browser ONNX or equivalent for Electron) converts essay text to a
vector. The vector is uploaded to the server alongside the encrypted
essay blob.

- Vectors are stored as plaintext server-side.
- Similarity / clustering computations run server-side over the vector
  store.
- **Known limitation:** embedding-inversion attacks can recover partial
  semantic content from vectors. This leaks roughly the topic and rough
  shape of an essay, but not the verbatim text. Operating on plaintext
  vectors is therefore weaker than operator-escrow on essays — but
  recovering content from vectors requires deliberate cryptographic-ML
  work, not a casual `SELECT`, so the practical privacy posture is
  consistent with the storage layer.

### 3. AI endpoints: third-party-blind

All four endpoints that currently send essay/pitch content to Claude are
rebuilt to not send content to any third party:

| Endpoint | Current | New |
|---|---|---|
| `/api/classify` | Sends full essay to Claude, gets `{deckHeading, phrase}` | Local embedding → nearest deck-heading vector (precomputed from exemplars). Phrase = highest-similarity sentence selected locally. |
| `/api/pitches/organize` | Sends all user's essays + drafts + existing pitch titles to Claude | Local embeddings → HDBSCAN clustering (server-side over the vector store). Cluster names from top TF-IDF terms locally. |
| `/api/feed/adjacent` | Sends requester's pitch + all opted-in pitches to Claude | Server-side cosine similarity over the published-pitch vector store. No LLM. One-line summary becomes the pitch's own subtitle, not a Claude extract. |
| `/api/post-on-social` | Sends full essay to Claude for platform-fit scoring | Local rules or small classifier for platform-fit scoring. |

Claude remains available for:
- Tasks where the user is actively co-authoring (they typed it, they're
  in the loop, they consented in the moment).
- Non-content tasks: generating the deck-heading taxonomy itself,
  generating UI copy, schema work, etc.

### 4. Logging hygiene

`/home/user/tinker/api/_lib/log.js` currently logs full JSON response
bodies in Vercel preview deploys, capped at 8 KB. Strip this for any
endpoint that touches essay or pitch text. Either:

- Remove the wrapper from those endpoints, or
- Update the wrapper to log only metadata (method, URL, status, latency)
  for response bodies that match content-bearing routes.

### 5. Public reader URL hygiene

`/api/publish/read?u=<userId>&t=<slug>` (beginner repo) embeds the
auth-provider `userId` in the URL. This dox's the author across multiple
pitches and across other parts of the system that key on `userId`.

Replace with an opaque per-pitch token:

- At publish time, generate a random token (e.g. 128-bit base32).
- Store a token-to-(userId, slug) mapping server-side.
- Public reader URL becomes `/api/publish/read?p=<token>`.
- Old URLs continue to work for a deprecation window, then 404.

## Architecture summary

```
┌─────────────────────────────────────────────────────────────────┐
│  Device (browser / Electron)                                     │
│                                                                  │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │ Plaintext    │───▶│ Local embedding  │───▶│ Encrypt blob  │  │
│  │ essay text   │    │ model (ONNX)     │    │ with user DEK │  │
│  └──────────────┘    └──────────────────┘    └───────┬───────┘  │
│                              │                       │          │
│                              ▼                       ▼          │
│                      ┌──────────────┐        ┌──────────────┐   │
│                      │ Vector       │        │ Ciphertext   │   │
│                      └──────┬───────┘        └──────┬───────┘   │
└─────────────────────────────┼───────────────────────┼───────────┘
                              │                       │
                              ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Server                                                          │
│                                                                  │
│  ┌──────────────┐                          ┌──────────────────┐ │
│  │ Vector store │                          │ TinkerUserData   │ │
│  │ (plaintext)  │                          │ (ciphertext)     │ │
│  └──────┬───────┘                          └──────────────────┘ │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────┐    ┌────────────────┐ │
│  │ Server-side similarity / clustering   │    │ KMS escrow key │ │
│  │ (cosine, HDBSCAN, etc.)               │    │ (recovery only)│ │
│  └──────────────────────────────────────┘    └────────────────┘ │
│                                                                  │
│  Claude API: not on any of these paths.                          │
└─────────────────────────────────────────────────────────────────┘
```

## Open questions

- **Embedding model choice.** Candidates: `all-MiniLM-L6-v2` (~25 MB,
  good general baseline), `bge-small-en-v1.5` (~33 MB, stronger on
  retrieval), or a smaller distilled model if device size matters more
  than quality. Pick during the embedding-implementation slice.
- **Vector store.** Postgres `pgvector` is the obvious choice given the
  existing Prisma setup. Confirm before building.
- **DEK rotation policy.** How often DEKs rotate, and what triggers
  rotation. Deferred to implementation.
- **Identifier-level PII.** Person names, org names, locations embedded
  inside essay text. Deliberately deferred — the structural decisions
  above are the higher-impact move. Revisit after they land.

## Affected files (inventory)

Storage:
- `prisma/schema.prisma` (both repos) — `TinkerUserData.data` becomes
  ciphertext; add columns for DEK envelope, vector, version.
- `api/user-data/essays.js`, `api/user-data/drafts.js`,
  `api/user-data/pitches.js` (tinker) — encrypt/decrypt boundary.

AI endpoints to rebuild:
- `api/classify/index.js` (tinker)
- `api/pitches/organize.js` (tinker)
- `api/feed/adjacent.js` (tinker)
- `api/post-on-social/index.js` (tinker)

Logging:
- `api/_lib/log.js` (tinker)

Public URL:
- `api/publish/pitch.js` (tinker) — generate opaque token at publish.
- `ui/api/publish/read.js` (beginner) — accept token, lookup userId/slug.

Client embedding:
- New: client-side embedding module (browser + Electron).
- New: upload-vector path alongside existing user-data PUTs.

## What this strategy does NOT do

- Does not prevent the user (operator) from reading essays through the
  recovery ceremony. Operator-blind would prevent this; we chose
  operator-escrow instead.
- Does not redact identifying entities (names, places, employers) from
  essay text. That's the deferred phase.
- Does not encrypt published pitches. They're public by design.
- Does not stop Anthropic from seeing prompts on the Claude endpoints
  that remain (user-active editing, taxonomy generation). Those are
  consented and don't contain other users' content.
