-- LinkedIn drafts for one user. kind is post or dm. status is
-- draft, approved, scheduled, or posted. scheduledAt is a stored
-- date and time only. IF NOT EXISTS so a shared DATABASE_URL stays
-- idempotent if ensureTable created the table first.

CREATE TABLE IF NOT EXISTS "LinkedInDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedInDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LinkedInDraft_userId_idx" ON "LinkedInDraft"("userId");
