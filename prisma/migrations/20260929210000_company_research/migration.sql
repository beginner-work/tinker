-- Optional research summary on target companies (beyond short notes).
ALTER TABLE "TargetCompany" ADD COLUMN IF NOT EXISTS "research" TEXT NOT NULL DEFAULT '';
