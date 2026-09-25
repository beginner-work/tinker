-- Approval toggles. The current boolean lives here. Labels, order,
-- and the send note live in api/_lib/approvals.js. ON CONFLICT leaves
-- a row Tyler already changed alone if this migration is reapplied.

CREATE TABLE IF NOT EXISTS "approval_settings" (
    "key" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "approval_settings_pkey" PRIMARY KEY ("key")
);

INSERT INTO "approval_settings" ("key", "required") VALUES
    ('linkedin_profile_edits', false),
    ('linkedin_posts', true),
    ('linkedin_connection_requests', true),
    ('linkedin_messages', true),
    ('outreach_emails', true),
    ('other_public_profiles', true),
    ('site_content_live', true),
    ('code_pr_merges', true),
    ('dns_domain_changes', true),
    ('purchases_subscriptions', true),
    ('calendar_invites_others', true),
    ('family_admin_messages', true),
    ('resume_changes', true),
    ('bot_routines_rules', true)
ON CONFLICT ("key") DO NOTHING;
