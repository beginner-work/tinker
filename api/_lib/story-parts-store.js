/* Story parts. Stages are fixed. sourceRef for code is {repo, path, ref, evidence}.
 * concepts and stack are tag lists. stack is stored, not a list filter.
 */
"use strict";

const STAGES = [
  { key: "hook", name: "Hook", description: "A line or short story that makes someone curious.", position: 0, retired: false },
  { key: "proof_point", name: "Proof point", description: "One claim with a starting point, a number, and a cause (from X to Y because Z).", position: 1, retired: false },
  { key: "connecting_story", name: "Connecting story", description: "The thread through a career, in lengths from one line to a paragraph.", position: 2, retired: false },
  { key: "fit", name: "Fit", description: "Why you for a particular kind of team or role.", position: 3, retired: false },
  { key: "ask", name: "Ask", description: "The specific, low-friction request at the end.", position: 4, retired: false },
];
const SOURCE_KINDS = ["note", "concept", "narrative", "content_item", "career_record", "code", "none"];
const STATUSES = ["draft", "ready", "retired"];
const UNAVAILABLE = "Story parts are unavailable right now.";
const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "StoryPart" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "stageKey" TEXT NOT NULL, "title" TEXT NOT NULL DEFAULT '', "body" TEXT NOT NULL DEFAULT '', "fields" JSONB NOT NULL DEFAULT '{}', "topics" JSONB NOT NULL DEFAULT '[]', "stack" JSONB NOT NULL DEFAULT '[]', "concepts" JSONB NOT NULL DEFAULT '[]', "status" TEXT NOT NULL, "sourceKind" TEXT NOT NULL, "sourceId" TEXT, "sourceRef" JSONB NOT NULL DEFAULT '{}', "sourceExcerpt" TEXT NOT NULL DEFAULT '', "sourceHash" TEXT, "checkVerdicts" JSONB NOT NULL DEFAULT '[]', "checkedAt" TIMESTAMP(3), "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "StoryPart_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "StoryPart_userId_idx" ON "StoryPart"("userId")`,
  `CREATE TABLE IF NOT EXISTS "StoryPartEvent" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "partId" TEXT NOT NULL, "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "detail" JSONB NOT NULL DEFAULT '{}', "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "StoryPartEvent_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "StoryPartEvent_userId_idx" ON "StoryPartEvent"("userId")`,
  `CREATE INDEX IF NOT EXISTS "StoryPartEvent_partId_idx" ON "StoryPartEvent"("partId")`,
];

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
  if (value == null || value === "") {
    if (required) throw fail(400, `${label} is required.`);
    return "";
  }
  if (typeof value !== "string") throw fail(400, `${label} must be a string.`);
  const text = value.trim();
  if (required && !text) throw fail(400, `${label} is required.`);
  if (text.length > max) throw fail(400, `${label} is limited to ${max} characters.`);
  return text;
}
function readList(value, label, lower) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw fail(400, `${label} must be a list of strings.`);
  return value.map((item) => (lower ? item.trim().toLowerCase() : item.trim())).filter(Boolean);
}
function slug(text, strict) {
  const item = String(text || "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item)) { if (strict) throw fail(400, "concepts must be kebab-case."); return ""; }
  return item;
}
function readSlugs(value) { return readList(value, "concepts").map((item) => slug(item, true)); }
function readRef(kind, value) {
  if (kind !== "code") return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(400, "sourceRef must be an object.");
  const repo = readText(value.repo, "repo", 200, true);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw fail(400, "repo must be owner/name.");
  return { repo, path: readText(value.path, "path", 500, false), ref: readText(value.ref, "ref", 80, false), evidence: readList(value.evidence, "evidence").map((item) => readText(item, "evidence", 500, true)) };
}
function readEnum(value, allowed, label) {
  const found = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!allowed.includes(found)) throw fail(400, `${label} must be ${allowed.join(" or ")}.`);
  return found;
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
function stageKeyOf(value) {
  const key = readText(value, "stageKey", 40, true);
  if (!STAGES.some((stage) => stage.key === key)) throw fail(400, "Unknown stage.");
  return key;
}
function readFields(stageKey, value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw fail(400, "fields must be an object.");
  const pick = (keys) => {
    const out = {};
    for (const key of keys) out[key] = readText(value[key], key, 500, false);
    return out;
  };
  if (stageKey === "proof_point") return pick(["start", "number", "cause"]);
  if (stageKey === "fit") return { teamOrRole: readText(value.teamOrRole, "teamOrRole", 200, false) };
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw fail(400, "fields must be strings.");
    out[key] = item.trim();
  }
  return out;
}
async function ensureTable() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    for (const statement of TABLE_STATEMENTS) await db().$executeRawUnsafe(statement);
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare the story parts tables."), { status: 503, cause: err });
  });
  return ensuring;
}
function resetTableCache() { ensuring = null; }
async function commit(fn) {
  try { return await db().$transaction(fn); }
  catch (err) { if (err && err.status) throw err; throw storeDown(err); }
}
async function loadOwned(id, userId) {
  if (typeof id !== "string" || !id.trim()) throw fail(400, "part id is required.");
  let row;
  try { row = await db().storyPart.findUnique({ where: { id: id.trim() } }); }
  catch (err) { throw storeDown(err); }
  if (!row || row.userId !== userId) throw fail(404, "No part with that id.");
  return row;
}
function getStages() {
  return STAGES.map((stage) => ({ ...stage }));
}
async function record(tx, fields) {
  return tx.storyPartEvent.create({
    data: {
      userId: fields.userId, partId: fields.partId, actor: fields.actor, action: fields.action,
      detail: fields.detail || {}, at: fields.at || new Date(),
    },
  });
}
async function createPart(input) {
  const owner = requireUserId(input.userId);
  const actor = actorLabel(input.actor);
  if (input.status != null && input.status !== "" && input.status !== "draft") throw fail(400, "A new part starts as a draft.");
  const sourceKind = readEnum(input.sourceKind || "none", SOURCE_KINDS, "sourceKind");
  const sourceId = sourceKind === "none" || sourceKind === "code" ? (readText(input.sourceId, "sourceId", 200, false) || null) : readText(input.sourceId, "sourceId", 200, true);
  const stageKey = stageKeyOf(input.stageKey);
  await ensureTable();
  const data = {
    userId: owner, stageKey, title: readText(input.title, "title", 200, true),
    body: readText(input.body, "body", 8000, false), fields: readFields(stageKey, input.fields),
    topics: readList(input.topics, "topics"), stack: readList(input.stack, "stack", true), concepts: readSlugs(input.concepts), status: "draft", sourceKind, sourceId,
    sourceRef: readRef(sourceKind, input.sourceRef), sourceExcerpt: readText(input.sourceExcerpt, "sourceExcerpt", 500, false),
    sourceHash: readText(input.sourceHash, "sourceHash", 128, false) || null,
    checkVerdicts: [], createdBy: actor,
  };
  return commit(async (tx) => {
    const saved = await tx.storyPart.create({ data });
    await record(tx, { userId: owner, partId: saved.id, actor, action: "created", detail: { stageKey, sourceKind } });
    return saved;
  });
}
async function listParts({ userId, stage, topic, status, sourceKind, concepts, teamOrRole, limit } = {}) {
  const owner = requireUserId(userId);
  await ensureTable();
  let rows;
  try { rows = await db().storyPart.findMany({ where: { userId: owner } }); }
  catch (err) { throw storeDown(err); }
  const role = typeof teamOrRole === "string" ? teamOrRole.trim().toLowerCase() : "";
  rows = rows.filter((row) => (!stage || row.stageKey === stage) && (!status || row.status === status)
    && (!sourceKind || row.sourceKind === sourceKind)
    && (!topic || (Array.isArray(row.topics) && row.topics.includes(topic)))
    && (!concepts || (Array.isArray(row.concepts) && row.concepts.includes(slug(concepts))))
    && (!role || String((row.fields && row.fields.teamOrRole) || "").toLowerCase() === role));
  rows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : rows.length;
  return rows.slice(0, cap);
}
async function getPart({ id, userId }) {
  const owner = requireUserId(userId);
  await ensureTable();
  return loadOwned(id, owner);
}
async function updatePart({ id, userId, actor, patch }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const keys = ["title", "body", "fields", "topics", "stack", "concepts", "stageKey", "sourceExcerpt", "sourceRef"].filter((key) =>
    Object.prototype.hasOwnProperty.call(source, key));
  if (!keys.length) throw fail(400, "Nothing to update.");
  await ensureTable();
  const row = await loadOwned(id, owner);
  const data = {};
  if (keys.includes("title")) data.title = readText(source.title, "title", 200, true);
  if (keys.includes("body")) data.body = readText(source.body, "body", 8000, false);
  if (keys.includes("topics")) data.topics = readList(source.topics, "topics");
  if (keys.includes("stack")) data.stack = readList(source.stack, "stack", true);
  if (keys.includes("concepts")) data.concepts = readSlugs(source.concepts);
  if (keys.includes("sourceRef")) data.sourceRef = readRef(row.sourceKind, source.sourceRef);
  if (keys.includes("sourceExcerpt")) data.sourceExcerpt = readText(source.sourceExcerpt, "sourceExcerpt", 500, false);
  if (keys.includes("stageKey")) data.stageKey = stageKeyOf(source.stageKey);
  if (keys.includes("fields")) data.fields = readFields(data.stageKey || row.stageKey, source.fields);
  const demote = row.status === "ready" && (keys.includes("body") || keys.includes("fields"));
  if (demote) data.status = "draft";
  const now = new Date();
  return commit(async (tx) => {
    const saved = await tx.storyPart.update({ where: { id: row.id }, data });
    await record(tx, {
      userId: owner, partId: row.id, actor: label, at: now,
      action: keys.length === 1 && keys[0] === "stageKey" ? "stage_changed" : "edited",
      detail: { fields: keys, from: row.status, to: saved.status },
    });
    return saved;
  });
}
async function setStatus({ id, userId, actor, status }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  const next = readEnum(status, STATUSES, "status");
  await ensureTable();
  const row = await loadOwned(id, owner);
  if (row.status === next) throw fail(400, "Nothing to update.");
  let verdict = null;
  let checkData = {};
  if (next === "ready" && row.stageKey === "proof_point") {
    try { verdict = await runFactGate({ userId: owner, text: checkTextFor(row) }); }
    catch (err) {
      if (err && err.status) throw err;
      throw fail(503, "Could not check that part against the career record.");
    }
    const nowCheck = new Date();
    checkData = { checkVerdicts: (verdict && verdict.claims) || [], checkedAt: nowCheck };
    if (!(verdict && verdict.ready)) {
      await commit(async (tx) => {
        await tx.storyPart.update({ where: { id: row.id }, data: checkData });
        await record(tx, {
          userId: owner, partId: row.id, actor: label, action: "checked",
          detail: { ready: false, stageKey: row.stageKey }, at: nowCheck,
        });
      });
      throw Object.assign(new Error("Proof point failed the fact check."), {
        status: 400, code: "fact_gate", verdict, part: Object.assign({}, row, checkData),
      });
    }
  }
  const action = next === "ready" ? "ready" : next === "retired" ? "retired" : "edited";
  const now = new Date();
  return commit(async (tx) => {
    const saved = await tx.storyPart.update({
      where: { id: row.id },
      data: Object.assign({ status: next }, checkData),
    });
    const event = await record(tx, {
      userId: owner, partId: row.id, actor: label, action, detail: { from: row.status, to: next }, at: now,
    });
    return { part: saved, event, verdict };
  });
}

let factGateImpl = null;
function setFactGate(fn) { factGateImpl = typeof fn === "function" ? fn : null; }
function checkTextFor(row) {
  const fields = row.fields && typeof row.fields === "object" ? row.fields : {};
  const bits = [row.body || ""];
  if (row.stageKey === "proof_point") {
    for (const key of ["start", "number", "cause"]) {
      if (fields[key]) bits.push(String(fields[key]));
    }
  }
  return bits.filter((bit) => bit && String(bit).trim()).join("\n");
}
async function runFactGate({ userId, text }) {
  if (factGateImpl) return factGateImpl({ userId, text });
  const { readForTool } = require("./career.js");
  const { checkText } = require("./career-check.js");
  const record = await readForTool(userId);
  return checkText({ record, text: text || "", field_label: "story_part" });
}

function presentMcp(row) {
  const out = {
    id: row.id,
    stage: row.stageKey,
    title: row.title,
    body: row.body,
    fields: row.fields || {},
    topics: row.topics || [],
    concepts: row.concepts || [],
    stack: row.stack || [],
    status: row.status,
    sourceExcerpt: row.sourceExcerpt || "",
    source: { kind: row.sourceKind, id: row.sourceId || null },
    checkVerdicts: row.checkVerdicts || [],
    checkedAt: iso(row.checkedAt),
  };
  if (row.sourceKind === "code") {
    const ref = row.sourceRef && typeof row.sourceRef === "object" ? row.sourceRef : {};
    out.sourceRef = {
      repo: ref.repo || "",
      path: ref.path || "",
      ref: ref.ref || "",
      evidence: Array.isArray(ref.evidence) ? ref.evidence : [],
    };
  }
  return out;
}

module.exports = {
  UNAVAILABLE, TABLE_STATEMENTS, STAGES, ensureTable, resetTableCache, setFactGate, runFactGate, checkTextFor,
  presentPart: shape, presentEvent: shape, presentMcp,
  getStages, createPart, listParts, getPart, updatePart, setStatus,
};
