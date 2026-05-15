-- Slice mirror of the canonical migration in beginner/api/prisma. Uses
-- IF NOT EXISTS so a shared DATABASE_URL (where the canonical migration
-- has already created the same table) stays idempotent.

CREATE TABLE IF NOT EXISTS "Receipt" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "maker" TEXT NOT NULL,
    "makerLocation" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "acct" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);
