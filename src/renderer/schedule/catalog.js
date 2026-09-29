/* Shared schedule labels. Keep keys aligned with the store. */
(function (root) {
  "use strict";
  root.tinkerSchedule = {
    TOUCH_TYPES: [
      { key: "application", label: "Application" },
      { key: "hiring_leader_outreach", label: "Hiring leader outreach" },
      { key: "recruiter_outreach", label: "Recruiter outreach" },
      { key: "referral_follow_up", label: "Referral follow-up" },
      { key: "call_follow_up", label: "Call follow-up" },
    ],
    TOUCH_STATUSES: [
      { key: "planned", label: "Planned" },
      { key: "drafted", label: "Drafted" },
      { key: "done", label: "Done" },
      { key: "skipped", label: "Skipped" },
    ],
    SESSION_TYPES: [
      { key: "company", label: "Company craft" },
      { key: "skill", label: "Skill" },
    ],
    DAYS: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  };
})(typeof window !== "undefined" ? window : globalThis);
