/* Flat inbox ranking for people + reading threads.
 * Order: live deadlines → warm follow-ups → self-paced prep → cold outreach.
 * Sent outreach rows are omitted (same UI rule as the rail).
 */

"use strict";

const TIER = {
  DEADLINE: 1,
  WARM: 2,
  PREP: 3,
  COLD: 4,
};

const WARM_TOUCH = new Set([
  "call_follow_up",
  "referral_follow_up",
]);

function dayKey(value) {
  if (!value) return "";
  const text = String(value).trim();
  const m = text.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0{1,3})?Z)?$/);
  if (m) return m[1];
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  return d.getUTCFullYear()
    + "-" + String(d.getUTCMonth() + 1).padStart(2, "0")
    + "-" + String(d.getUTCDate()).padStart(2, "0");
}

function todayKey(now) {
  const d = now instanceof Date ? now : new Date();
  return d.getFullYear()
    + "-" + String(d.getMonth() + 1).padStart(2, "0")
    + "-" + String(d.getDate()).padStart(2, "0");
}

function companyOf(lead, companiesById) {
  if (!lead) return null;
  if (lead.companyId && companiesById && companiesById[lead.companyId]) {
    return companiesById[lead.companyId];
  }
  return null;
}

function leadHasSent(leadId, drafts) {
  if (!leadId || !Array.isArray(drafts)) return false;
  return drafts.some((d) => d && d.leadId === leadId
    && (d.status === "sent_by_owner" || d.status === "sent"));
}

function notesLookLikePrep(notes) {
  const text = String(notes || "");
  if (!/^###\s+/m.test(text)) return false;
  if (/(?:^|\n)###\s*__done__\s*(?:\n|$)/.test(text)) return false;
  return true;
}

function isInterviewDeadline(lead, touch) {
  const blob = [
    lead && lead.nextStep,
    lead && lead.notes,
    touch && touch.touchType,
  ].map((v) => String(v || "").toLowerCase()).join(" ");
  return /\b(interview|braintrust|deadline|due today|ai interview|onsite|phone screen)\b/.test(blob);
}

function dueRaw(lead, touch) {
  if (touch && touch.date) return touch.date;
  if (lead && lead.nextStepAt) return lead.nextStepAt;
  return "";
}

function classifyPerson(lead, touch, company) {
  const due = dayKey(dueRaw(lead, touch));
  const today = todayKey(new Date());
  if (isInterviewDeadline(lead, touch) && due) {
    return {
      tier: TIER.DEADLINE,
      dueDay: due,
      rankReason: due <= today
        ? ("due " + (due === today ? "today" : due) + " · interview / deadline")
        : ("due " + due + " · interview / deadline"),
    };
  }
  if (touch && WARM_TOUCH.has(touch.touchType)) {
    return {
      tier: TIER.WARM,
      dueDay: due,
      rankReason: "follow-up" + (due ? " · " + due : ""),
    };
  }
  if (notesLookLikePrep(lead && lead.notes)) {
    return {
      tier: TIER.PREP,
      dueDay: due,
      rankReason: "interview prep",
    };
  }
  const priority = company && company.priority != null ? Number(company.priority) : 100;
  const north = !!(company && company.northStar);
  const wave = String((company && company.tier) || "other");
  return {
    tier: TIER.COLD,
    dueDay: due,
    rankReason: north
      ? ("North Star" + (due ? " · " + due : ""))
      : ((wave !== "other" ? wave.replace(/_/g, " ") : "outreach")
        + (due ? " · " + due : "")
        + (Number.isFinite(priority) ? "" : "")),
    priority,
    northStar: north,
  };
}

function classifyReading(thread) {
  if (!thread || thread.done) {
    return { tier: TIER.PREP, dueDay: "", rankReason: "reading · done", hide: !!thread.done };
  }
  const section = thread.currentSection && thread.currentSection.title
    ? String(thread.currentSection.title).trim()
    : "";
  return {
    tier: TIER.PREP,
    dueDay: "",
    rankReason: section ? ("reading · " + section) : "reading workbook",
    hide: false,
  };
}

function compareRanked(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const da = a.dueDay || "";
  const db = b.dueDay || "";
  if (da && db && da !== db) return da < db ? -1 : 1;
  // Only prefer a dated row over an undated one; equal due days fall through
  // so company priority / north-star can still break the tie.
  if (!!da !== !!db) return da ? -1 : 1;
  if (a.tier === TIER.COLD) {
    if (!!a.northStar !== !!b.northStar) return a.northStar ? -1 : 1;
    const pa = Number.isFinite(a.priority) ? a.priority : 100;
    const pb = Number.isFinite(b.priority) ? b.priority : 100;
    if (pa !== pb) return pa - pb;
  }
  const qa = Number(a.queueOrder || 0) - Number(b.queueOrder || 0);
  if (qa) return qa;
  return String(a.title || "").localeCompare(String(b.title || ""));
}

/**
 * @param {object} input
 * @param {object[]} input.leads
 * @param {object[]} [input.drafts]
 * @param {object} [input.byLeadId] map leadId → { touch }
 * @param {object[]} [input.companies]
 * @param {object[]} [input.readingThreads]
 * @param {boolean} [input.includeSent]
 */
function rankInboxItems(input) {
  const leads = Array.isArray(input && input.leads) ? input.leads : [];
  const drafts = Array.isArray(input && input.drafts) ? input.drafts : [];
  const byLeadId = (input && input.byLeadId) || {};
  const companies = Array.isArray(input && input.companies) ? input.companies : [];
  const readingThreads = Array.isArray(input && input.readingThreads) ? input.readingThreads : [];
  const includeSent = !!(input && input.includeSent);
  const companiesById = {};
  companies.forEach((c) => {
    if (c && c.id) companiesById[c.id] = c;
  });

  const items = [];
  leads.forEach((lead) => {
    if (!lead || !lead.id) return;
    if (!includeSent && leadHasSent(lead.id, drafts)) return;
    const entry = byLeadId[lead.id];
    const touch = entry && entry.touch ? entry.touch : null;
    const company = companyOf(lead, companiesById);
    const cls = classifyPerson(lead, touch, company);
    items.push({
      kind: "person",
      id: lead.id,
      title: String(lead.personName || "").trim() || "Someone",
      subtitle: String(lead.personTitle || lead.company || "").trim(),
      companyName: String((company && company.name) || lead.company || "").trim(),
      queueOrder: lead.queueOrder || 0,
      tier: cls.tier,
      dueDay: cls.dueDay || "",
      rankReason: cls.rankReason,
      priority: cls.priority != null ? cls.priority : (company && company.priority != null ? Number(company.priority) : 100),
      northStar: !!cls.northStar || !!(company && company.northStar),
      touchType: touch && touch.touchType ? touch.touchType : "",
      nextStep: lead.nextStep || "",
    });
  });

  readingThreads.forEach((thread) => {
    if (!thread || !thread.id) return;
    const cls = classifyReading(thread);
    if (cls.hide) return;
    items.push({
      kind: "reading",
      id: thread.id,
      title: String(thread.title || "Reading").trim() || "Reading",
      subtitle: thread.currentSection && thread.currentSection.title
        ? String(thread.currentSection.title).trim()
        : String(thread.author || "").trim(),
      companyName: "",
      queueOrder: 0,
      tier: cls.tier,
      dueDay: "",
      rankReason: cls.rankReason,
      priority: 100,
      northStar: false,
      touchType: "",
      nextStep: "",
    });
  });

  items.sort(compareRanked);
  return items.map((row, i) => Object.assign({}, row, { rank: i + 1 }));
}

module.exports = {
  TIER,
  dayKey,
  rankInboxItems,
  leadHasSent,
  notesLookLikePrep,
  isInterviewDeadline,
};
