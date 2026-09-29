-- LL-66: Gmail thread id on sent drafts + inbound replies from the assistant.
ALTER TABLE "LeadDraft" ADD COLUMN IF NOT EXISTS "gmailThreadId" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "LeadReply" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "gmailThreadId" TEXT NOT NULL DEFAULT '',
  "gmailMessageId" TEXT NOT NULL DEFAULT '',
  "fromAddress" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeadReply_userId_idx" ON "LeadReply"("userId");
CREATE INDEX IF NOT EXISTS "LeadReply_leadId_idx" ON "LeadReply"("leadId");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadReply_userId_gmailMessageId_key" ON "LeadReply"("userId", "gmailMessageId");
