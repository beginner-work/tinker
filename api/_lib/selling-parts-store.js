/* Selling parts. sourceRef for code is {repo, path, ref, evidence}. concepts and stack are tag lists. */
"use strict";

const crypto = require("crypto");

const STAGES_KIND = "selling-stages";
const SOURCE_KINDS = ["note", "concept", "narrative", "content_item", "career_record", "code", "none"];
const STATUSES = ["draft", "ready", "retired"];
const SEED_STAGES = [
  { key: "hook", name: "Hook", description: "A line or short story that makes someone curious.", position: 0, retired: false },
  { key: "proof_point", name: "Proof point", description: "One claim with a starting point, a number, and a cause (from X to Y because Z).", position: 1, retired: false },
  { key: "connecting_story", name: "Connecting story", description: "The thread through Tyler's path (nanoengineering to learning sciences to fintech to people management as his core product), in lengths from one line to a paragraph.", position: 2, retired: false },
  { key: "fit", name: "Fit", description: "Why Tyler for a particular kind of team or role.", position: 3, retired: false },
  { key: "ask", name: "Ask", description: "The specific, low-friction request at the end.", position: 4, retired: false },
];
const UNAVAILABLE = "Selling parts are unavailable right now.";
const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "SellingPart" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "stageKey" TEXT NOT NULL, "title" TEXT NOT NULL DEFAULT '', "body" TEXT NOT NULL DEFAULT '', "fields" JSONB NOT NULL DEFAULT '{}', "topics" JSONB NOT NULL DEFAULT '[]', "stack" JSONB NOT NULL DEFAULT '[]', "concepts" JSONB NOT NULL DEFAULT '[]', "status" TEXT NOT NULL, "sourceKind" TEXT NOT NULL, "sourceId" TEXT, "sourceRef" JSONB NOT NULL DEFAULT '{}', "sourceExcerpt" TEXT NOT NULL DEFAULT '', "sourceHash" TEXT, "checkVerdicts" JSONB NOT NULL DEFAULT '[]', "checkedAt" TIMESTAMP(3), "draftKey" TEXT, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SellingPart_pkey" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SellingPart_userId_draftKey_key" ON "SellingPart"("userId", "draftKey")`,
  `CREATE INDEX IF NOT EXISTS "SellingPart_userId_idx" ON "SellingPart"("userId")`,
  `CREATE TABLE IF NOT EXISTS "SellingPartEvent" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "partId" TEXT NOT NULL, "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "detail" JSONB NOT NULL DEFAULT '{}', "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SellingPartEvent_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "SellingPartEvent_userId_idx" ON "SellingPartEvent"("userId")`,
  `CREATE INDEX IF NOT EXISTS "SellingPartEvent_partId_idx" ON "SellingPartEvent"("partId")`,
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
  const ok = (kind === "human" && /^tyler:\S/.test(label)) || (kind === "bot" && /^bot:\S/.test(label)) || (kind === "system" && label === "system");
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
function hashText(text) { return crypto.createHash("sha256").update(String(text), "utf8").digest("hex"); }
function bits(list) {
  const text = list.filter((bit) => typeof bit === "string" && bit.trim()).map((bit) => bit.trim()).join("\n");
  return text || null;
}
function textOf(item) {
  if (!item || typeof item !== "object") return null;
  const list = [item.title, item.body, item.value];
  if (Array.isArray(item.stories)) for (const story of item.stories) list.push(story && story.body);
  return bits(list);
}
function located(data, id) {
  if (!data || typeof data !== "object") return null;
  for (const list of [data, data.concepts, data.taxonomy, data.items]) {
    if (!Array.isArray(list)) continue;
    const found = list.find((item) => item && item.id === id);
    if (found) return found;
  }
  return null;
}
async function ensureTable() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    for (const statement of TABLE_STATEMENTS) await db().$executeRawUnsafe(statement);
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare the selling parts tables."), { status: 503, cause: err });
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
  try { row = await db().sellingPart.findUnique({ where: { id: id.trim() } }); }
  catch (err) { throw storeDown(err); }
  if (!row || row.userId !== userId) throw fail(404, "No part with that id.");
  return row;
}
async function readBlob(userId, kind) {
  try {
    const row = await db().tinkerUserData.findUnique({ where: { userId_kind: { userId, kind } } });
    return row ? row.data : null;
  } catch { return null; }
}
async function sourceText(userId, kind, sourceId) {
  if (!sourceId || kind === "none" || kind === "code") return null;
  try {
    if (kind === "content_item") {
      const row = await db().contentItem.findUnique({ where: { id: sourceId } });
      return row && row.userId === userId ? textOf(row) : null;
    }
    if (kind === "career_record") {
      const record = await require("./career.js").readRecord(userId);
      const fact = ((record && record.facts) || []).find((item) => item.id === sourceId);
      return fact ? bits([fact.value, fact.baseline, fact.mechanism]) : null;
    }
    if (kind === "note") {
      for (const blobKind of ["drafts", "essays"]) {
        const data = await readBlob(userId, blobKind);
        const found = (Array.isArray(data) ? data : []).find((item) => item && item.id === sourceId);
        if (found) return textOf(found);
      }
      return null;
    }
    const data = await readBlob(userId, kind === "narrative" ? "pitches" : "taxonomy");
    const found = kind === "narrative"
      ? ((data && data.pitches) || []).find((item) => item && item.id === sourceId)
      : located(data, sourceId);
    return found ? textOf(found) : null;
  } catch { return null; }
}
async function changedFlag(userId, row) {
  const text = await sourceText(userId, row.sourceKind, row.sourceId);
  if (!text) return null;
  return hashText(text) !== (row.sourceHash || "");
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
function stageKeyOf(value, stages) {
  const key = readText(value, "stageKey", 40, true);
  if (!/^[a-z][a-z0-9_]*$/.test(key)) throw fail(400, "stageKey must be a stage key.");
  if (!stages.some((stage) => stage.key === key)) throw fail(400, "Unknown stage.");
  return key;
}
function normalizeStages(list) {
  return list.map((stage) => ({
    key: stage.key, name: stage.name, description: stage.description || "",
    position: stage.position, retired: stage.retired === true,
  })).sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}
async function readStageRow(userId) {
  try { return await db().tinkerUserData.findUnique({ where: { userId_kind: { userId, kind: STAGES_KIND } } }); }
  catch (err) { throw storeDown(err); }
}
async function saveStages(userId, stages) {
  const data = { stages: normalizeStages(stages) };
  try {
    await db().tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: STAGES_KIND } },
      create: { userId, kind: STAGES_KIND, data },
      update: { data },
    });
  } catch (err) { throw storeDown(err); }
  return data.stages;
}
async function getStages({ userId }) {
  const owner = requireUserId(userId);
  const row = await readStageRow(owner);
  const stored = row && row.data && Array.isArray(row.data.stages) ? row.data.stages : null;
  if (stored && stored.length) return normalizeStages(stored);
  return saveStages(owner, SEED_STAGES.map((stage) => ({ ...stage })));
}
async function updateStages({ userId, stages }) {
  const owner = requireUserId(userId);
  if (!Array.isArray(stages) || !stages.length) throw fail(400, "stages are required.");
  const current = await getStages({ userId: owner });
  const byKey = new Map(current.map((stage) => [stage.key, { ...stage }]));
  const seen = new Set();
  for (const stage of stages) {
    if (!stage || typeof stage !== "object") throw fail(400, "stage must be an object.");
    const key = readText(stage.key, "key", 40, true);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw fail(400, "key must be a stage key.");
    if (seen.has(key)) throw fail(400, "stage keys must be unique.");
    seen.add(key);
    const prev = byKey.get(key);
    byKey.set(key, {
      key, name: readText(stage.name, "name", 80, true),
      description: readText(stage.description, "description", 400, false) || (prev ? prev.description : ""),
      position: Number.isInteger(stage.position) ? stage.position : (prev ? prev.position : byKey.size),
      retired: stage.retired === true,
    });
  }
  return saveStages(owner, [...byKey.values()]);
}
async function record(tx, fields) {
  return tx.sellingPartEvent.create({
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
  const stages = await getStages({ userId: owner });
  const sourceKind = readEnum(input.sourceKind || "none", SOURCE_KINDS, "sourceKind");
  const sourceId = sourceKind === "none" || sourceKind === "code" ? (readText(input.sourceId, "sourceId", 200, false) || null) : readText(input.sourceId, "sourceId", 200, true);
  const draftKey = readText(input.draftKey, "draftKey", 200, false) || null;
  const stageKey = stageKeyOf(input.stageKey, stages);
  await ensureTable();
  if (draftKey) {
    try {
      const existing = await db().sellingPart.findUnique({ where: { userId_draftKey: { userId: owner, draftKey } } });
      if (existing) return { row: existing, created: false };
    } catch (err) { throw storeDown(err); }
  }
  const source = await sourceText(owner, sourceKind, sourceId);
  const data = {
    userId: owner, stageKey, title: readText(input.title, "title", 200, true),
    body: readText(input.body, "body", 8000, false), fields: readFields(stageKey, input.fields),
    topics: readList(input.topics, "topics"), stack: readList(input.stack, "stack", true), concepts: readSlugs(input.concepts), status: "draft", sourceKind, sourceId,
    sourceRef: readRef(sourceKind, input.sourceRef), sourceExcerpt: readText(input.sourceExcerpt, "sourceExcerpt", 500, false),
    sourceHash: readText(input.sourceHash, "sourceHash", 80, false) || (source ? hashText(source) : null),
    checkVerdicts: [], draftKey, createdBy: actor,
  };
  const row = await commit(async (tx) => {
    const saved = await tx.sellingPart.create({ data });
    await record(tx, { userId: owner, partId: saved.id, actor, action: "created", detail: { stageKey, sourceKind } });
    return saved;
  });
  return { row, created: true };
}
async function listParts({ userId, stage, topic, status, sourceKind, stack, concepts } = {}) {
  const owner = requireUserId(userId);
  await ensureTable();
  let rows;
  try { rows = await db().sellingPart.findMany({ where: { userId: owner } }); }
  catch (err) { throw storeDown(err); }
  rows = rows.filter((row) => (!stage || row.stageKey === stage) && (!status || row.status === status)
    && (!sourceKind || row.sourceKind === sourceKind)
    && (!topic || (Array.isArray(row.topics) && row.topics.includes(topic)))
    && (!stack || (Array.isArray(row.stack) && row.stack.includes(String(stack).trim().toLowerCase())))
    && (!concepts || (Array.isArray(row.concepts) && row.concepts.includes(slug(concepts)))));
  rows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const out = [];
  for (const row of rows) out.push(Object.assign({}, row, { sourceChanged: await changedFlag(owner, row) }));
  return out;
}
async function getPart({ id, userId }) {
  const owner = requireUserId(userId);
  await ensureTable();
  const row = await loadOwned(id, owner);
  return Object.assign({}, row, { sourceChanged: await changedFlag(owner, row) });
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
  const stages = await getStages({ userId: owner });
  const data = {};
  if (keys.includes("title")) data.title = readText(source.title, "title", 200, true);
  if (keys.includes("body")) data.body = readText(source.body, "body", 8000, false);
  if (keys.includes("topics")) data.topics = readList(source.topics, "topics");
  if (keys.includes("stack")) data.stack = readList(source.stack, "stack", true);
  if (keys.includes("concepts")) data.concepts = readSlugs(source.concepts);
  if (keys.includes("sourceRef")) data.sourceRef = readRef(row.sourceKind, source.sourceRef);
  if (keys.includes("sourceExcerpt")) data.sourceExcerpt = readText(source.sourceExcerpt, "sourceExcerpt", 500, false);
  if (keys.includes("stageKey")) data.stageKey = stageKeyOf(source.stageKey, stages);
  if (keys.includes("fields")) data.fields = readFields(data.stageKey || row.stageKey, source.fields);
  const demote = row.status === "ready" && (keys.includes("body") || keys.includes("fields"));
  if (demote) data.status = "draft";
  const now = new Date();
  return commit(async (tx) => {
    const saved = await tx.sellingPart.update({ where: { id: row.id }, data });
    await record(tx, {
      userId: owner, partId: row.id, actor: label, at: now,
      action: keys.length === 1 && keys[0] === "stageKey" ? "stage_changed" : "edited",
      detail: { fields: keys, from: row.status, to: saved.status },
    });
    return Object.assign({}, saved, { sourceChanged: await changedFlag(owner, saved) });
  });
}
async function setStatus({ id, userId, actor, status }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  const next = readEnum(status, STATUSES, "status");
  await ensureTable();
  const row = await loadOwned(id, owner);
  if (row.status === next) throw fail(400, "Nothing to update.");
  const action = next === "ready" ? "ready" : next === "retired" ? "retired" : "edited";
  const now = new Date();
  return commit(async (tx) => {
    const saved = await tx.sellingPart.update({ where: { id: row.id }, data: { status: next } });
    const event = await record(tx, {
      userId: owner, partId: row.id, actor: label, action, detail: { from: row.status, to: next }, at: now,
    });
    return { part: saved, event };
  });
}

module.exports = {
  UNAVAILABLE, TABLE_STATEMENTS, STAGES_KIND, SEED_STAGES, ensureTable, resetTableCache,
  presentPart: shape, presentEvent: shape,
  getStages, updateStages, createPart, listParts, getPart, updatePart, setStatus,
};
