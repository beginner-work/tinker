CREATE TABLE IF NOT EXISTS "OutreachTouch" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "touchType" TEXT NOT NULL, "date" TIMESTAMP(3) NOT NULL, "windowStart" TEXT NOT NULL DEFAULT '', "windowEnd" TEXT NOT NULL DEFAULT '', "leadId" TEXT, "status" TEXT NOT NULL, "draftId" TEXT, "sessionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "OutreachTouch_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "OutreachTouch_userId_idx" ON "OutreachTouch"("userId");
CREATE INDEX IF NOT EXISTS "OutreachTouch_userId_date_idx" ON "OutreachTouch"("userId", "date");
CREATE INDEX IF NOT EXISTS "OutreachTouch_companyId_idx" ON "OutreachTouch"("companyId");
CREATE INDEX IF NOT EXISTS "OutreachTouch_sessionId_idx" ON "OutreachTouch"("sessionId");
CREATE TABLE IF NOT EXISTS "OutreachSession" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL, "title" TEXT NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL, "productArea" TEXT NOT NULL DEFAULT '', "concept" TEXT NOT NULL DEFAULT '', "curriculumRef" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "OutreachSession_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "OutreachSession_userId_idx" ON "OutreachSession"("userId");
CREATE INDEX IF NOT EXISTS "OutreachSession_userId_startsAt_idx" ON "OutreachSession"("userId", "startsAt");
