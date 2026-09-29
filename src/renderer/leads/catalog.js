/* Shared labels for /leads. Stages and sources match api/_lib/leads-store.js. */
(function (root) {
  "use strict";
  root.tinkerLeads = {
    STAGES: [
      { key: "new", label: "New" },
      { key: "drafting", label: "Drafting" },
      { key: "contacted", label: "Contacted" },
      { key: "replied", label: "Replied" },
      { key: "call", label: "Call" },
      { key: "interview", label: "Interview" },
      { key: "offer", label: "Offer" },
      { key: "closed", label: "Closed" },
    ],
    SOURCES: [
      { key: "referral", label: "Referral" },
      { key: "formation", label: "Formation" },
      { key: "linkedin", label: "LinkedIn" },
      { key: "posting", label: "Posting" },
      { key: "event", label: "Event" },
      { key: "other", label: "Other" },
    ],
    OUTCOMES: [
      { key: "replied", label: "Replied" },
      { key: "call", label: "Call" },
      { key: "interview", label: "Interview" },
      { key: "offer", label: "Offer" },
    ],
  };
})(typeof window !== "undefined" ? window : globalThis);
