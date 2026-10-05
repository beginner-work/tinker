/* Fixture career record for check_text.
 *
 * Verified facts are taken from the public resume at lindowlabs.dev/resume
 * (v81). Proposed seeds and verified rules come from the shared catalog.
 * The $250K figure is not in this record. It is a wrong salary answer
 * used only as a claim in the check fixture.
 *
 * Employment entries here are generic test data for date and years
 * checks. They are not a production owner load.
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
    id: "fact_emp_affirm",
    kind: "employment",
    employer: "Affirm",
    title: null,
    start_month: "2019-09",
    end_month: "2026-02",
    current: false,
    experience_kinds: ["software_development"],
    value: "Affirm, Sep 2019 - Feb 2026",
    excerpt: "Affirm | Sep 2019 – Feb 2026",
  }),
  verified({
    id: "fact_emp_beginner",
    kind: "employment",
    employer: "Beginner Work Inc.",
    title: null,
    start_month: "2026-03",
    end_month: "2026-07",
    current: false,
    experience_kinds: ["software_development"],
    value: "Beginner Work Inc., Mar 2026 - Jul 2026",
    excerpt: "Beginner Work Inc. | Mar 2026 – Jul 2026",
  }),
  verified({
    id: "fact_team_1_to_9",
    kind: "team_size",
    value: "1 to 9",
    excerpt: "Managed a team that grew from 1 to 9 engineers (all software engineers by early 2025)",
  }),
  verified({
    id: "fact_team_6",
    kind: "team_size",
    value: "6 software engineers",
    excerpt: "9 software engineers (2 Staff, 2 SWE II, 4 SWE I, 1 contractor), later reshaped to 6",
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
    excerpt: "Software Engineering Manager, Merchant Advocacy | Mar 2025 \u2013 Feb 2026",
  }),
  verified({
    id: "fact_dates_partner",
    kind: "dates",
    value: "Developer Support Engineering Manager at Affirm, Jul 2021 - Mar 2025",
    excerpt: "Developer Support Engineering Manager, Partner Engineering | Jul 2021 \u2013 Mar 2025",
  }),
  verified({
    id: "fact_title_l7",
    kind: "title",
    value: "Software Engineering Manager at Affirm",
    excerpt: "Software Engineering Manager, Merchant Advocacy",
  }),
  verified({
    id: "fact_metric_999_target",
    kind: "metric",
    value: "99.9% availability with zero incidents during BFCM 2025",
    excerpt: "held Merchant Portal at 99.9% availability with zero incidents during BFCM 2025",
  }),
  verified({
    id: "fact_metric_detection",
    kind: "metric",
    value: "cut detection of higher-volume merchant outages from ~1 hour to under 5 minutes",
    excerpt: "Built per-merchant dashboards and alerting that cut detection of higher-volume merchant outages from ~1 hour to under 5 minutes",
  }),
  verified({
    id: "fact_metric_amazon_gmv",
    kind: "metric",
    value: "Amazon 21% of Affirm's GMV in FY2024",
    excerpt: "Amazon, flagship partner (21% of Affirm's GMV in FY2024)",
  }),
  verified({
    id: "fact_metric_sla_70",
    kind: "metric",
    value: "enterprise merchant emails within 15-minute SLA from near zero to ~70%",
    excerpt: "raising the share of enterprise merchant emails sent within the 15-minute SLA from near zero to ~70%",
  }),
  verified({
    id: "fact_conversations_92",
    kind: "metric",
    value: "92 in-person conversations",
    excerpt: "Tested demand across successive prototypes through 92 in-person conversations (including 5 VCs) and 28 early users, including 6 paying",
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
