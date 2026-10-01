-- Origin marks Tinker auto-drafts from This is everything answers.
-- Empty/unknown means hand-edited (Clair/owner); regeneration must leave those alone.
ALTER TABLE "LeadDraft" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT '';
