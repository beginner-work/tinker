-- TYL-49 content items. One row per site slug. status is draft or
-- published. fields is the structured copy. noteId links the note it
-- came from. draftKey is the idempotency key (null until a caller
-- sends one). IF NOT EXISTS so a shared DATABASE_URL stays idempotent
-- if ensureTable created the table first.

CREATE TABLE IF NOT EXISTS "ContentItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "fields" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "noteId" TEXT,
    "draftKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentItem_site_slug_key" ON "ContentItem"("site", "slug");

CREATE UNIQUE INDEX IF NOT EXISTS "ContentItem_userId_draftKey_key" ON "ContentItem"("userId", "draftKey");

CREATE INDEX IF NOT EXISTS "ContentItem_userId_idx" ON "ContentItem"("userId");

CREATE INDEX IF NOT EXISTS "ContentItem_site_status_idx" ON "ContentItem"("site", "status");
