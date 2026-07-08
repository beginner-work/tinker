# Founder coins — crypto staking on tinker

Every founder on tinker has a **founder coin**. Any signed-in member can
stake part of their staking balance against another founder's coin —
"I'm backing this person" as a position, not a like — and release the
stake back to their balance at any time. It's the money-shaped
counterpart to the founders surface: adjacency finds the founders near
you, staking lets you put weight behind one.

## Phase A — internal ledger (this is what ships now)

Phase A proves the mechanics end-to-end with **no real money and
nothing on-chain**. Every member's wallet is seeded once with **100.00
practice USDC** (`SEED_CENTS` in `api/_lib/stakes.js`), the panel says
so in plain words, and all movement is rows in the shared
`TinkerUserData` table:

| Row | Shape |
|-----|-------|
| `(userId, "stake:wallet")` | `{ balanceCents, currency, seededAt, stakes: [{ id, founderId, amountCents, at }] }` |
| `(founderId, "stake:coin")` | `{ symbol, totalStakedCents, backers: { [stakerId]: cents } }` |

Amounts are **integer cents of USDC** everywhere on the server; only
the panel formats decimals. Coin symbols derive from the founder's
profile name ("Tyler Lindow" → `TYLE`), falling back to a tail of the
user id.

Endpoints (Stytch bearer auth, same as every user-data endpoint):

- `GET  /api/stakes/wallet` — the caller's balance + active stakes
  (first touch seeds the practice balance)
- `GET  /api/stakes/coin?founder=<userId|me>` — coin stats + the
  caller's own position; individual backer identities never leave the
  server
- `POST /api/stakes/place` `{ founderId, amountCents }` — stake
- `POST /api/stakes/release` `{ stakeId }` — unstake

The client is `src/renderer/stakes.js` ("Founder coins" in the profile
menu). The "who can I back" list reuses `/api/feed/adjacent`, so the
same opt-in and no-engagement-ranking rules of the founders surface
apply — you back founders adjacent to you, not a leaderboard.

### Known Phase A limits

- **Row races.** Both sides of a stake move inside one interactive
  Prisma transaction, but the rows themselves are whole-blob JSON
  (read-modify-write), like every user-data kind. Two simultaneous
  stakes on one founder can clobber each other's coin update. Fine at
  current volume; Phase B moves the ledger to append-only entries.
- **No history.** Releasing a stake leaves no trace. Phase B's
  append-only ledger fixes this too.
- **Practice money only.** By design — see below.

## Phase B — real USDC, settled on Base (specified, not built)

The API shapes above are the contract; Phase B swaps the settlement
layer underneath them:

1. **Deposits** — Stripe checkout (crypto onramp or card→USDC) tops up
   `balanceCents` for real; withdrawal pays out to a founder-linked
   wallet address.
2. **Settlement** — stakes anchor on **Base** as USDC positions in a
   minimal staking contract (per-founder pools keyed by a hash of the
   founder's user id; stake/release mirror the two endpoints 1:1).
   The internal ledger stays the read model; the chain is the source
   of truth for balances.
3. **Ledger hardening** — append-only entry table (D1 once the
   Cloudflare migration lands — the mcp repo is the intended backend
   monolith for exactly this kind of credentialed state).

### Regulatory flags — read before building Phase B

Phase A deliberately avoids all of this by never touching real value.
Phase B must not start until these have real answers:

- **Money transmission.** Holding members' USD/USDC and moving it
  between users on their instruction is money transmission in most US
  states (state MTLs, FinCEN MSB registration) unless a licensed
  partner (e.g. Stripe, a custodial provider) holds the funds.
- **Securities.** A "founder coin" whose value implies a claim on a
  founder's future success walks straight into Howey territory.
  Phase B keeps coins as **non-transferable backing tallies** (no
  secondary market, no profit share, releases return exactly what was
  staked) precisely to stay on the safe side of that line. Changing
  any of those three properties needs counsel first.
- **Custody.** If tinker ever holds keys for member wallets, that's
  custody; prefer member-held wallets (or an MPC provider) from day
  one.
