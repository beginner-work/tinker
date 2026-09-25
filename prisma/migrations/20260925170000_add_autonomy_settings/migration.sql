-- Autonomy toggles. The current boolean and Tyler's note live here.
-- Labels, order, and the send note live in api/_lib/autonomy.js.
-- ON CONFLICT leaves a row Tyler already changed alone if this
-- migration is reapplied.

CREATE TABLE IF NOT EXISTS "autonomy_settings" (
    "key" TEXT NOT NULL,
    "autonomous" BOOLEAN NOT NULL,
    "note" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "autonomy_settings_pkey" PRIMARY KEY ("key")
);

INSERT INTO "autonomy_settings" ("key", "autonomous") VALUES
    ('linkedin_profile_edits', true),
    ('linkedin_posts', false),
    ('linkedin_connection_requests', false),
    ('linkedin_messages', false),
    ('outreach_emails', false),
    ('other_public_profiles', false),
    ('site_content_live', false),
    ('code_pr_merges', false),
    ('dns_domain_changes', false),
    ('purchases_subscriptions', false),
    ('calendar_invites_others', false),
    ('family_admin_messages', false),
    ('resume_changes', false),
    ('bot_routines_rules', false)
ON CONFLICT ("key") DO NOTHING;
