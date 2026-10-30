-- Grounded ask + TTS usage / eval log for POST /api/ask.
-- Audio bytes are never stored; hasAudio records whether TTS succeeded.

CREATE TABLE IF NOT EXISTS "AskRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caller" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "inputType" TEXT NOT NULL DEFAULT '',
    "question" TEXT NOT NULL DEFAULT '',
    "rawTranscript" TEXT NOT NULL DEFAULT '',
    "editedTranscript" TEXT NOT NULL DEFAULT '',
    "position" JSONB,
    "context" TEXT NOT NULL DEFAULT '',
    "answerText" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "voiceId" TEXT NOT NULL DEFAULT '',
    "hasAudio" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AskRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AskRequest_createdAt_idx" ON "AskRequest"("createdAt");
CREATE INDEX IF NOT EXISTS "AskRequest_caller_createdAt_idx" ON "AskRequest"("caller", "createdAt");
CREATE INDEX IF NOT EXISTS "AskRequest_sourceId_createdAt_idx" ON "AskRequest"("sourceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AskRequest_status_createdAt_idx" ON "AskRequest"("status", "createdAt");
