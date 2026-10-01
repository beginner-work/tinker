/* Outreach schedule: planned touches and sessions. Owner-scoped. Never sends. */
"use strict";

const TOUCH_TYPES = ["application", "referral_outreach", "hiring_leader_outreach", "recruiter_outreach", "referral_follow_up", "call_follow_up"];
const TOUCH_STATUSES = ["planned", "drafted", "done", "skipped"];
const SESSION_TYPES = ["company", "skill"];
const OPEN_TOUCH = ["planned", "drafted"];
const BUSY_KIND_PREFIX = "outreach-busy:";
const UNAVAILABLE = "Schedule is unavailable right now.";
const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "OutreachTouch" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "touchType" TEXT NOT NULL, "date" TIMESTAMP(3) NOT NULL, "windowStart" TEXT NOT NULL DEFAULT '', "windowEnd" TEXT NOT NULL DEFAULT '', "leadId" TEXT, "status" TEXT NOT NULL, "draftId" TEXT, "sessionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "OutreachTouch_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "OutreachTouch_userId_idx" ON "OutreachTouch"("userId")`,
  `CREATE INDEX IF NOT EXISTS "OutreachTouch_userId_date_idx" ON "OutreachTouch"("userId", "date")`,
  `CREATE INDEX IF NOT EXISTS "OutreachTouch_companyId_idx" ON "OutreachTouch"("companyId")`,
  `CREATE INDEX IF NOT EXISTS "OutreachTouch_sessionId_idx" ON "OutreachTouch"("sessionId")`,
  `CREATE TABLE IF NOT EXISTS "OutreachSession" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL, "title" TEXT NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL, "productArea" TEXT NOT NULL DEFAULT '', "concept" TEXT NOT NULL DEFAULT '', "curriculumRef" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "OutreachSession_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "OutreachSession_userId_idx" ON "OutreachSession"("userId")`,
  `CREATE INDEX IF NOT EXISTS "OutreachSession_userId_startsAt_idx" ON "OutreachSession"("userId", "startsAt")`,
];

let ensuring = null;
const db = () => require("./db.js");
const leads = () => require("./leads-store.js");
const companies = () => require("./leads-companies-store.js");
const fail = (status, message) => Object.assign(new Error(message), { status });
const storeDown = (err) => (err && err.status) ? err : Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
const { readCalendarDate, presentCalendarDate, calendarDayKey } = require("./calendar-date.js");
const iso = (value) => (value ? new Date(value).toISOString() : null);
function shape(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "userId") continue;
    if (key === "date") {
      out[key] = presentCalendarDate(value);
      continue;
    }
    out[key] = value instanceof Date ? iso(value) : value;
  }
  return out;
}
async function ensureTable() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    await companies().ensureTable();
    for (const statement of TABLE_STATEMENTS) await db().$executeRawUnsafe(statement);
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare the schedule tables."), { status: 503, cause: err });
  });
  return ensuring;
}
function resetTableCache() { ensuring = null; }
function readText(value, label, max, required) {
  if (value == null || value === "") { if (required) throw fail(400, `${label} is required.`); return ""; }
  if (typeof value !== "string") throw fail(400, `${label} must be a string.`);
  const text = value.trim();
  if (required && !text) throw fail(400, `${label} is required.`);
  if (text.length > max) throw fail(400, `${label} is limited to ${max} characters.`);
  return text;
}
function readEnum(value, allowed, label) {
  const found = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!allowed.includes(found)) throw fail(400, `${label} must be ${allowed.join(" or ")}.`);
  return found;
}
function readDate(value, label) {
  return readCalendarDate(value, label, { required: true });
}
function readOptionalId(value, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) throw fail(400, `${label} must be an id.`);
  return value.trim();
}
function readWindow(value, label) {
  const text = readText(value, label, 16, false);
  if (text && !/^\d{2}:\d{2}$/.test(text)) throw fail(400, `${label} must be HH:MM.`);
  return text;
}
function dayKey(value) {
  return calendarDayKey(value) || (() => {
    const d = new Date(value);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  })();
}
function mondayOf(value) {
  const d = new Date(value);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function fridayOf(monday) {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + 4);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
function requireOwner(userId, emailHint) {
  const owner = typeof userId === "string" ? userId.trim() : "";
  if (!owner) throw fail(401, "Sign in to tinker first.");
  leads().assertAllowed(owner, emailHint);
  return owner;
}
function requireActor(actor) {
  if (!(actor && typeof actor.label === "string" && /^user:\S/.test(actor.label.trim()))) throw fail(401, "Missing actor.");
}
function requireWriteActor(actor) {
  const label = actor && typeof actor.label === "string" ? actor.label.trim() : "";
  const kind = actor && actor.kind;
  const ok = (kind === "human" && /^user:\S/.test(label)) || (kind === "bot" && /^bot:\S/.test(label));
  if (!ok) throw fail(401, "Missing actor.");
  return label;
}
function busyKind(monday) {
  return BUSY_KIND_PREFIX + dayKey(monday);
}
function presentBusyBlock(block) {
  const label = block && block.label ? String(block.label) : "";
  return {
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    label,
    title: label || "Busy",
  };
}
function readBusyBlocks(blocks) {
  if (!Array.isArray(blocks)) throw fail(400, "blocks must be an array.");
  if (blocks.length > 200) throw fail(400, "blocks is limited to 200 entries.");
  const out = [];
  for (const item of blocks) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw fail(400, "Each busy block must be an object.");
    const startsAt = readDate(item.startsAt, "startsAt");
    const endsAt = readDate(item.endsAt, "endsAt");
    if (endsAt <= startsAt) throw fail(400, "endsAt must be after startsAt.");
    out.push({
      startsAt: iso(startsAt),
      endsAt: iso(endsAt),
      label: readText(item.label, "label", 200, false),
    });
  }
  out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt));
  return out;
}
async function loadOwned(model, id, owner, label) {
  if (typeof id !== "string" || !id.trim()) throw fail(400, `${label} id is required.`);
  let row;
  try { row = await db()[model].findUnique({ where: { id: id.trim() } }); }
  catch (err) { throw storeDown(err); }
  if (!row || row.userId !== owner) throw fail(404, `No ${label} with that id.`);
  return row;
}
async function assertRefs(owner, emailHint, { companyId, leadId, draftId, sessionId }) {
  if (companyId) await companies().loadCompany(companyId, owner);
  if (leadId) await leads().getLead({ id: leadId, userId: owner, emailHint });
  if (draftId) {
    let row;
    try { row = await db().leadDraft.findUnique({ where: { id: draftId } }); }
    catch (err) { throw storeDown(err); }
    if (!row || row.userId !== owner) throw fail(404, "No draft with that id.");
  }
  if (sessionId) await loadOwned("outreachSession", sessionId, owner, "session");
}
function touchData(input, owner) {
  const data = {
    userId: owner,
    companyId: readText(input.companyId, "companyId", 64, true),
    touchType: readEnum(input.touchType, TOUCH_TYPES, "touchType"),
    date: readDate(input.date, "date"),
    windowStart: readWindow(input.windowStart, "windowStart"),
    windowEnd: readWindow(input.windowEnd, "windowEnd"),
    leadId: readOptionalId(input.leadId, "leadId"),
    status: readEnum(input.status || "planned", TOUCH_STATUSES, "status"),
    draftId: readOptionalId(input.draftId, "draftId"),
    sessionId: readOptionalId(input.sessionId, "sessionId"),
  };
  if (data.windowStart && data.windowEnd && data.windowStart > data.windowEnd) throw fail(400, "windowStart must be before windowEnd.");
  return data;
}
async function createTouch(input) {
  const owner = requireOwner(input.userId, input.emailHint);
  requireWriteActor(input.actor);
  const data = touchData(input, owner);
  await ensureTable();
  await assertRefs(owner, input.emailHint, data);
  try { return await db().outreachTouch.create({ data }); }
  catch (err) { throw storeDown(err); }
}
async function updateTouch({ id, userId, emailHint, actor, patch }) {
  const owner = requireOwner(userId, emailHint);
  requireWriteActor(actor);
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const keys = ["companyId", "touchType", "date", "windowStart", "windowEnd", "leadId", "status", "draftId", "sessionId"]
    .filter((key) => Object.prototype.hasOwnProperty.call(source, key));
  if (!keys.length) throw fail(400, "Nothing to update.");
  await ensureTable();
  const row = await loadOwned("outreachTouch", id, owner, "touch");
  const merged = Object.assign({}, row, source);
  const data = touchData(merged, owner);
  delete data.userId;
  await assertRefs(owner, emailHint, data);
  try { return await db().outreachTouch.update({ where: { id: row.id }, data }); }
  catch (err) { throw storeDown(err); }
}
function sessionFields(input, existing) {
  const type = input.type != null ? readEnum(input.type, SESSION_TYPES, "type") : (existing && existing.type);
  if (!type) throw fail(400, "type is required.");
  const title = input.title != null ? readText(input.title, "title", 200, true) : (existing && existing.title);
  if (!title) throw fail(400, "title is required.");
  const startsAt = input.startsAt != null ? readDate(input.startsAt, "startsAt") : (existing && existing.startsAt);
  const endsAt = input.endsAt != null ? readDate(input.endsAt, "endsAt") : (existing && existing.endsAt);
  if (!startsAt || !endsAt) throw fail(400, "startsAt and endsAt are required.");
  if (endsAt <= startsAt) throw fail(400, "endsAt must be after startsAt.");
  const productArea = input.productArea != null ? readText(input.productArea, "productArea", 200, false) : (existing ? existing.productArea : "");
  const concept = input.concept != null ? readText(input.concept, "concept", 200, false) : (existing ? existing.concept : "");
  const curriculumRef = input.curriculumRef != null ? readText(input.curriculumRef, "curriculumRef", 200, false) : (existing ? existing.curriculumRef : "");
  if (type === "skill") {
    if (!productArea) throw fail(400, "productArea is required for skill sessions.");
    if (!concept) throw fail(400, "concept is required for skill sessions.");
    if (!curriculumRef) throw fail(400, "curriculumRef is required for skill sessions.");
  }
  return { type, title, startsAt, endsAt, productArea: type === "skill" ? productArea : "", concept: type === "skill" ? concept : "", curriculumRef: type === "skill" ? curriculumRef : "" };
}
async function createSession(input) {
  const owner = requireOwner(input.userId, input.emailHint);
  requireActor(input.actor);
  await ensureTable();
  try { return await db().outreachSession.create({ data: Object.assign({ userId: owner }, sessionFields(input, null)) }); }
  catch (err) { throw storeDown(err); }
}
async function updateSession({ id, userId, emailHint, actor, patch }) {
  const owner = requireOwner(userId, emailHint);
  requireActor(actor);
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  if (!Object.keys(source).length) throw fail(400, "Nothing to update.");
  await ensureTable();
  const row = await loadOwned("outreachSession", id, owner, "session");
  try { return await db().outreachSession.update({ where: { id: row.id }, data: sessionFields(Object.assign({}, row, source), row) }); }
  catch (err) { throw storeDown(err); }
}
async function getWeekSchedule({ userId, emailHint, weekStart, companyId, touchType } = {}) {
  const owner = requireOwner(userId, emailHint);
  await ensureTable();
  const monday = mondayOf(weekStart ? readDate(weekStart, "weekStart") : new Date());
  const friday = fridayOf(monday);
  const settings = await leads().getOutreachSettings({ userId: owner, emailHint });
  let sessions, allTouches, companyRows, leadRows;
  try {
    sessions = await db().outreachSession.findMany({ where: { userId: owner } });
    allTouches = await db().outreachTouch.findMany({ where: { userId: owner } });
    companyRows = await db().targetCompany.findMany({ where: { userId: owner } });
    leadRows = await db().lead.findMany({ where: { userId: owner } });
  } catch (err) { throw storeDown(err); }
  const closedLeadIds = new Set(
    (leadRows || []).filter((row) => row && row.stage === "closed").map((row) => row.id),
  );
  const openLeadsByCompany = new Map();
  for (const lead of leadRows || []) {
    if (!lead || lead.stage === "closed" || !lead.companyId) continue;
    if (!openLeadsByCompany.has(lead.companyId)) openLeadsByCompany.set(lead.companyId, 0);
    openLeadsByCompany.set(lead.companyId, openLeadsByCompany.get(lead.companyId) + 1);
  }
  const leadsByCompany = new Map();
  for (const lead of leadRows || []) {
    if (!lead || !lead.companyId) continue;
    if (!leadsByCompany.has(lead.companyId)) leadsByCompany.set(lead.companyId, []);
    leadsByCompany.get(lead.companyId).push(lead);
  }
  sessions = sessions.filter((row) => new Date(row.startsAt) <= friday && new Date(row.endsAt) >= monday)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  // Closed-lead follow-ups / planned touches do not drive the week view.
  let touches = allTouches.filter((row) => {
    if (row.leadId && closedLeadIds.has(row.leadId)) return false;
    return dayKey(row.date) >= dayKey(monday) && dayKey(row.date) <= dayKey(friday);
  });
  if (companyId) touches = touches.filter((row) => row.companyId === companyId);
  if (touchType) touches = touches.filter((row) => row.touchType === touchType);
  touches.sort((a, b) => new Date(a.date) - new Date(b.date) || a.touchType.localeCompare(b.touchType));
  const active = companyRows.filter((row) => row.status === "active");
  const northStar = active.find((row) => row.northStar) || null;
  const openByCompany = new Map();
  for (const touch of allTouches) {
    if (!OPEN_TOUCH.includes(touch.status)) continue;
    if (touch.leadId && closedLeadIds.has(touch.leadId)) continue;
    if (!openByCompany.has(touch.companyId) || new Date(touch.date) < new Date(openByCompany.get(touch.companyId).date)) {
      openByCompany.set(touch.companyId, touch);
    }
  }
  const companyMap = new Map(companyRows.map((row) => [row.id, row]));
  const withCompany = (touch) => ({
    touch: shape(touch),
    company: companyMap.has(touch.companyId) ? companies().presentCompany(companyMap.get(touch.companyId)) : null,
  });
  const busyEvents = await listBusyTimes({ userId: owner, emailHint, weekStart: monday });
  return {
    weekStart: iso(monday),
    weekEnd: iso(friday),
    curriculumName: settings.curriculumName || "",
    northStar: northStar ? companies().presentCompany(northStar) : null,
    companiesMissingTouch: active.filter((row) => {
      if (openByCompany.has(row.id)) return false;
      const companyLeads = leadsByCompany.get(row.id) || [];
      // Company whose leads are all closed is squared away — not "missing" a touch.
      if (companyLeads.length && !openLeadsByCompany.has(row.id)) return false;
      return true;
    }).map((row) => companies().presentCompany(row)),
    sessions: sessions.map((session) => ({
      session: shape(session),
      touches: touches.filter((touch) => touch.sessionId === session.id).map(withCompany),
    })),
    unscheduledTouches: touches.filter((touch) => !touch.sessionId).map(withCompany),
    busyEvents,
  };
}

async function listBusyTimes({ userId, emailHint, weekStart } = {}) {
  const owner = requireOwner(userId, emailHint);
  const monday = mondayOf(weekStart ? readDate(weekStart, "weekStart") : new Date());
  let row;
  try {
    row = await db().tinkerUserData.findUnique({
      where: { userId_kind: { userId: owner, kind: busyKind(monday) } },
    });
  } catch (err) { throw storeDown(err); }
  const blocks = row && row.data && Array.isArray(row.data.blocks) ? row.data.blocks : [];
  return blocks.map(presentBusyBlock);
}

async function setBusyTimes({ userId, emailHint, actor, weekStart, blocks } = {}) {
  const owner = requireOwner(userId, emailHint);
  requireWriteActor(actor);
  const monday = mondayOf(weekStart ? readDate(weekStart, "weekStart") : new Date());
  const normalized = readBusyBlocks(blocks);
  const payload = { weekStart: iso(monday), blocks: normalized };
  try {
    await db().tinkerUserData.upsert({
      where: { userId_kind: { userId: owner, kind: busyKind(monday) } },
      create: { userId: owner, kind: busyKind(monday), data: payload },
      update: { data: payload },
    });
  } catch (err) { throw storeDown(err); }
  return { weekStart: payload.weekStart, blocks: normalized.map(presentBusyBlock) };
}

/** Mark a lead's planned/drafted outreach touches skipped (close_lead). */
async function skipOpenTouchesForLead({ userId, emailHint, actor, leadId } = {}) {
  const owner = requireOwner(userId, emailHint);
  requireWriteActor(actor);
  const id = typeof leadId === "string" ? leadId.trim() : "";
  if (!id) throw fail(400, "leadId is required.");
  await ensureTable();
  let allTouches;
  try {
    allTouches = await db().outreachTouch.findMany({ where: { userId: owner, leadId: id } });
  } catch (err) { throw storeDown(err); }
  const open = (allTouches || []).filter((touch) => touch && OPEN_TOUCH.includes(touch.status));
  const skipped = [];
  for (const touch of open) {
    try {
      const saved = await db().outreachTouch.update({
        where: { id: touch.id },
        data: { status: "skipped" },
      });
      skipped.push(shape(saved));
    } catch (err) { throw storeDown(err); }
  }
  return skipped;
}

/** Open touches for the inbox: next planned/drafted touch per lead (and company-only). */
async function listInboxTouches({ userId, emailHint } = {}) {
  const owner = requireOwner(userId, emailHint);
  await ensureTable();
  let allTouches, companyRows, leadRows;
  try {
    allTouches = await db().outreachTouch.findMany({ where: { userId: owner } });
    companyRows = await db().targetCompany.findMany({ where: { userId: owner } });
    leadRows = await db().lead.findMany({ where: { userId: owner } });
  } catch (err) { throw storeDown(err); }
  const closedLeadIds = new Set(
    (leadRows || []).filter((row) => row && row.stage === "closed").map((row) => row.id),
  );
  const companyMap = new Map(companyRows.map((row) => [row.id, row]));
  const open = allTouches
    .filter((touch) => OPEN_TOUCH.includes(touch.status))
    .filter((touch) => !(touch.leadId && closedLeadIds.has(touch.leadId)))
    .sort((a, b) => new Date(a.date) - new Date(b.date) || a.touchType.localeCompare(b.touchType));
  const byLead = new Map();
  const companyOnly = [];
  for (const touch of open) {
    if (touch.leadId) {
      if (!byLead.has(touch.leadId)) byLead.set(touch.leadId, touch);
    } else {
      companyOnly.push(touch);
    }
  }
  const present = (touch) => ({
    touch: shape(touch),
    company: companyMap.has(touch.companyId) ? companies().presentCompany(companyMap.get(touch.companyId)) : null,
  });
  const monday = mondayOf(new Date());
  const busyEvents = await listBusyTimes({ userId: owner, emailHint, weekStart: monday });
  return {
    byLeadId: Object.fromEntries([...byLead.entries()].map(([id, touch]) => [id, present(touch)])),
    companyTouches: companyOnly.map(present),
    busyEvents,
  };
}

/** Nudge a planned date off a busy weekday when the day is mostly covered; otherwise keep it. */
function nudgeOffBusyDay(isoDate, busyEvents) {
  if (!isoDate) return { date: isoDate, nudged: false };
  const start = new Date(isoDate);
  if (Number.isNaN(start.getTime())) return { date: isoDate, nudged: false };
  const blocks = Array.isArray(busyEvents) ? busyEvents : [];
  function dayBusyHours(day) {
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0));
    const dayEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999));
    let ms = 0;
    for (const block of blocks) {
      const a = new Date(block.startsAt);
      const b = new Date(block.endsAt);
      const from = Math.max(a.getTime(), dayStart.getTime());
      const to = Math.min(b.getTime(), dayEnd.getTime());
      if (to > from) ms += to - from;
    }
    return ms / 3600000;
  }
  // Trivial nudge: only when >= 6 hours busy that weekday.
  if (dayBusyHours(start) < 6) return { date: iso(start), nudged: false };
  for (let i = 1; i <= 5; i++) {
    const next = new Date(start);
    next.setUTCDate(next.getUTCDate() + i);
    const dow = next.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (dayBusyHours(next) < 6) return { date: iso(next), nudged: true };
  }
  return { date: iso(start), nudged: false };
}

module.exports = {
  UNAVAILABLE, TABLE_STATEMENTS, TOUCH_TYPES, TOUCH_STATUSES, SESSION_TYPES, BUSY_KIND_PREFIX,
  ensureTable, resetTableCache, presentTouch: shape, presentSession: shape,
  createTouch, updateTouch, createSession, updateSession, getWeekSchedule,
  listBusyTimes, setBusyTimes, listInboxTouches, skipOpenTouchesForLead,
  nudgeOffBusyDay, mondayOf, fridayOf,
};
