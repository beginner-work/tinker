/* Kinds, answer rules, and the unverified seeds for the career record.
 * Loaded as a classic script before career.js (window.tinkerCareer)
 * and required from the API. The page and the connector tools both
 * read this list, so the words cannot drift.
 *
 * Seeds stay proposed until the signed-in user confirms them.
 * Rules are the answers Tyler already set. They are stored verified.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerCareer = api;
  } else if (root) {
    root.tinkerCareer = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FACT_KINDS = [
    "employer",
    "title",
    "dates",
    "team_size",
    "location",
    "metric",
    "degree",
    "contact",
    "story",
    "other",
  ];

  const UNVERIFIED_NOTE =
    "Unverified facts are not facts. Do not use them in applications or outreach.";

  const WEST_COAST_HUBS = [
    "Seattle",
    "San Francisco",
    "San Jose",
    "Oakland",
    "Bay Area",
    "Palo Alto",
    "Mountain View",
    "Sunnyvale",
    "Los Angeles",
    "San Diego",
    "Irvine",
    "Portland",
    "Bellevue",
    "Redmond",
    "Sacramento",
  ];

  const SENSITIVE_PATTERNS = [
    "visa",
    "work authorization",
    "work authorisation",
    "eeo",
    "equal employment",
    "demographic",
    "gender",
    "ethnicity",
    "veteran",
    "disability",
    "sexual orientation",
  ];

  const RESUME = "lindowlabs.dev/resume";
  const ANSWERS = "application answers, 2026-09-25";

  const SEED_RULES = [
    {
      id: "rule_salary",
      field: "salary",
      rule: "Salary or compensation stays blank; if a number is required, 0.",
      machine: { op: "blank_or_zero" },
      status: "verified",
    },
    {
      id: "rule_current_location",
      field: "current_location",
      rule: "Current location is San Diego, CA.",
      machine: { op: "equals", value: "San Diego, CA" },
      status: "verified",
    },
    {
      id: "rule_current_company",
      field: "current_company",
      rule: "Current company stays blank; a most recent company field gets Affirm.",
      machine: { op: "blank_current", most_recent: "Affirm" },
      status: "verified",
    },
    {
      id: "rule_relocate",
      field: "willing_to_relocate",
      rule: "Willing to relocate is always yes.",
      machine: { op: "equals", value: "yes" },
      status: "verified",
    },
    {
      id: "rule_work_city",
      field: "work_city",
      rule: "Work city is a listed West Coast office, or the closest tech hub if none is listed.",
      machine: { op: "west_coast_office_or_hub", hubs: WEST_COAST_HUBS.slice() },
      status: "verified",
    },
    {
      id: "rule_needs_claire",
      field: "sensitive",
      rule: "Visa, work authorization, EEO, demographic answers, and anything no rule covers return needs_claire. Never auto-filled.",
      machine: { op: "needs_claire" },
      status: "verified",
    },
  ];

  const SEED_FACTS = [
    {
      id: "seed_l7_people_leadership",
      kind: "story",
      value: "L7 people-leadership outcome",
      source: {
        document: RESUME,
        excerpt: "Software Engineering Manager (L7), Merchant Advocacy",
      },
      status: "proposed",
    },
    {
      id: "seed_500k_baseline_mechanism",
      kind: "metric",
      value: "Mechanism and baseline behind the additional $500K GMV",
      baseline: null,
      mechanism: null,
      source: {
        document: RESUME,
        excerpt: "generated an additional $500K GMV in a 3-day pre\u2013Black Friday sale",
      },
      status: "proposed",
    },
    {
      id: "seed_999_baseline_mechanism",
      kind: "metric",
      value: "Mechanism and baseline behind the 99.9% availability figure",
      baseline: null,
      mechanism: null,
      source: {
        document: RESUME,
        excerpt: "Raised availability 99.7% \u2192 99.9% in one quarter",
      },
      status: "proposed",
    },
    {
      id: "seed_same_team_span",
      kind: "team_size",
      value: "The team that grew from 1 to 9 is the same team that spanned the US, Canada and Poland",
      source: {
        document: ANSWERS,
        excerpt: "The biggest challenge was that my team spanned the US, Canada and Poland, so we couldn't count on being online at the same time.",
      },
      status: "proposed",
    },
  ];

  return {
    FACT_KINDS,
    UNVERIFIED_NOTE,
    WEST_COAST_HUBS,
    SENSITIVE_PATTERNS,
    SEED_RULES,
    SEED_FACTS,
    RESUME,
    ANSWERS,
  };
});
