-- Reading agent sessions, interrupt questions, and outbound click logs.
-- Article body text is never stored; sourceUrl is the durable pointer.

CREATE TABLE IF NOT EXISTS "ReadingSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "caller" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourceUrl" TEXT NOT NULL,
    "requestedUrl" TEXT NOT NULL DEFAULT '',
    "companyHost" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL DEFAULT '',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "links" JSONB NOT NULL DEFAULT '[]',
    "resumeWordIndex" INTEGER NOT NULL DEFAULT 0,
    "voiceId" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ReadingSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReadingSession_createdAt_idx" ON "ReadingSession"("createdAt");
CREATE INDEX IF NOT EXISTS "ReadingSession_caller_createdAt_idx" ON "ReadingSession"("caller", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingSession_companyHost_createdAt_idx" ON "ReadingSession"("companyHost", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingSession_sourceUrl_createdAt_idx" ON "ReadingSession"("sourceUrl", "createdAt");

CREATE TABLE IF NOT EXISTS "ReadingQuestion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "caller" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "inputType" TEXT NOT NULL DEFAULT '',
    "question" TEXT NOT NULL DEFAULT '',
    "rawTranscript" TEXT NOT NULL DEFAULT '',
    "answerText" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "voiceId" TEXT NOT NULL DEFAULT '',
    "hasAudio" BOOLEAN NOT NULL DEFAULT false,
    "fetchedSource" BOOLEAN NOT NULL DEFAULT false,
    "fetchedSourceUrl" TEXT NOT NULL DEFAULT '',
    "resumeWordIndex" INTEGER NOT NULL DEFAULT 0,
    "position" JSONB,
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "companyHost" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ReadingQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReadingQuestion_createdAt_idx" ON "ReadingQuestion"("createdAt");
CREATE INDEX IF NOT EXISTS "ReadingQuestion_sessionId_createdAt_idx" ON "ReadingQuestion"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingQuestion_companyHost_createdAt_idx" ON "ReadingQuestion"("companyHost", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingQuestion_fetchedSource_createdAt_idx" ON "ReadingQuestion"("fetchedSource", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingQuestion_status_createdAt_idx" ON "ReadingQuestion"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "ReadingClick" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL DEFAULT '',
    "caller" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL,
    "href" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "companyHost" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ReadingClick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReadingClick_createdAt_idx" ON "ReadingClick"("createdAt");
CREATE INDEX IF NOT EXISTS "ReadingClick_target_createdAt_idx" ON "ReadingClick"("target", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingClick_sessionId_createdAt_idx" ON "ReadingClick"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingClick_companyHost_createdAt_idx" ON "ReadingClick"("companyHost", "createdAt");
