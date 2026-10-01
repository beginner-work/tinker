/* Flat inbox ranking for people, reading threads, and job applications.
 * Order: live deadlines → warm follow-ups → self-paced prep → cold outreach.
 * Within a company (cold/prep work): referrer → eng lead → application → recruiter.
 * Sent outreach rows are omitted (same UI rule as the rail).
 */

"use strict";

const { addBusinessDays } = require("./business-days.js");

const TIER = {
  DEADLINE: 1,
  WARM: 2,
  PREP: 3,
  COLD: 4,
};

/** Per-company sequence (relationships before applying). */
const COMPANY_SEQ = {
  referrer: 10,
  hiring_leader: 20,
  application: 30,
  recruiter: 40,
  other: 50,
};

const WARM_TOUCH = new Set([
  "call_follow_up",
  "referral_follow_up",
]);

const TALKED_STAGES = new Set(["replied", "call", "interview", "offer"]);
const SENT_DRAFT = new Set(["sent_by_owner", "sent"]);

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
    && SENT_DRAFT.has(d.status));
}

function draftSentAt(leadId, drafts) {
  if (!leadId || !Array.isArray(drafts)) return "";
  let best = "";
  drafts.forEach((d) => {
    if (!d || d.leadId !== leadId || !SENT_DRAFT.has(d.status)) return;
    const when = dayKey(d.sentAt || d.updatedAt || "");
    if (when && (!best || when < best)) best = when;
  });
  return best;
}

function notesLookLikePrep(notes) {
  const text = String(notes || "");
  if (!/^###\s+/m.test(text)) return false;
  if (/(?:^|\n)###\s*__done__\s*(?:\n|$)/.test(text)) return false;
  return true;
}

function notesHaveDone(notes) {
  return /(?:^|\n)###\s*__done__\s*(?:\n|$)/.test(String(notes || ""));
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

function contactSeq(lead, touch) {
  const type = String((lead && lead.contactType) || "").toLowerCase();
  if (type === "referrer") return COMPANY_SEQ.referrer;
  if (type === "hiring_leader") return COMPANY_SEQ.hiring_leader;
  if (type === "recruiter") return COMPANY_SEQ.recruiter;
  const touchType = String((touch && touch.touchType) || "").toLowerCase();
  if (touchType === "referral_outreach" || touchType === "referral_follow_up") {
    return COMPANY_SEQ.referrer;
  }
  if (touchType === "hiring_leader_outreach") return COMPANY_SEQ.hiring_leader;
  if (touchType === "recruiter_outreach") return COMPANY_SEQ.recruiter;
  if (touchType === "application") return COMPANY_SEQ.application;
  return COMPANY_SEQ.other;
}

function companyKey(companyId, companyName) {
  if (companyId) return "id:" + companyId;
  const name = String(companyName || "").trim().toLowerCase();
  return name ? ("name:" + name) : "";
}

function isReferrerComplete(lead, drafts) {
  if (!lead) return false;
  if (notesHaveDone(lead.notes)) return true;
  if (leadHasSent(lead.id, drafts)) return true;
  const stage = String(lead.stage || "").toLowerCase();
  return stage === "contacted" || TALKED_STAGES.has(stage) || stage === "closed";
}

function engLeadTalked(lead) {
  if (!lead) return false;
  return TALKED_STAGES.has(String(lead.stage || "").toLowerCase());
}

function classifyPerson(lead, touch, company, ctx) {
  const due = dayKey(dueRaw(lead, touch));
  const today = todayKey(ctx && ctx.now);
  const seq = contactSeq(lead, touch);
  const companyId = (company && company.id) || lead.companyId || "";
  const companyName = (company && company.name) || lead.company || "";
  const ckey = companyKey(companyId, companyName);
  const appState = ctx && ctx.appsByCompany && ckey
    ? ctx.appsByCompany[ckey]
    : null;

  if (isInterviewDeadline(lead, touch) && due) {
    return {
      tier: TIER.DEADLINE,
      dueDay: due,
      companySeq: seq,
      companyKey: ckey,
      rankReason: due <= today
        ? ("due " + (due === today ? "today" : due) + " · interview / deadline")
        : ("due " + due + " · interview / deadline"),
    };
  }
  if (touch && WARM_TOUCH.has(touch.touchType)) {
    return {
      tier: TIER.WARM,
      dueDay: due,
      companySeq: seq,
      companyKey: ckey,
      rankReason: "follow-up" + (due ? " · " + due : ""),
    };
  }
  if (notesLookLikePrep(lead && lead.notes)) {
    return {
      tier: TIER.PREP,
      dueDay: due,
      companySeq: seq,
      companyKey: ckey,
      rankReason: "interview prep",
    };
  }

  // Recruiter waits until the company's open application is marked done.
  if (seq === COMPANY_SEQ.recruiter && appState && appState.open) {
    return {
      tier: TIER.COLD,
      dueDay: "",
      companySeq: seq,
      companyKey: ckey,
      waiting: true,
      rankReason: "waiting · after application"
        + (appState.openRole ? (" · " + appState.openRole) : ""),
      priority: company && company.priority != null ? Number(company.priority) : 100,
      northStar: !!(company && company.northStar),
    };
  }

  const priority = company && company.priority != null ? Number(company.priority) : 100;
  const north = !!(company && company.northStar);
  const wave = String((company && company.tier) || "other");
  let rankReason = north
    ? ("North Star" + (due ? " · " + due : ""))
    : ((wave !== "other" ? wave.replace(/_/g, " ") : "outreach")
      + (due ? " · " + due : ""));

  // Eng-lead outreach must stay peer-to-peer when an application is queued.
  if (seq === COMPANY_SEQ.hiring_leader && appState && (appState.open || appState.any)) {
    rankReason = "eng lead · peer"
      + (due ? " · " + due : "")
      + (appState.openRole ? (" · before apply " + appState.openRole) : "");
  }
  if (seq === COMPANY_SEQ.referrer) {
    rankReason = "referral ask" + (due ? " · " + due : "");
  }
  if (seq === COMPANY_SEQ.recruiter && appState && appState.doneRole) {
    rankReason = "recruiter · I just applied for " + appState.doneRole
      + (due ? " · " + due : "");
  }

  return {
    tier: TIER.COLD,
    dueDay: due,
    companySeq: seq,
    companyKey: ckey,
    rankReason,
    priority,
    northStar: north,
  };
}

function classifyReading(thread) {
  if (!thread || thread.done || thread.paused) {
    return {
      tier: TIER.PREP,
      dueDay: "",
      rankReason: thread && thread.paused ? "reading · on hold" : "reading · done",
      hide: true,
    };
  }
  const section = thread.currentSection && thread.currentSection.title
    ? String(thread.currentSection.title).trim()
    : "";
  return {
    tier: TIER.PREP,
    dueDay: "",
    companySeq: COMPANY_SEQ.other,
    companyKey: "",
    rankReason: section ? ("reading · " + section) : "reading workbook",
    hide: false,
  };
}

function buildAppsByCompany(applications) {
  const map = {};
  (applications || []).forEach((app) => {
    if (!app || !app.id) return;
    // Dropped apps are out of the chase — they never gate recruiter or eng-lead sequencing.
    if (app.status === "dropped") return;
    const ckey = companyKey(app.companyId, app.companyName);
    if (!ckey) return;
    if (!map[ckey]) {
      map[ckey] = {
        open: false,
        any: false,
        openRole: "",
        doneRole: "",
        openApps: [],
        doneApps: [],
      };
    }
    map[ckey].any = true;
    if (app.status === "done") {
      map[ckey].doneApps.push(app);
      if (!map[ckey].doneRole) map[ckey].doneRole = app.roleTitle || "";
    } else {
      map[ckey].open = true;
      map[ckey].openApps.push(app);
      if (!map[ckey].openRole) map[ckey].openRole = app.roleTitle || "";
    }
  });
  return map;
}

function companyPeople(leads, ckey, companiesById) {
  return (leads || []).filter((lead) => {
    if (!lead) return false;
    const company = companyOf(lead, companiesById);
    const key = companyKey(
      (company && company.id) || lead.companyId,
      (company && company.name) || lead.company,
    );
    return key && key === ckey;
  });
}

function classifyApplication(app, leads, drafts, byLeadId, companiesById, now) {
  const ckey = companyKey(app.companyId, app.companyName);
  const people = companyPeople(leads, ckey, companiesById);
  const referrers = people.filter((p) => String(p.contactType || "").toLowerCase() === "referrer");
  const engLeads = people.filter((p) => String(p.contactType || "").toLowerCase() === "hiring_leader");
  const company = (app.companyId && companiesById[app.companyId])
    || people.map((p) => companyOf(p, companiesById)).find(Boolean)
    || null;
  const priority = company && company.priority != null ? Number(company.priority) : 100;
  const northStar = !!(company && company.northStar);

  if (app.status === "done" || app.status === "dropped") {
    return {
      tier: TIER.COLD,
      dueDay: "",
      companySeq: COMPANY_SEQ.application,
      companyKey: ckey,
      hide: true,
      rankReason: app.status === "dropped" ? "dropped · not applying" : "applied · done",
      priority,
      northStar,
    };
  }

  // 1. Warm referral first — hold application until referral is marked in.
  const openReferrer = referrers.find((r) => !isReferrerComplete(r, drafts));
  if (openReferrer) {
    return {
      tier: TIER.COLD,
      dueDay: "",
      companySeq: COMPANY_SEQ.application,
      companyKey: ckey,
      waiting: true,
      rankReason: "waiting · after referral · " + (openReferrer.personName || "referrer"),
      priority,
      northStar,
    };
  }

  // 2. Eng-lead conversation (talked/replied) unlocks the application.
  const talked = engLeads.find((lead) => engLeadTalked(lead));
  if (talked) {
    const due = todayKey(now);
    return {
      tier: TIER.COLD,
      dueDay: due,
      companySeq: COMPANY_SEQ.application,
      companyKey: ckey,
      rankReason: "apply · after eng lead talk · " + (app.roleTitle || "role"),
      priority,
      northStar,
    };
  }

  // 3. Else 5 business days after eng-lead outreach is sent with no reply.
  let earliestSent = "";
  engLeads.forEach((lead) => {
    const sent = draftSentAt(lead.id, drafts);
    if (sent && (!earliestSent || sent < earliestSent)) earliestSent = sent;
  });
  // Also accept stage contacted as "sent" if no draft sentAt.
  if (!earliestSent) {
    engLeads.forEach((lead) => {
      if (String(lead.stage || "").toLowerCase() !== "contacted") return;
      const entry = byLeadId && byLeadId[lead.id];
      const touchDay = dayKey(entry && entry.touch && entry.touch.date);
      const fallback = dayKey(lead.updatedAt || lead.nextStepAt || "");
      const when = touchDay || fallback;
      if (when && (!earliestSent || when < earliestSent)) earliestSent = when;
    });
  }

  if (earliestSent) {
    const unlock = addBusinessDays(earliestSent, 5);
    const today = todayKey(now);
    if (unlock && unlock <= today) {
      return {
        tier: TIER.COLD,
        dueDay: unlock,
        companySeq: COMPANY_SEQ.application,
        companyKey: ckey,
        rankReason: "apply · 5 business days after eng lead · " + (app.roleTitle || "role"),
        priority,
        northStar,
      };
    }
    return {
      tier: TIER.COLD,
      dueDay: "",
      companySeq: COMPANY_SEQ.application,
      companyKey: ckey,
      waiting: true,
      rankReason: "waiting · eng lead sent · apply " + unlock,
      priority,
      northStar,
    };
  }

  // Eng lead outreach not sent yet — application waits behind it.
  if (engLeads.length) {
    return {
      tier: TIER.COLD,
      dueDay: "",
      companySeq: COMPANY_SEQ.application,
      companyKey: ckey,
      waiting: true,
      rankReason: "waiting · after eng lead outreach · " + (app.roleTitle || "role"),
      priority,
      northStar,
    };
  }

  // No eng lead on file — application is actionable on its own.
  return {
    tier: TIER.COLD,
    dueDay: todayKey(now),
    companySeq: COMPANY_SEQ.application,
    companyKey: ckey,
    rankReason: "apply · " + (app.roleTitle || "role"),
    priority,
    northStar,
  };
}

function compareRanked(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const da = a.dueDay || "";
  const db = b.dueDay || "";
  if (da && db && da !== db) return da < db ? -1 : 1;
  // Only prefer a dated row over an undated one; equal due days fall through.
  if (!!da !== !!db) return da ? -1 : 1;
  if (a.tier === TIER.COLD) {
    if (!!a.northStar !== !!b.northStar) return a.northStar ? -1 : 1;
    const pa = Number.isFinite(a.priority) ? a.priority : 100;
    const pb = Number.isFinite(b.priority) ? b.priority : 100;
    if (pa !== pb) return pa - pb;
  }
  // Same company: referrer → eng lead → application → recruiter.
  const ca = a.companyKey || "";
  const cb = b.companyKey || "";
  if (ca && cb && ca === cb) {
    const sa = Number(a.companySeq || COMPANY_SEQ.other);
    const sb = Number(b.companySeq || COMPANY_SEQ.other);
    if (sa !== sb) return sa - sb;
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
 * @param {object[]} [input.applications]
 * @param {Date|string} [input.now]
 * @param {boolean} [input.includeSent]
 */
function rankInboxItems(input) {
  const leads = Array.isArray(input && input.leads) ? input.leads : [];
  const drafts = Array.isArray(input && input.drafts) ? input.drafts : [];
  const byLeadId = (input && input.byLeadId) || {};
  const companies = Array.isArray(input && input.companies) ? input.companies : [];
  const readingThreads = Array.isArray(input && input.readingThreads) ? input.readingThreads : [];
  const applications = Array.isArray(input && input.applications) ? input.applications : [];
  const includeSent = !!(input && input.includeSent);
  const now = input && input.now ? input.now : new Date();
  const companiesById = {};
  companies.forEach((c) => {
    if (c && c.id) companiesById[c.id] = c;
  });
  const appsByCompany = buildAppsByCompany(applications);
  const ctx = { now, appsByCompany };

  const items = [];
  leads.forEach((lead) => {
    if (!lead || !lead.id) return;
    // Closed leads stay in list_target_companies but leave every inbox surface.
    if (String(lead.stage || "").toLowerCase() === "closed") return;
    if (!includeSent && leadHasSent(lead.id, drafts)) return;
    const entry = byLeadId[lead.id];
    const touch = entry && entry.touch ? entry.touch : null;
    const company = companyOf(lead, companiesById);
    const cls = classifyPerson(lead, touch, company, ctx);
    items.push({
      kind: "person",
      id: lead.id,
      title: String(lead.personName || "").trim() || "Someone",
      subtitle: String(lead.personTitle || lead.company || "").trim(),
      companyName: String((company && company.name) || lead.company || "").trim(),
      companyId: String((company && company.id) || lead.companyId || "").trim(),
      companyKey: cls.companyKey || "",
      companySeq: cls.companySeq != null ? cls.companySeq : COMPANY_SEQ.other,
      queueOrder: lead.queueOrder || 0,
      tier: cls.tier,
      dueDay: cls.dueDay || "",
      rankReason: cls.rankReason,
      priority: cls.priority != null ? cls.priority : (company && company.priority != null ? Number(company.priority) : 100),
      northStar: !!cls.northStar || !!(company && company.northStar),
      touchType: touch && touch.touchType ? touch.touchType : "",
      nextStep: lead.nextStep || "",
      waiting: !!cls.waiting,
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
      companyId: "",
      companyKey: "",
      companySeq: COMPANY_SEQ.other,
      queueOrder: 0,
      tier: cls.tier,
      dueDay: "",
      rankReason: cls.rankReason,
      priority: 100,
      northStar: false,
      touchType: "",
      nextStep: "",
      waiting: false,
    });
  });

  applications.forEach((app) => {
    if (!app || !app.id) return;
    const cls = classifyApplication(app, leads, drafts, byLeadId, companiesById, now);
    if (cls.hide) return;
    items.push({
      kind: "application",
      id: app.id,
      title: String(app.roleTitle || "Application").trim() || "Application",
      subtitle: String(app.companyName || "").trim(),
      companyName: String(app.companyName || "").trim(),
      companyId: String(app.companyId || "").trim(),
      companyKey: cls.companyKey || "",
      companySeq: COMPANY_SEQ.application,
      queueOrder: 0,
      tier: cls.tier,
      dueDay: cls.dueDay || "",
      rankReason: cls.rankReason,
      priority: cls.priority != null ? cls.priority : 100,
      northStar: !!cls.northStar,
      touchType: "application",
      nextStep: "",
      waiting: !!cls.waiting,
      postingUrl: app.postingUrl || "",
      payRange: app.payRange || "",
      fitNotes: app.fitNotes || "",
      status: app.status || "open",
    });
  });

  items.sort(compareRanked);
  return items.map((row, i) => Object.assign({}, row, { rank: i + 1 }));
}

module.exports = {
  TIER,
  COMPANY_SEQ,
  dayKey,
  rankInboxItems,
  leadHasSent,
  notesLookLikePrep,
  isInterviewDeadline,
  classifyApplication,
};
