-- Speech-to-text usage / eval log for POST /api/transcribe.

CREATE TABLE IF NOT EXISTS "TranscriptionRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caller" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "mimeType" TEXT NOT NULL DEFAULT '',
    "byteLength" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL DEFAULT '',
    "words" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT NOT NULL DEFAULT '',
    "elevenLabsRequestId" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TranscriptionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TranscriptionRequest_createdAt_idx" ON "TranscriptionRequest"("createdAt");
CREATE INDEX IF NOT EXISTS "TranscriptionRequest_caller_createdAt_idx" ON "TranscriptionRequest"("caller", "createdAt");
CREATE INDEX IF NOT EXISTS "TranscriptionRequest_status_createdAt_idx" ON "TranscriptionRequest"("status", "createdAt");
