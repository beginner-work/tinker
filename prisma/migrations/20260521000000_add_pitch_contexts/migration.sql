-- Shared cache of distilled investor / venture-partner contexts. Keyed
-- by a normalized form of the name the founder typed (lowercase, trim,
-- collapse whitespace, strip punctuation). One row per target, reused
-- across all paid users. Entries expire after 30 days at the
-- application layer.
--
-- sourceContext is internal-only — it's never shown verbatim to the
-- founder, only used as classifier context. The 8000-char cap is
-- enforced at the API layer (Postgres TEXT has no fixed limit).

CREATE TABLE IF NOT EXISTS "pitch_contexts" (
    "id"              BIGSERIAL PRIMARY KEY,
    "normalizedName"  TEXT NOT NULL,
    "rawName"         TEXT NOT NULL,
    "canonicalName"   TEXT NOT NULL,
    "sourceUrl"       TEXT,
    "sourceContext"   TEXT NOT NULL DEFAULT '',
    "fetchedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "pitch_contexts_normalizedName_key" ON "pitch_contexts"("normalizedName");
CREATE INDEX IF NOT EXISTS "pitch_contexts_normalizedName_idx" ON "pitch_contexts"("normalizedName");
