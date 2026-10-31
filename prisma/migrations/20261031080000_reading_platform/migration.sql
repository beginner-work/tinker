-- Platform breakdown for resume metrics (ios / web / android / embed).
ALTER TABLE "ReadingSession" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "ReadingSession_platform_createdAt_idx" ON "ReadingSession"("platform", "createdAt");

ALTER TABLE "ReadingQuestion" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "ReadingQuestion_platform_createdAt_idx" ON "ReadingQuestion"("platform", "createdAt");
