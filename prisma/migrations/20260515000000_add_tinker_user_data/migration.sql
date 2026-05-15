-- Slice mirror of the canonical migration in beginner/api/prisma. Uses
-- IF NOT EXISTS so a shared DATABASE_URL (where the canonical migration
-- has already created the same table) stays idempotent.

CREATE TABLE IF NOT EXISTS "TinkerUserData" (
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT 'null',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TinkerUserData_pkey" PRIMARY KEY ("userId", "kind")
);

CREATE INDEX IF NOT EXISTS "TinkerUserData_userId_idx" ON "TinkerUserData"("userId");
