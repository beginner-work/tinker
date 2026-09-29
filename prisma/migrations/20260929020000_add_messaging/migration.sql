-- TYL-54 messaging. IF NOT EXISTS so ensureTable can create the same
-- tables when migrate deploy has not run. Nothing here sends.

CREATE TABLE IF NOT EXISTS "MessagingContact" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "email" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT '', "company" TEXT NOT NULL DEFAULT '', "title" TEXT NOT NULL DEFAULT '', "source" TEXT NOT NULL, "tags" JSONB NOT NULL DEFAULT '[]', "doNotContact" BOOLEAN NOT NULL DEFAULT false, "notes" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessagingContact_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX IF NOT EXISTS "MessagingContact_userId_email_key" ON "MessagingContact"("userId", "email");
CREATE INDEX IF NOT EXISTS "MessagingContact_userId_idx" ON "MessagingContact"("userId");
CREATE TABLE IF NOT EXISTS "MessagingThread" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "contactId" TEXT NOT NULL, "channel" TEXT NOT NULL, "subject" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL, "lastMessageAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessagingThread_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "MessagingThread_userId_idx" ON "MessagingThread"("userId");
CREATE INDEX IF NOT EXISTS "MessagingThread_contactId_idx" ON "MessagingThread"("contactId");
CREATE TABLE IF NOT EXISTS "MessagingMessage" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "threadId" TEXT NOT NULL, "direction" TEXT NOT NULL, "status" TEXT NOT NULL, "subject" TEXT NOT NULL DEFAULT '', "body" TEXT NOT NULL DEFAULT '', "fromAddr" TEXT NOT NULL DEFAULT '', "toAddr" TEXT NOT NULL DEFAULT '', "cc" JSONB NOT NULL DEFAULT '[]', "scheduledAt" TIMESTAMP(3), "approvedAt" TIMESTAMP(3), "approvedBy" TEXT, "sentAt" TIMESTAMP(3), "providerMessageId" TEXT, "inReplyTo" TEXT, "draftKey" TEXT, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessagingMessage_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX IF NOT EXISTS "MessagingMessage_userId_draftKey_key" ON "MessagingMessage"("userId", "draftKey");
CREATE INDEX IF NOT EXISTS "MessagingMessage_userId_idx" ON "MessagingMessage"("userId");
CREATE INDEX IF NOT EXISTS "MessagingMessage_threadId_idx" ON "MessagingMessage"("threadId");
CREATE TABLE IF NOT EXISTS "MessagingEvent" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "threadId" TEXT, "messageId" TEXT, "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "detail" JSONB NOT NULL DEFAULT '{}', "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessagingEvent_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "MessagingEvent_userId_idx" ON "MessagingEvent"("userId");
CREATE INDEX IF NOT EXISTS "MessagingEvent_threadId_idx" ON "MessagingEvent"("threadId");
