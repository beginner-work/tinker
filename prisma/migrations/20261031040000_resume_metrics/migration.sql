-- Resume metrics: anonymous first-party ids, owner exclusion, embed hosts,
-- and eval run pass-rate storage. See RESUME_METRICS.md.

ALTER TABLE "ReadingSession" ADD COLUMN IF NOT EXISTS "anonymousId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ReadingSession" ADD COLUMN IF NOT EXISTS "isOwner" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReadingSession" ADD COLUMN IF NOT EXISTS "embedHost" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ReadingSession" ADD COLUMN IF NOT EXISTS "questionCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "ReadingSession_anonymousId_createdAt_idx" ON "ReadingSession"("anonymousId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingSession_isOwner_createdAt_idx" ON "ReadingSession"("isOwner", "createdAt");

ALTER TABLE "ReadingQuestion" ADD COLUMN IF NOT EXISTS "anonymousId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ReadingQuestion" ADD COLUMN IF NOT EXISTS "isOwner" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ReadingQuestion_anonymousId_createdAt_idx" ON "ReadingQuestion"("anonymousId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingQuestion_isOwner_createdAt_idx" ON "ReadingQuestion"("isOwner", "createdAt");

ALTER TABLE "ReadingClick" ADD COLUMN IF NOT EXISTS "anonymousId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ReadingClick" ADD COLUMN IF NOT EXISTS "isOwner" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ReadingClick_isOwner_createdAt_idx" ON "ReadingClick"("isOwner", "createdAt");

CREATE TABLE IF NOT EXISTS "ReadingEmbedHost" (
    "host" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "loadCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReadingEmbedHost_pkey" PRIMARY KEY ("host")
);

CREATE INDEX IF NOT EXISTS "ReadingEmbedHost_lastSeenAt_idx" ON "ReadingEmbedHost"("lastSeenAt");

CREATE TABLE IF NOT EXISTS "EvalRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project" TEXT NOT NULL DEFAULT 'tinker-ask',
    "passRate" DOUBLE PRECISION NOT NULL,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "experimentUrl" TEXT NOT NULL DEFAULT '',
    "report" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EvalRun_createdAt_idx" ON "EvalRun"("createdAt");
CREATE INDEX IF NOT EXISTS "EvalRun_project_createdAt_idx" ON "EvalRun"("project", "createdAt");
