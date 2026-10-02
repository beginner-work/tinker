/* Job application inbox items.
 *
 * One TinkerUserData row per user, kind "job_applications". Stage history
 * lives in a separate append-only blob, kind "job_application_stage_history".
 * Each application sits in the flat inbox next to that company's outreach.
 * Bots create/update via MCP; the owner marks done in the thread
 * (This is everything) or via mark_application_done. Do not seed Tyler's
 * roles in app code.
 */

"use strict";

const crypto = require("crypto");
const { addBusinessDays, dayKey } = require("./business-days.js");
const { readCalendarDate, presentCalendarDate } = require("./calendar-date.js");

const KIND = "job_applications";
const HISTORY_KIND = "job_application_stage_history";
const UNAVAILABLE = "Job applications are unavailable right now.";
const STATUSES = ["open", "done", "dropped"];
const STAGES = [
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
  "closed",
];
const MAX_ROLE = 200;
const MAX_COMPANY = 200;
const MAX_URL = 2000;
const MAX_PAY = 200;
const MAX_FIT = 8000;
const MAX_REFERRER = 200;
const MAX_SOURCE = 200;
const MAX_APPS = 80;
const MAX_STAGE_EVENTS = 2000;
const RECRUITER_BUMP_BUSINESS_DAYS = 1;

function db() {
  return require("./db.js");
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw fail(401, "Sign in to tinker first.");
  }
  return userId.trim();
}

function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
}

function newAppId() {
  return "app_" + crypto.randomBytes(8).toString("hex");
}

function newEventId() {
  return "ase_" + crypto.randomBytes(8).toString("hex");
}

function trimText(value, label, max, required) {
  const text = String(value == null ? "" : value).trim();
  if (!text) {
    if (required) throw fail(400, label + " is required.");
    return "";
  }
  if (text.length > max) throw fail(400, label + " is too long.");
  return text;
}

function normalizeStatus(value) {
  const found = String(value == null ? "" : value).trim().toLowerCase();
  if (found === "done" || found === "dropped") return found;
  return "open";
}

function readStatus(value, required) {
  if (value == null || value === "") {
    if (required) throw fail(400, "status is required.");
    return "";
  }
  const found = String(value).trim().toLowerCase();
  if (!STATUSES.includes(found)) throw fail(400, "status must be open, done, or dropped.");
  return found;
}

function readStage(value, required) {
  if (value == null || value === "") {
    if (required) throw fail(400, "stage is required.");
    return null;
  }
  const found = String(value).trim().toLowerCase();
  if (!STAGES.includes(found)) {
    throw fail(400, "stage must be " + STAGES.join(", ") + ".");
  }
  return found;
}

function readAppliedAt(value) {
  if (value == null || value === "") return null;
  const date = readCalendarDate(value, "appliedAt", { required: true });
  return presentCalendarDate(date);
}

function readChangedAt(value, fallbackIso) {
  if (value == null || value === "") return fallbackIso || new Date().toISOString();
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw fail(400, "stageChangedAt must be a timestamp.");
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw fail(400, "stageChangedAt must be a timestamp.");
    return value.toISOString();
  }
  const text = value.trim();
  if (!text) return fallbackIso || new Date().toISOString();
  // Date-only backfills become UTC midnight; timed values keep the instant.
  const date = readCalendarDate(text, "stageChangedAt", { required: true });
  return date.toISOString();
}

function readSource(value) {
  if (value == null || value === "") return "";
  return trimText(value, "source", MAX_SOURCE, false);
}

function presentStage(row) {
  if (row.stage == null || row.stage === "") return null;
  const found = String(row.stage).trim().toLowerCase();
  return STAGES.includes(found) ? found : null;
}

function presentStageEvent(row) {
  return {
    id: row.id,
    applicationId: row.applicationId,
    fromStage: row.fromStage == null || row.fromStage === "" ? null : String(row.fromStage),
    toStage: row.toStage == null || row.toStage === "" ? null : String(row.toStage),
    changedAt: row.changedAt || null,
    source: row.source || "",
  };
}

function presentApplication(row) {
  return {
    id: row.id,
    roleTitle: row.roleTitle || "",
    companyName: row.companyName || "",
    companyId: row.companyId || "",
    postingUrl: row.postingUrl || "",
    payRange: row.payRange || "",
    fitNotes: row.fitNotes || "",
    referrerPersonId: row.referrerPersonId || "",
    referrerName: row.referrerName || "",
    status: normalizeStatus(row.status),
    stage: presentStage(row),
    appliedAt: row.appliedAt ? presentCalendarDate(row.appliedAt) : null,
    stageUpdatedAt: row.stageUpdatedAt || null,
    doneAt: row.doneAt || null,
    droppedAt: row.droppedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function readBlob(userId) {
  const prisma = db();
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: KIND } },
  });
  const data = row && row.data && typeof row.data === "object" ? row.data : {};
  const applications = Array.isArray(data.applications) ? data.applications : [];
  return { applications, updatedAt: row ? row.updatedAt : null };
}

async function writeBlob(userId, applications) {
  const prisma = db();
  const data = { applications };
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: KIND } },
    create: { userId, kind: KIND, data },
    update: { data },
  });
}

async function readHistoryBlob(userId) {
  const prisma = db();
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: HISTORY_KIND } },
  });
  const data = row && row.data && typeof row.data === "object" ? row.data : {};
  const events = Array.isArray(data.events) ? data.events : [];
  return { events, updatedAt: row ? row.updatedAt : null };
}

async function writeHistoryBlob(userId, events) {
  const prisma = db();
  const data = { events };
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: HISTORY_KIND } },
    create: { userId, kind: HISTORY_KIND, data },
    update: { data },
  });
}

function findApp(applications, applicationId) {
  const id = String(applicationId || "").trim();
  if (!id) throw fail(400, "applicationId is required.");
  const row = applications.find((item) => item && item.id === id);
  if (!row) throw fail(404, "Application not found.");
  return row;
}

function sortEventsOldestFirst(events) {
  return events.slice().sort((a, b) => {
    const aAt = String(a && a.changedAt || "");
    const bAt = String(b && b.changedAt || "");
    if (aAt < bAt) return -1;
    if (aAt > bAt) return 1;
    return String(a && a.id || "").localeCompare(String(b && b.id || ""));
  });
}

async function appendStageEvent(userId, { applicationId, fromStage, toStage, changedAt, source }) {
  const { events } = await readHistoryBlob(userId);
  const event = {
    id: newEventId(),
    applicationId,
    fromStage: fromStage == null ? null : fromStage,
    toStage: toStage == null ? null : toStage,
    changedAt,
    source: source || "",
  };
  events.push(event);
  while (events.length > MAX_STAGE_EVENTS) events.shift();
  await writeHistoryBlob(userId, events);
  return presentStageEvent(event);
}

async function listApplications({ userId, status, stage } = {}) {
  try {
    const uid = requireUserId(userId);
    const { applications } = await readBlob(uid);
    const statusFilter = status ? readStatus(status, true) : "";
    const stageFilter = stage ? readStage(stage, true) : null;
    return applications
      .filter((row) => {
        if (statusFilter && normalizeStatus(row.status) !== statusFilter) return false;
        if (stageFilter && presentStage(row) !== stageFilter) return false;
        return true;
      })
      .map(presentApplication);
  } catch (err) {
    throw storeDown(err);
  }
}

async function getApplication({ userId, applicationId } = {}) {
  try {
    const uid = requireUserId(userId);
    const { applications } = await readBlob(uid);
    return presentApplication(findApp(applications, applicationId));
  } catch (err) {
    throw storeDown(err);
  }
}

async function getApplicationHistory({ userId, applicationId } = {}) {
  try {
    const uid = requireUserId(userId);
    const { applications } = await readBlob(uid);
    const app = findApp(applications, applicationId);
    const { events } = await readHistoryBlob(uid);
    const stageHistory = sortEventsOldestFirst(
      events.filter((row) => row && row.applicationId === app.id),
    ).map(presentStageEvent);
    return { applicationId: app.id, stageHistory };
  } catch (err) {
    throw storeDown(err);
  }
}

async function createApplication(input = {}) {
  try {
    const uid = requireUserId(input.userId);
    const roleTitle = trimText(input.roleTitle, "roleTitle", MAX_ROLE, true);
    const companyName = trimText(input.companyName, "companyName", MAX_COMPANY, true);
    const companyId = trimText(input.companyId, "companyId", 80, false);
    const postingUrl = trimText(input.postingUrl, "postingUrl", MAX_URL, false);
    const payRange = trimText(input.payRange, "payRange", MAX_PAY, false);
    const fitNotes = trimText(input.fitNotes, "fitNotes", MAX_FIT, false);
    const referrerPersonId = trimText(input.referrerPersonId, "referrerPersonId", 80, false);
    const referrerName = trimText(input.referrerName, "referrerName", MAX_REFERRER, false);
    const status = input.status != null && input.status !== ""
      ? readStatus(input.status, true)
      : "open";
    const hasStage = Object.prototype.hasOwnProperty.call(input, "stage")
      && input.stage != null && input.stage !== "";
    const stage = hasStage ? readStage(input.stage, true) : null;
    const hasAppliedAt = Object.prototype.hasOwnProperty.call(input, "appliedAt");
    const appliedAt = hasAppliedAt ? readAppliedAt(input.appliedAt) : null;
    const source = readSource(input.source);
    const now = new Date().toISOString();
    const stageAt = stage
      ? readChangedAt(
        Object.prototype.hasOwnProperty.call(input, "stageChangedAt") ? input.stageChangedAt : null,
        now,
      )
      : null;
    const row = {
      id: newAppId(),
      roleTitle,
      companyName,
      companyId,
      postingUrl,
      payRange,
      fitNotes,
      referrerPersonId,
      referrerName,
      status,
      stage,
      appliedAt,
      stageUpdatedAt: stageAt,
      doneAt: status === "done" ? now : null,
      droppedAt: status === "dropped" ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    const { applications } = await readBlob(uid);
    applications.push(row);
    while (applications.length > MAX_APPS) applications.shift();
    await writeBlob(uid, applications);
    if (stage) {
      await appendStageEvent(uid, {
        applicationId: row.id,
        fromStage: null,
        toStage: stage,
        changedAt: stageAt,
        source,
      });
    }
    return presentApplication(row);
  } catch (err) {
    throw storeDown(err);
  }
}

async function updateApplication({ userId, applicationId, patch } = {}) {
  try {
    const uid = requireUserId(userId);
    const { applications } = await readBlob(uid);
    const row = findApp(applications, applicationId);
    const src = patch && typeof patch === "object" ? patch : {};
    if (Object.prototype.hasOwnProperty.call(src, "roleTitle")) {
      row.roleTitle = trimText(src.roleTitle, "roleTitle", MAX_ROLE, true);
    }
    if (Object.prototype.hasOwnProperty.call(src, "companyName")) {
      row.companyName = trimText(src.companyName, "companyName", MAX_COMPANY, true);
    }
    if (Object.prototype.hasOwnProperty.call(src, "companyId")) {
      row.companyId = trimText(src.companyId, "companyId", 80, false);
    }
    if (Object.prototype.hasOwnProperty.call(src, "postingUrl")) {
      row.postingUrl = trimText(src.postingUrl, "postingUrl", MAX_URL, false);
    }
    if (Object.prototype.hasOwnProperty.call(src, "payRange")) {
      row.payRange = trimText(src.payRange, "payRange", MAX_PAY, false);
    }
    if (Object.prototype.hasOwnProperty.call(src, "fitNotes")) {
      row.fitNotes = trimText(src.fitNotes, "fitNotes", MAX_FIT, false);
    }
    if (Object.prototype.hasOwnProperty.call(src, "referrerPersonId")) {
      row.referrerPersonId = trimText(src.referrerPersonId, "referrerPersonId", 80, false);
    }
    if (Object.prototype.hasOwnProperty.call(src, "referrerName")) {
      row.referrerName = trimText(src.referrerName, "referrerName", MAX_REFERRER, false);
    }
    if (Object.prototype.hasOwnProperty.call(src, "status")) {
      const next = readStatus(src.status, true);
      const now = new Date().toISOString();
      row.status = next;
      if (next === "done") {
        if (!row.doneAt) row.doneAt = now;
        row.droppedAt = null;
      } else if (next === "dropped") {
        if (!row.droppedAt) row.droppedAt = now;
        // Dropping never sets doneAt; leave an existing doneAt untouched.
      } else if (next === "open") {
        row.doneAt = null;
        row.droppedAt = null;
      }
    }
    let stageEvent = null;
    if (Object.prototype.hasOwnProperty.call(src, "stage")) {
      const nextStage = readStage(src.stage, src.stage != null && src.stage !== "");
      const prevStage = presentStage(row);
      if (nextStage !== prevStage) {
        const changedAt = readChangedAt(
          Object.prototype.hasOwnProperty.call(src, "stageChangedAt") ? src.stageChangedAt : null,
          new Date().toISOString(),
        );
        const source = readSource(src.source);
        row.stage = nextStage;
        row.stageUpdatedAt = changedAt;
        stageEvent = {
          applicationId: row.id,
          fromStage: prevStage,
          toStage: nextStage,
          changedAt,
          source,
        };
      }
    }
    if (Object.prototype.hasOwnProperty.call(src, "appliedAt")) {
      row.appliedAt = readAppliedAt(src.appliedAt);
    }
    row.updatedAt = new Date().toISOString();
    await writeBlob(uid, applications);
    if (stageEvent) await appendStageEvent(uid, stageEvent);
    return presentApplication(row);
  } catch (err) {
    throw storeDown(err);
  }
}

/**
 * Mark application done and bump open recruiter outreach for that company
 * to 1 business day later (so "I just applied" can go out).
 */
async function markApplicationDone({ userId, emailHint, applicationId, actor } = {}) {
  try {
    const uid = requireUserId(userId);
    const { applications } = await readBlob(uid);
    const row = findApp(applications, applicationId);
    const now = new Date().toISOString();
    if (row.status !== "done") {
      row.status = "done";
      row.doneAt = now;
      row.droppedAt = null;
      row.updatedAt = now;
      await writeBlob(uid, applications);
    }
    const bumped = await bumpRecruiterTouches({
      userId: uid,
      emailHint,
      actor,
      companyId: row.companyId,
      companyName: row.companyName,
      fromDay: dayKey(row.doneAt || now),
    });
    return { application: presentApplication(row), recruiterTouches: bumped };
  } catch (err) {
    throw storeDown(err);
  }
}

async function bumpRecruiterTouches({ userId, emailHint, actor, companyId, companyName, fromDay }) {
  const schedule = require("./outreach-schedule-store.js");
  const companies = require("./leads-companies-store.js");
  const due = addBusinessDays(fromDay || dayKey(new Date()), RECRUITER_BUMP_BUSINESS_DAYS);
  if (!due) return [];
  let company = null;
  try {
    const rows = await companies.listCompanies({ userId, emailHint, status: "active" });
    company = (rows || []).find((c) => {
      if (!c) return false;
      if (companyId && c.id === companyId) return true;
      if (companyName && String(c.name || "").trim().toLowerCase()
        === String(companyName || "").trim().toLowerCase()) return true;
      return false;
    }) || null;
  } catch (_err) {
    company = null;
  }
  if (!company) return [];
  let allTouches = [];
  try {
    allTouches = await db().outreachTouch.findMany({
      where: {
        userId,
        companyId: company.id,
        touchType: "recruiter_outreach",
        status: { in: ["planned", "drafted"] },
      },
    });
  } catch (_err) {
    return [];
  }
  const out = [];
  for (const touch of allTouches) {
    if (!touch || !touch.id) continue;
    try {
      const saved = await schedule.updateTouch({
        id: touch.id,
        userId,
        emailHint,
        actor: actor || { kind: "bot", label: "bot:mcp" },
        patch: { date: due },
      });
      out.push(saved);
    } catch (_err) {
      /* keep going */
    }
  }
  return out;
}

module.exports = {
  KIND,
  HISTORY_KIND,
  UNAVAILABLE,
  STATUSES,
  STAGES,
  RECRUITER_BUMP_BUSINESS_DAYS,
  presentApplication,
  presentStageEvent,
  listApplications,
  getApplication,
  getApplicationHistory,
  createApplication,
  updateApplication,
  markApplicationDone,
  bumpRecruiterTouches,
};
