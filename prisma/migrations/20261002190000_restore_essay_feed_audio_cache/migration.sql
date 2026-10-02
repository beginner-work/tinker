-- Recreate the /feed TTS cache table after #422 dropped it.
-- Forward-only: leaves prior create/drop migrations untouched.

CREATE TABLE IF NOT EXISTS "EssayFeedAudioCache" (
    "userId" TEXT NOT NULL,
    "essayId" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "audioBase64" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EssayFeedAudioCache_pkey" PRIMARY KEY ("userId","essayId","voiceId")
);

CREATE INDEX IF NOT EXISTS "EssayFeedAudioCache_userId_idx" ON "EssayFeedAudioCache"("userId");
