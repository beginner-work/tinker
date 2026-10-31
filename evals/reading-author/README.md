# Reading author attribution evals

Deterministic fixtures for Tyler's rule: **every source text must have an
attributed author**, extracted from page metadata only — never invented by
the model.

## Extraction order

1. schema.org / JSON-LD `author`
2. `meta name=author`
3. `article:author` / `og:article:author`
4. byline / `rel=author`
5. site organization name (JSON-LD Organization / publisher / `og:site_name`)

If none apply → `authorUnknown: true`, display **"Author unknown"**, and
log `reading_author_unknown`. Search prefers another hit that has an author.

## Cases

JSON files under `dataset/` each declare:

| Field | Meaning |
| --- | --- |
| `id` | Stable case id |
| `html` | Fixture HTML (or `htmlFixture` path under `fixtures/`) |
| `expect.author` | Exact author string (empty when unknown) |
| `expect.authorSource` | `jsonld` \| `meta_author` \| `article_author` \| `rel_author` \| `byline` \| `organization` \| `none` |
| `expect.authorUnknown` | boolean |
| `expect.siteName` | optional |

Run via unit tests: `node --test tests/reading-author-eval.test.js`.
