/* Approval catalog and allowlist.
 *
 * APPROVAL_ITEMS is the only place labels, order, defaults, and the
 * send note live. The approval_settings table stores the current
 * boolean plus who last changed it. A missing row falls back to the
 * default in this list. A key that is not in this list does not exist.
 */

"use strict";

const SEND_NOTE =
  "The draft card with its Send button always stays, even when this is off.";

const APPROVAL_ITEMS = [
  {
    key: "linkedin_profile_edits",
    label: "LinkedIn profile edits",
    required: false,
  },
  {
    key: "linkedin_posts",
    label: "LinkedIn posts",
    required: true,
  },
  {
    key: "linkedin_connection_requests",
    label: "LinkedIn connection requests and notes",
    required: true,
  },
  {
    key: "linkedin_messages",
    label: "LinkedIn messages and follow-ups",
    required: true,
    send_note: SEND_NOTE,
  },
  {
    key: "outreach_emails",
    label: "Outreach and follow-up emails from Tyler's accounts",
    required: true,
    send_note: SEND_NOTE,
  },
  {
    key: "other_public_profiles",
    label: "Other public profiles (Calendly, GitHub, Otta)",
    required: true,
  },
  {
    key: "site_content_live",
    label: "Blog and site content going live on lindowlabs.dev",
    required: true,
  },
  {
    key: "code_pr_merges",
    label: "Merging code PRs",
    required: true,
  },
  {
    key: "dns_domain_changes",
    label: "lindowlabs.dev DNS and domain changes",
    required: true,
  },
  {
    key: "purchases_subscriptions",
    label: "Purchases and subscriptions",
    required: true,
  },
  {
    key: "calendar_invites_others",
    label: "Calendar invites to other people",
    required: true,
  },
  {
    key: "family_admin_messages",
    label: "Family admin messages",
    required: true,
    send_note: SEND_NOTE,
  },
  {
    key: "resume_changes",
    label: "Resume changes",
    required: true,
  },
  {
    key: "bot_routines_rules",
    label: "New bot routines and rule changes",
    required: true,
  },
];

const BY_KEY = new Map(APPROVAL_ITEMS.map((item) => [item.key, item]));

const SEND_NOTE_KEYS = APPROVAL_ITEMS.filter((item) => item.send_note).map((item) => item.key);

function itemFor(key) {
  return BY_KEY.get(key) || null;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function shapeItem(def, row) {
  const item = {
    key: def.key,
    label: def.label,
    required: row ? Boolean(row.required) : Boolean(def.required),
    updated_by: row && row.updatedBy ? String(row.updatedBy) : null,
    updated_at: row && row.updatedAt ? iso(row.updatedAt) : null,
  };
  if (def.send_note) item.send_note = def.send_note;
  return item;
}

function shapeList(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    if (row && row.key) byKey.set(row.key, row);
  }
  return {
    default_if_missing: "required",
    items: APPROVAL_ITEMS.map((def) => shapeItem(def, byKey.get(def.key) || null)),
  };
}

// APPROVAL_ALLOWLIST is a comma-separated list. Each entry is a Stytch
// user id or email, optionally followed by ":" and the short name to
// store in updated_by. Example: user-live-abc:tyler
function parseAllowlist(raw) {
  const entries = [];
  for (const part of String(raw || "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    const identity = (colon === -1 ? trimmed : trimmed.slice(0, colon)).trim();
    const name = colon === -1 ? "" : trimmed.slice(colon + 1).trim();
    if (!identity) continue;
    entries.push({ identity, name: name.slice(0, 80) });
  }
  return entries;
}

function sessionIdentity(session) {
  const user = (session && session.user) || {};
  const userId =
    (session && session.session && session.session.user_id) ||
    user.user_id ||
    "";
  const emails = [];
  const rawEmails = Array.isArray(user.emails) ? user.emails : [];
  for (const entry of rawEmails) {
    const email = typeof entry === "string" ? entry : entry && entry.email;
    if (typeof email === "string" && email.trim()) emails.push(email.trim());
  }
  const name = user.name || {};
  return {
    userId: String(userId || ""),
    emails,
    firstName: typeof name.first_name === "string" ? name.first_name.trim() : "",
    lastName: typeof name.last_name === "string" ? name.last_name.trim() : "",
  };
}

function matchesEntry(entry, identity) {
  if (entry.identity.includes("@")) {
    const want = entry.identity.toLowerCase();
    return identity.emails.some((email) => email.toLowerCase() === want);
  }
  return Boolean(identity.userId) && entry.identity === identity.userId;
}

function editorName(entry, identity) {
  if (entry.name) return entry.name;
  if (identity.emails.length) return identity.emails[0].slice(0, 80);
  const named = [identity.firstName, identity.lastName].filter(Boolean).join(" ");
  if (named) return named.slice(0, 80);
  return identity.userId.slice(0, 80);
}

// Fail closed: an empty or unset allowlist lets nobody write.
function editorFromSession(session) {
  const identity = sessionIdentity(session);
  if (!identity.userId) {
    throw Object.assign(new Error("Session missing user id."), { status: 401 });
  }
  const entries = parseAllowlist(process.env.APPROVAL_ALLOWLIST);
  const match = entries.find((entry) => matchesEntry(entry, identity));
  if (!match) {
    throw Object.assign(new Error("Not allowed to change approvals."), { status: 403 });
  }
  return { updatedBy: editorName(match, identity) };
}

module.exports = {
  SEND_NOTE,
  SEND_NOTE_KEYS,
  APPROVAL_ITEMS,
  itemFor,
  shapeItem,
  shapeList,
  parseAllowlist,
  sessionIdentity,
  editorFromSession,
};
