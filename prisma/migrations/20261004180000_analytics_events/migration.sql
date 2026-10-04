-- First-party product analytics (events, identity, keystrokes, writing sessions).

CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anonymousId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "sessionId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'desktop',
    "viewportW" INTEGER NOT NULL DEFAULT 0,
    "viewportH" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL DEFAULT '/',
    "appVersion" TEXT NOT NULL DEFAULT '',
    "utmSource" TEXT NOT NULL DEFAULT '',
    "utmMedium" TEXT NOT NULL DEFAULT '',
    "utmCampaign" TEXT NOT NULL DEFAULT '',
    "utmContent" TEXT NOT NULL DEFAULT '',
    "ref" TEXT NOT NULL DEFAULT '',
    "referrerHost" TEXT NOT NULL DEFAULT '',
    "props" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_name_ts_idx" ON "AnalyticsEvent"("name", "ts");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_ts_idx" ON "AnalyticsEvent"("ts");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_anonymousId_ts_idx" ON "AnalyticsEvent"("anonymousId", "ts");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_userId_ts_idx" ON "AnalyticsEvent"("userId", "ts");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_sessionId_idx" ON "AnalyticsEvent"("sessionId");

CREATE TABLE IF NOT EXISTS "AnalyticsIdentity" (
    "anonymousId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "utmSource" TEXT NOT NULL DEFAULT '',
    "utmMedium" TEXT NOT NULL DEFAULT '',
    "utmCampaign" TEXT NOT NULL DEFAULT '',
    "utmContent" TEXT NOT NULL DEFAULT '',
    "ref" TEXT NOT NULL DEFAULT '',
    "referrerHost" TEXT NOT NULL DEFAULT '',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsIdentity_pkey" PRIMARY KEY ("anonymousId")
);

CREATE INDEX IF NOT EXISTS "AnalyticsIdentity_userId_idx" ON "AnalyticsIdentity"("userId");

CREATE TABLE IF NOT EXISTS "AnalyticsKeystrokeChunk" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "packed" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsKeystrokeChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnalyticsKeystrokeChunk_sessionId_chunkIndex_idx"
  ON "AnalyticsKeystrokeChunk"("sessionId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "AnalyticsKeystrokeChunk_createdAt_idx"
  ON "AnalyticsKeystrokeChunk"("createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsKeystrokeChunk_anonymousId_idx"
  ON "AnalyticsKeystrokeChunk"("anonymousId");

CREATE TABLE IF NOT EXISTS "AnalyticsWritingSession" (
    "sessionId" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "keyCount" INTEGER NOT NULL DEFAULT 0,
    "keysPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activeTypingMs" INTEGER NOT NULL DEFAULT 0,
    "pausesOver2s" INTEGER NOT NULL DEFAULT 0,
    "pausesOver10s" INTEGER NOT NULL DEFAULT 0,
    "burstCount" INTEGER NOT NULL DEFAULT 0,
    "avgBurstLength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "backspaceDeleteRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pasteCount" INTEGER NOT NULL DEFAULT 0,
    "cutCount" INTEGER NOT NULL DEFAULT 0,
    "timeToFirstWordMs" INTEGER,
    "timeFirstWordToDoneMs" INTEGER,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "rolledUpAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsWritingSession_pkey" PRIMARY KEY ("sessionId")
);

CREATE INDEX IF NOT EXISTS "AnalyticsWritingSession_userId_idx" ON "AnalyticsWritingSession"("userId");
CREATE INDEX IF NOT EXISTS "AnalyticsWritingSession_startedAt_idx" ON "AnalyticsWritingSession"("startedAt");
CREATE INDEX IF NOT EXISTS "AnalyticsWritingSession_anonymousId_idx" ON "AnalyticsWritingSession"("anonymousId");
