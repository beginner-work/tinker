/* Labels, scope lines, order, and the send note for the 14 autonomy
 * settings. Loaded as a classic script before autonomy.js
 * (window.tinkerAutonomy) and required from api/_lib/autonomy.js.
 * The page and get_autonomy_settings both read this list, so the
 * words cannot drift.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerAutonomy = api;
  } else if (root) {
    root.tinkerAutonomy = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SEND_NOTE =
    "Even when this is on, bots only prepare a draft card. You always press Send.";

  const AUTONOMY_ITEMS = [
    {
      key: "linkedin_profile_edits",
      label: "LinkedIn profile edits",
      description: "Edits to Tyler's LinkedIn profile.",
    },
    {
      key: "linkedin_posts",
      label: "LinkedIn posts",
      description: "Posts on Tyler's LinkedIn.",
    },
    {
      key: "linkedin_connection_requests",
      label: "LinkedIn connection requests and notes",
      description: "LinkedIn connection requests and the notes that go with them.",
    },
    {
      key: "linkedin_messages",
      label: "LinkedIn messages and follow-ups",
      description: "LinkedIn messages and follow-ups.",
      send_note: SEND_NOTE,
    },
    {
      key: "outreach_emails",
      label: "Outreach and follow-up emails from Tyler's accounts",
      description: "Outreach and follow-up emails sent from Tyler's accounts.",
      send_note: SEND_NOTE,
    },
    {
      key: "other_public_profiles",
      label: "Other public profiles (Calendly, GitHub, Otta)",
      description: "Other public profiles, including Calendly, GitHub, and Otta.",
    },
    {
      key: "site_content_live",
      label: "Blog and site content going live on lindowlabs.dev",
      description: "Blog and site content going live on lindowlabs.dev.",
    },
    {
      key: "code_pr_merges",
      label: "Merging code PRs",
      description: "Merging code pull requests.",
    },
    {
      key: "dns_domain_changes",
      label: "lindowlabs.dev DNS and domain changes",
      description: "DNS and domain changes for lindowlabs.dev.",
    },
    {
      key: "purchases_subscriptions",
      label: "Purchases and subscriptions",
      description: "Purchases and subscriptions.",
    },
    {
      key: "calendar_invites_others",
      label: "Calendar invites to other people",
      description: "Calendar invites sent to other people.",
    },
    {
      key: "family_admin_messages",
      label: "Family admin messages",
      description: "Family admin messages.",
      send_note: SEND_NOTE,
    },
    {
      key: "resume_changes",
      label: "Resume changes",
      description: "Changes to Tyler's resume.",
    },
    {
      key: "bot_routines_rules",
      label: "New bot routines and rule changes",
      description: "New bot routines and changes to bot rules.",
    },
  ];

  return { SEND_NOTE, AUTONOMY_ITEMS };
});
