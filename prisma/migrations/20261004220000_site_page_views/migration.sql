-- Cookieless page views for lindowlabs.dev (Visitors page).

CREATE TABLE IF NOT EXISTS "SitePageView" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "utmSource" TEXT NOT NULL DEFAULT '',
    "utmCampaign" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'Direct',
    "week" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePageView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SitePageView_week_idx" ON "SitePageView"("week");
CREATE INDEX IF NOT EXISTS "SitePageView_path_idx" ON "SitePageView"("path");
CREATE INDEX IF NOT EXISTS "SitePageView_source_idx" ON "SitePageView"("source");
CREATE INDEX IF NOT EXISTS "SitePageView_createdAt_idx" ON "SitePageView"("createdAt");
