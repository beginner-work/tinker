/* Leads and drafts. Tinker never sends; sent_by_owner is a mark only. */
"use strict";

const SOURCES = ["referral", "formation", "linkedin", "posting", "event", "other"];
const STAGES = ["new", "drafting", "contacted", "replied", "call", "interview", "offer", "closed"];
const OUTCOMES = ["replied", "call", "interview", "offer"];
const CHANNELS = ["email", "linkedin_note", "linkedin_message"];
const DRAFT_STATUSES = ["draft", "approved", "sent_by_owner"];
const UNAVAILABLE = "Leads are unavailable right now.";
const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "Lead" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "personName" TEXT NOT NULL DEFAULT '', "personTitle" TEXT NOT NULL DEFAULT '', "linkedInUrl" TEXT NOT NULL DEFAULT '', "email" TEXT NOT NULL DEFAULT '', "company" TEXT NOT NULL DEFAULT '', "targetRoleTitle" TEXT NOT NULL DEFAULT '', "postingUrl" TEXT NOT NULL DEFAULT '', "source" TEXT NOT NULL, "stage" TEXT NOT NULL, "nextStep" TEXT NOT NULL DEFAULT '', "nextStepAt" TIMESTAMP(3), "notes" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Lead_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "Lead_userId_idx" ON "Lead"("userId")`,
  `CREATE INDEX IF NOT EXISTS "Lead_userId_stage_idx" ON "Lead"("userId", "stage")`,
  `CREATE TABLE IF NOT EXISTS "LeadDraft" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "leadId" TEXT NOT NULL, "channel" TEXT NOT NULL, "subject" TEXT NOT NULL DEFAULT '', "body" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL, "storyPartIds" JSONB NOT NULL DEFAULT '[]', "factCheck" JSONB NOT NULL DEFAULT '{}', "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "LeadDraft_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "LeadDraft_userId_idx" ON "LeadDraft"("userId")`,
  `CREATE INDEX IF NOT EXISTS "LeadDraft_leadId_idx" ON "LeadDraft"("leadId")`,
  `CREATE TABLE IF NOT EXISTS "LeadEvent" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "leadId" TEXT NOT NULL, "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "detail" JSONB NOT NULL DEFAULT '{}', "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "LeadEvent_userId_idx" ON "LeadEvent"("userId")`,
  `CREATE INDEX IF NOT EXISTS "LeadEvent_leadId_idx" ON "LeadEvent"("leadId")`,
];
const HEADER_MAP = {
  name: "personName", personname: "personName", person: "personName", title: "personTitle", persontitle: "personTitle",
  linkedin: "linkedInUrl", linkedinurl: "linkedInUrl", url: "linkedInUrl", email: "email", company: "company",
  role: "targetRoleTitle", targetrole: "targetRoleTitle", targetroletitle: "targetRoleTitle",
  posting: "postingUrl", postingurl: "postingUrl", source: "source", notes: "notes",
};

let ensuring = null;
const db = () => require("./db.js");
const fail = (status, message) => Object.assign(new Error(message), { status });
function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) throw fail(401, "Sign in to tinker first.");
  return userId.trim();
}
function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
}
function actorLabel(actor) {
  const label = actor && typeof actor.label === "string" ? actor.label.trim() : "";
  const kind = actor && actor.kind;
  const ok = (kind === "human" && /^user:\S/.test(label)) || (kind === "bot" && /^bot:\S/.test(label)) || (kind === "system" && label === "system");
  if (!ok) throw fail(401, "Missing actor.");
  return label;
}
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
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") throw fail(400, `${label} must be a date.`);
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) throw fail(400, `${label} must be a date.`);
  return parsed;
}
function readIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw fail(400, "storyPartIds must be a list of strings.");
  return value.map((item) => item.trim()).filter(Boolean);
}
function readFactCheck(value) {
  if (value == null || value === "") return {};
  if (typeof value !== "object" || Array.isArray(value)) throw fail(400, "factCheck must be an object.");
  return value;
}
function iso(value) { return value ? new Date(value).toISOString() : null; }
function shape(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "userId") continue;
    out[key] = value instanceof Date ? iso(value) : value;
  }
  return out;
}
async function ensureTable() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    for (const statement of TABLE_STATEMENTS) await db().$executeRawUnsafe(statement);
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare the leads tables."), { status: 503, cause: err });
  });
  return ensuring;
}
function resetTableCache() { ensuring = null; }
async function commit(fn) {
  try { return await db().$transaction(fn); }
  catch (err) { if (err && err.status) throw err; throw storeDown(err); }
}
async function loadOwned(model, id, userId, label) {
  if (typeof id !== "string" || !id.trim()) throw fail(400, `${label} id is required.`);
  let row;
  try { row = await db()[model].findUnique({ where: { id: id.trim() } }); }
  catch (err) { throw storeDown(err); }
  if (!row || row.userId !== userId) throw fail(404, `No ${label} with that id.`);
  return row;
}
async function record(tx, fields) {
  return tx.leadEvent.create({
    data: { userId: fields.userId, leadId: fields.leadId, actor: fields.actor, action: fields.action, detail: fields.detail || {}, at: fields.at || new Date() },
  });
}
function leadFields(input, requireName) {
  return {
    personName: readText(input.personName, "personName", 200, !!requireName),
    personTitle: readText(input.personTitle, "personTitle", 200, false),
    linkedInUrl: readText(input.linkedInUrl, "linkedInUrl", 500, false),
    email: readText(input.email, "email", 320, false).toLowerCase(),
    company: readText(input.company, "company", 200, false),
    targetRoleTitle: readText(input.targetRoleTitle, "targetRoleTitle", 200, false),
    postingUrl: readText(input.postingUrl, "postingUrl", 500, false),
    source: readEnum(input.source || "other", SOURCES, "source"),
    nextStep: readText(input.nextStep, "nextStep", 500, false),
    nextStepAt: readDate(input.nextStepAt, "nextStepAt"),
    notes: readText(input.notes, "notes", 8000, false),
  };
}

async function createLead(input) {
  const owner = requireUserId(input.userId);
  const actor = actorLabel(input.actor);
  const stage = input.stage == null || input.stage === "" ? "new" : readEnum(input.stage, STAGES, "stage");
  const data = Object.assign({ userId: owner, stage }, leadFields(input, true));
  await ensureTable();
  return commit(async (tx) => {
    const saved = await tx.lead.create({ data });
    await record(tx, { userId: owner, leadId: saved.id, actor, action: "created", detail: { stage, source: data.source } });
    return saved;
  });
}
async function listLeads({ userId, stage, company } = {}) {
  const owner = requireUserId(userId);
  await ensureTable();
  let rows;
  try { rows = await db().lead.findMany({ where: { userId: owner } }); }
  catch (err) { throw storeDown(err); }
  const companyFilter = company ? String(company).trim().toLowerCase() : "";
  rows = rows.filter((row) => (!stage || row.stage === stage) && (!companyFilter || String(row.company || "").toLowerCase() === companyFilter));
  rows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return rows;
}
async function getLead({ id, userId }) {
  const owner = requireUserId(userId);
  await ensureTable();
  const lead = await loadOwned("lead", id, owner, "lead");
  let drafts;
  try { drafts = await db().leadDraft.findMany({ where: { userId: owner, leadId: lead.id } }); }
  catch (err) { throw storeDown(err); }
  drafts.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return { lead, drafts };
}
async function updateLead({ id, userId, actor, patch }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const keys = ["personName", "personTitle", "linkedInUrl", "email", "company", "targetRoleTitle", "postingUrl", "source", "nextStep", "nextStepAt", "notes"]
    .filter((key) => Object.prototype.hasOwnProperty.call(source, key));
  if (!keys.length) throw fail(400, "Nothing to update.");
  await ensureTable();
  const row = await loadOwned("lead", id, owner, "lead");
  const data = {};
  for (const key of keys) {
    if (key === "source") data.source = readEnum(source.source, SOURCES, "source");
    else if (key === "nextStepAt") data.nextStepAt = readDate(source.nextStepAt, "nextStepAt");
    else if (key === "email") data.email = readText(source.email, "email", 320, false).toLowerCase();
    else if (key === "personName") data.personName = readText(source.personName, "personName", 200, true);
    else if (key === "notes") data.notes = readText(source.notes, "notes", 8000, false);
    else if (key === "linkedInUrl" || key === "postingUrl") data[key] = readText(source[key], key, 500, false);
    else if (key === "nextStep") data.nextStep = readText(source.nextStep, "nextStep", 500, false);
    else data[key] = readText(source[key], key, 200, false);
  }
  return commit(async (tx) => {
    const saved = await tx.lead.update({ where: { id: row.id }, data });
    await record(tx, { userId: owner, leadId: row.id, actor: label, action: "edited", detail: { fields: keys } });
    return saved;
  });
}
async function setStage({ id, userId, actor, stage, outcome }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  const next = outcome != null && outcome !== "" ? readEnum(outcome, OUTCOMES, "outcome") : readEnum(stage, STAGES, "stage");
  await ensureTable();
  const row = await loadOwned("lead", id, owner, "lead");
  if (row.stage === next) throw fail(400, "Nothing to update.");
  const action = OUTCOMES.includes(next) ? "outcome" : "stage_changed";
  return commit(async (tx) => {
    const saved = await tx.lead.update({ where: { id: row.id }, data: { stage: next } });
    const event = await record(tx, { userId: owner, leadId: row.id, actor: label, action, detail: { from: row.stage, to: next, outcome: !!outcome } });
    return { lead: saved, event };
  });
}

function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((cell) => cell.trim());
}
function parseImportText(text) {
  const raw = readText(text, "text", 200000, true);
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw fail(400, "text is required.");
  const first = splitCsvLine(lines[0]);
  const headers = first.map((h) => HEADER_MAP[h.toLowerCase().replace(/[^a-z0-9]/g, "")]);
  const hasHeader = headers.filter(Boolean).length >= 2;
  const rows = [];
  if (hasHeader) {
    for (const line of lines.slice(1)) {
      const cells = splitCsvLine(line);
      const row = {};
      headers.forEach((key, i) => { if (key && cells[i] != null) row[key] = cells[i]; });
      if (row.personName || row.company || row.email || row.linkedInUrl) rows.push(row);
    }
  } else {
    for (const line of lines) {
      const cells = splitCsvLine(line);
      if (cells.length === 1) rows.push({ personName: cells[0] });
      else rows.push({ personName: cells[0] || "", personTitle: cells[1] || "", company: cells[2] || "", email: cells[3] || "", linkedInUrl: cells[4] || "", source: cells[5] || "other" });
    }
  }
  if (!rows.length) throw fail(400, "No leads found in text.");
  return rows;
}
async function importLeads({ userId, actor, text }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  const rows = parseImportText(text);
  await ensureTable();
  return commit(async (tx) => {
    const created = [];
    for (const row of rows) {
      const data = Object.assign({ userId: owner, stage: "new" }, leadFields(row, true));
      const saved = await tx.lead.create({ data });
      await record(tx, { userId: owner, leadId: saved.id, actor: label, action: "imported", detail: { source: data.source } });
      created.push(saved);
    }
    return created;
  });
}

async function createDraft(input) {
  const owner = requireUserId(input.userId);
  const actor = actorLabel(input.actor);
  const channel = readEnum(input.channel, CHANNELS, "channel");
  const subject = channel === "email" ? readText(input.subject, "subject", 300, false) : "";
  if (channel !== "email" && input.subject != null && String(input.subject).trim()) throw fail(400, "subject is only for email.");
  await ensureTable();
  const lead = await loadOwned("lead", input.leadId, owner, "lead");
  const data = {
    userId: owner, leadId: lead.id, channel, subject, body: readText(input.body, "body", 100000, false),
    status: "draft", storyPartIds: readIds(input.storyPartIds), factCheck: readFactCheck(input.factCheck), createdBy: actor,
  };
  return commit(async (tx) => {
    const saved = await tx.leadDraft.create({ data });
    const updatedLead = lead.stage === "new" ? await tx.lead.update({ where: { id: lead.id }, data: { stage: "drafting" } }) : lead;
    await record(tx, { userId: owner, leadId: lead.id, actor, action: "draft_created", detail: { draftId: saved.id, channel, from: lead.stage, to: updatedLead.stage } });
    return { draft: saved, lead: updatedLead };
  });
}
async function updateDraft({ id, userId, actor, patch }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const keys = ["subject", "body", "storyPartIds", "factCheck"].filter((key) => Object.prototype.hasOwnProperty.call(source, key));
  if (!keys.length) throw fail(400, "Nothing to update.");
  await ensureTable();
  const row = await loadOwned("leadDraft", id, owner, "draft");
  if (row.status === "sent_by_owner") throw fail(400, "A sent draft cannot be edited.");
  const data = {};
  if (keys.includes("body")) data.body = readText(source.body, "body", 100000, false);
  if (keys.includes("storyPartIds")) data.storyPartIds = readIds(source.storyPartIds);
  if (keys.includes("factCheck")) data.factCheck = readFactCheck(source.factCheck);
  if (keys.includes("subject")) {
    if (row.channel !== "email") throw fail(400, "subject is only for email.");
    data.subject = readText(source.subject, "subject", 300, false);
  }
  if (row.status === "approved") data.status = "draft";
  return commit(async (tx) => {
    const saved = await tx.leadDraft.update({ where: { id: row.id }, data });
    await record(tx, { userId: owner, leadId: row.leadId, actor: label, action: "draft_edited", detail: { draftId: row.id, fields: keys } });
    return saved;
  });
}
async function approveDraft({ id, userId, actor }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  await ensureTable();
  const row = await loadOwned("leadDraft", id, owner, "draft");
  if (row.status !== "draft") throw fail(400, "Only a draft can be approved.");
  return commit(async (tx) => {
    const saved = await tx.leadDraft.update({ where: { id: row.id }, data: { status: "approved" } });
    const event = await record(tx, { userId: owner, leadId: row.leadId, actor: label, action: "draft_approved", detail: { draftId: row.id } });
    return { draft: saved, event };
  });
}
async function markDraftSent({ id, userId, actor }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  await ensureTable();
  const row = await loadOwned("leadDraft", id, owner, "draft");
  if (row.status === "sent_by_owner") throw fail(400, "Nothing to update.");
  if (row.status !== "approved" && row.status !== "draft") throw fail(400, "Only a draft or approved draft can be marked sent.");
  const lead = await loadOwned("lead", row.leadId, owner, "lead");
  return commit(async (tx) => {
    const saved = await tx.leadDraft.update({ where: { id: row.id }, data: { status: "sent_by_owner" } });
    const updatedLead = (lead.stage === "new" || lead.stage === "drafting")
      ? await tx.lead.update({ where: { id: lead.id }, data: { stage: "contacted" } }) : lead;
    const event = await record(tx, {
      userId: owner, leadId: lead.id, actor: label, action: "draft_sent_by_owner",
      detail: { draftId: row.id, from: lead.stage, to: updatedLead.stage },
    });
    return { draft: saved, lead: updatedLead, event };
  });
}

module.exports = {
  UNAVAILABLE, TABLE_STATEMENTS, SOURCES, STAGES, OUTCOMES, CHANNELS, DRAFT_STATUSES,
  ensureTable, resetTableCache, presentLead: shape, presentDraft: shape, presentEvent: shape,
  parseImportText, createLead, listLeads, getLead, updateLead, setStage, importLeads,
  createDraft, updateDraft, approveDraft, markDraftSent,
};
