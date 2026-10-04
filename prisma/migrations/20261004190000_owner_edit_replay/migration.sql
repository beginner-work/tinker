-- Owner how-i-write: context tags + surface/prompt attribution events.

ALTER TABLE "AnalyticsWritingSession" ADD COLUMN IF NOT EXISTS "contextTag" TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "AnalyticsWritingSession_userId_contextTag_idx"
  ON "AnalyticsWritingSession"("userId", "contextTag");

CREATE TABLE IF NOT EXISTS "AnalyticsOwnerEditChunk" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "ops" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsOwnerEditChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnalyticsOwnerEditChunk_sessionId_chunkIndex_idx"
  ON "AnalyticsOwnerEditChunk"("sessionId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "AnalyticsOwnerEditChunk_userId_startedAt_idx"
  ON "AnalyticsOwnerEditChunk"("userId", "startedAt");

CREATE TABLE IF NOT EXISTS "AnalyticsSurfaceEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL DEFAULT '',
    "promptId" TEXT NOT NULL DEFAULT '',
    "variantId" TEXT NOT NULL DEFAULT '',
    "position" TEXT NOT NULL DEFAULT '',
    "ts" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "props" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AnalyticsSurfaceEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnalyticsSurfaceEvent_sessionId_ts_idx" ON "AnalyticsSurfaceEvent"("sessionId", "ts");
CREATE INDEX IF NOT EXISTS "AnalyticsSurfaceEvent_userId_ts_idx" ON "AnalyticsSurfaceEvent"("userId", "ts");
CREATE INDEX IF NOT EXISTS "AnalyticsSurfaceEvent_name_ts_idx" ON "AnalyticsSurfaceEvent"("name", "ts");
CREATE INDEX IF NOT EXISTS "AnalyticsSurfaceEvent_promptId_variantId_idx" ON "AnalyticsSurfaceEvent"("promptId", "variantId");
CREATE INDEX IF NOT EXISTS "AnalyticsSurfaceEvent_surfaceId_idx" ON "AnalyticsSurfaceEvent"("surfaceId");
