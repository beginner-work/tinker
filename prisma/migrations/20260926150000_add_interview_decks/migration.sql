-- Stored ask_followups interviews. transcript is JSON Q&A.
-- interviewKey is the idempotency key for one interview.
-- IF NOT EXISTS so a shared DATABASE_URL stays idempotent if
-- ensureTable created the table first.

CREATE TABLE IF NOT EXISTS "InterviewDeck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interviewKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "transcript" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewDeck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InterviewDeck_userId_interviewKey_key" ON "InterviewDeck"("userId", "interviewKey");

CREATE INDEX IF NOT EXISTS "InterviewDeck_userId_idx" ON "InterviewDeck"("userId");
