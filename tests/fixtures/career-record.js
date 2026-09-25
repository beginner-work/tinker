/* Fixture career record for check_text.
 *
 * Verified facts are taken from the public resume at lindowlabs.dev/resume.
 * Proposed seeds and verified rules come from the shared catalog.
 * The $250K figure is not in this record. It is a wrong salary answer
 * used only as a claim in the check fixture.
 */

"use strict";

const { SEED_FACTS, SEED_RULES, RESUME } = require("../../src/renderer/career/catalog.js");

const WHEN = "2026-09-25T22:00:00.000Z";

function verified(partial) {
  return {
    status: "verified",
    updated_at: WHEN,
    ...partial,
    source: {
      document: RESUME,
      excerpt: partial.excerpt,
    },
  };
}

const VERIFIED_FACTS = [
  verified({
    id: "fact_team_1_to_9",
    kind: "team_size",
    value: "1 to 9",
    excerpt: "Grew the developer-support engineering function from 1 to 9 engineers",
  }),
  verified({
    id: "fact_team_6",
    kind: "team_size",
    value: "6 software engineers",
    excerpt: "Managed 6 software engineers as direct reports",
  }),
  verified({
    id: "fact_remote_years",
    kind: "dates",
    value: "more than four years remote at Affirm, Jul 2021 - Feb 2026",
    excerpt: "San Diego, CA (Remote) | Jul 2021 \u2013 Mar 2025",
  }),
  verified({
    id: "fact_dates_l7",
    kind: "dates",
    value: "Software Engineering Manager at Affirm, Mar 2025 - Feb 2026",
    excerpt: "Software Engineering Manager (L7), Merchant Advocacy | Mar 2025 \u2013 Feb 2026",
  }),
  verified({
    id: "fact_dates_partner",
    kind: "dates",
    value: "Developer Support Engineering Manager at Affirm, Jul 2021 - Mar 2025",
    excerpt: "Developer Support Engineering Manager (L6 \u2192 L7), Partner Engineering | Jul 2021 \u2013 Mar 2025",
  }),
  verified({
    id: "fact_title_l7",
    kind: "title",
    value: "Software Engineering Manager at Affirm",
    excerpt: "Software Engineering Manager (L7), Merchant Advocacy",
  }),
  verified({
    id: "fact_metric_999_target",
    kind: "metric",
    value: "99.9% availability target",
    excerpt: "Restored monthly attainment of an internal 99.9% availability target",
  }),
  verified({
    id: "fact_metric_16_hours",
    kind: "metric",
    value: "16 hours a month",
    excerpt: "eliminating 16 hours/month of toil",
  }),
  verified({
    id: "fact_metric_detection",
    kind: "metric",
    value: "detection from 2 hours to under 5 minutes",
    excerpt: "cut detection time for higher-volume merchant-scoped outages to under 5 minutes (previously 20 minutes\u20132 hours unnoticed)",
  }),
  verified({
    id: "fact_metric_80",
    kind: "metric",
    value: "about 80% of report and RCA drafting",
    excerpt: "automating ~80% of SLA report generation and RCA drafting",
  }),
  verified({
    id: "fact_metric_amazon_gmv",
    kind: "metric",
    value: "Amazon over $10B in GMV",
    excerpt: "Amazon ($10B+ GMV)",
  }),
  verified({
    id: "fact_metric_100m",
    kind: "metric",
    value: "$100M+ merchant accounts",
    excerpt: "strategic merchant accounts ($100M+ GMV)",
  }),
  verified({
    id: "fact_conversations_92",
    kind: "metric",
    value: "92 in-person conversations",
    excerpt: "Validated demand through 92 in-person conversations",
  }),
  verified({
    id: "fact_degree_nano",
    kind: "degree",
    value: "B.S. NanoEngineering, University of California, San Diego",
    excerpt: "University of California, San Diego | B.S. NanoEngineering, Cum Laude",
  }),
  verified({
    id: "fact_location_sf",
    kind: "location",
    value: "San Francisco, CA",
    excerpt: "San Francisco, CA (Hybrid) | Sep 2019 \u2013 Jul 2021",
  }),
];

function stamp(item) {
  return { ...item, updated_at: item.updated_at || WHEN };
}

const record = {
  facts: VERIFIED_FACTS.concat(SEED_FACTS.map(stamp)),
  rules: SEED_RULES.map(stamp),
};

module.exports = { record, VERIFIED_FACTS, WHEN };
