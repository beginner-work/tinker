/* Career record: seeds, review actions, and the shape bots may read.
 *
 * Facts and rules live in Redis under career:<user id>. The browser
 * seeds on first load and is the only writer. The connector reads
 * through get_career_record and check_text. Rejected facts are omitted
 * from the tool. Restore sends a rejected fact back to proposed.
 * Proposed facts stay marked unverified.
 */

"use strict";

const crypto = require("crypto");
const catalog = require("../../src/renderer/career/catalog.js");
const redis = require("./career-redis.js");

const { UNVERIFIED_NOTE, SEED_FACTS, SEED_RULES, FACT_KINDS } = catalog;
const UNAVAILABLE = redis.UNAVAILABLE;
const KIND_SET = new Set(FACT_KINDS);
const STATUSES = new Set(["proposed", "verified", "rejected"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function newFactId() {
  return "fact_" + crypto.randomBytes(6).toString("hex");
}

function emptyRecord() {
  return { facts: [], rules: [] };
}

function seedRecord() {
  const updated_at = nowIso();
  return {
    facts: clone(SEED_FACTS).map((fact) => ({ ...fact, updated_at })),
    rules: clone(SEED_RULES).map((rule) => ({ ...rule, updated_at })),
  };
}

function cleanSource(source) {
  if (!source || typeof source !== "object") return null;
  const document = typeof source.document === "string" ? source.document.trim() : "";
  const excerpt = typeof source.excerpt === "string" ? source.excerpt.trim() : "";
  if (!document || !excerpt) return null;
  return { document: document.slice(0, 200), excerpt: excerpt.slice(0, 500) };
}

function cleanFact(fact) {
  if (!fact || typeof fact !== "object") return null;
  if (typeof fact.id !== "string" || !fact.id) return null;
  if (!KIND_SET.has(fact.kind)) return null;
  if (typeof fact.value !== "string") return null;
  if (!STATUSES.has(fact.status)) return null;
  const source = cleanSource(fact.source);
  if (!source) return null;
  const cleaned = {
    id: fact.id,
    kind: fact.kind,
    value: fact.value.slice(0, 500),
    source,
    status: fact.status,
    updated_at: typeof fact.updated_at === "string" ? fact.updated_at : null,
  };
  if (fact.kind === "metric") {
    cleaned.baseline = typeof fact.baseline === "string" ? fact.baseline.slice(0, 300) : null;
    cleaned.mechanism = typeof fact.mechanism === "string" ? fact.mechanism.slice(0, 300) : null;
  }
  return cleaned;
}

function cleanRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  if (typeof rule.id !== "string" || !rule.id) return null;
  if (typeof rule.field !== "string" || !rule.field) return null;
  if (typeof rule.rule !== "string" || !rule.rule) return null;
  if (!rule.machine || typeof rule.machine !== "object") return null;
  if (rule.status !== "verified") return null;
  return {
    id: rule.id,
    field: rule.field,
    rule: rule.rule,
    machine: clone(rule.machine),
    status: "verified",
    updated_at: typeof rule.updated_at === "string" ? rule.updated_at : null,
  };
}

function parseRecord(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const facts = Array.isArray(value.facts) ? value.facts.map(cleanFact).filter(Boolean) : [];
  const rules = Array.isArray(value.rules) ? value.rules.map(cleanRule).filter(Boolean) : [];
  return { facts, rules };
}

function serialize(record) {
  return JSON.stringify({ facts: record.facts, rules: record.rules });
}

async function readRecord(userId) {
  const raw = await redis.readRaw(userId);
  if (raw == null) return null;
  return parseRecord(raw) || emptyRecord();
}

async function readForTool(userId) {
  const record = await readRecord(userId);
  return record || emptyRecord();
}

async function ensureSeed(userId) {
  const existing = await readRecord(userId);
  if (existing && (existing.facts.length || existing.rules.length)) return existing;
  const seeded = seedRecord();
  const created = await redis.createRaw(userId, serialize(seeded));
  if (created) return seeded;
  const again = await readRecord(userId);
  return again || seeded;
}

function publicFact(fact, extra) {
  const shaped = {
    id: fact.id,
    kind: fact.kind,
    value: fact.value,
    source: { document: fact.source.document, excerpt: fact.source.excerpt },
    status: fact.status,
    updated_at: fact.updated_at,
  };
  if (fact.kind === "metric") {
    shaped.baseline = fact.baseline == null ? null : fact.baseline;
    shaped.mechanism = fact.mechanism == null ? null : fact.mechanism;
  }
  if (extra) Object.assign(shaped, extra);
  return shaped;
}

function publicRule(rule) {
  return {
    id: rule.id,
    field: rule.field,
    rule: rule.rule,
    machine: clone(rule.machine),
    status: rule.status,
  };
}

function shapeForBrowser(record) {
  const facts = record.facts || [];
  return {
    proposed_facts: facts.filter((fact) => fact.status === "proposed").map((fact) => publicFact(fact)),
    verified_facts: facts.filter((fact) => fact.status === "verified").map((fact) => publicFact(fact)),
    rejected_facts: facts.filter((fact) => fact.status === "rejected").map((fact) => publicFact(fact)),
    rules: (record.rules || []).map(publicRule),
    unverified_note: UNVERIFIED_NOTE,
  };
}

function shapeForTool(record) {
  const facts = record.facts || [];
  return {
    verified_facts: facts.filter((fact) => fact.status === "verified").map((fact) => publicFact(fact)),
    unverified_facts: facts.filter((fact) => fact.status === "proposed").map((fact) => publicFact(fact, {
      unverified: true,
    })),
    rules: (record.rules || []).filter((rule) => rule.status === "verified").map(publicRule),
    unverified_note: UNVERIFIED_NOTE,
  };
}

function applyFactAction(record, body) {
  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action;
  const fact = (record.facts || []).find((item) => item.id === id);
  if (!fact) {
    throw Object.assign(new Error("Unknown fact."), { status: 404 });
  }
  if (action !== "verify" && action !== "reject" && action !== "edit" && action !== "restore") {
    throw Object.assign(new Error("Action must be verify, edit, reject, or restore."), { status: 400 });
  }
  if (action === "reject") {
    fact.status = "rejected";
    fact.updated_at = nowIso();
    return record;
  }
  if (action === "restore") {
    if (fact.status !== "rejected") {
      throw Object.assign(new Error("Only a rejected fact can be restored."), { status: 400 });
    }
    fact.status = "proposed";
    fact.updated_at = nowIso();
    return record;
  }
  if (Object.prototype.hasOwnProperty.call(body, "value")) {
    if (typeof body.value !== "string" || !body.value.trim()) {
      throw Object.assign(new Error("value must be text."), { status: 400 });
    }
    fact.value = body.value.trim().slice(0, 500);
  }
  if (fact.kind === "metric") {
    if (Object.prototype.hasOwnProperty.call(body, "baseline")) {
      fact.baseline = typeof body.baseline === "string" && body.baseline.trim()
        ? body.baseline.trim().slice(0, 300)
        : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "mechanism")) {
      fact.mechanism = typeof body.mechanism === "string" && body.mechanism.trim()
        ? body.mechanism.trim().slice(0, 300)
        : null;
    }
  }
  if (action === "verify") {
    fact.status = "verified";
    fact.updated_at = nowIso();
  } else {
    fact.updated_at = nowIso();
  }
  return record;
}

async function mutate(userId, body) {
  const raw = await redis.readRawForWrite(userId);
  const record = raw == null ? seedRecord() : (parseRecord(raw) || emptyRecord());
  applyFactAction(record, body);
  await redis.writeRaw(userId, serialize(record));
  return record;
}

function addProposed(record, facts) {
  const seen = new Set((record.facts || []).map((fact) => fact.source.excerpt));
  for (const fact of facts) {
    if (seen.has(fact.source.excerpt)) continue;
    seen.add(fact.source.excerpt);
    record.facts.push(fact);
  }
  return record;
}

async function storeProposed(userId, facts) {
  const raw = await redis.readRawForWrite(userId);
  const record = raw == null ? seedRecord() : (parseRecord(raw) || emptyRecord());
  addProposed(record, facts);
  await redis.writeRaw(userId, serialize(record));
  return record;
}

module.exports = {
  UNAVAILABLE,
  UNVERIFIED_NOTE,
  emptyRecord,
  seedRecord,
  parseRecord,
  serialize,
  readRecord,
  readForTool,
  ensureSeed,
  shapeForBrowser,
  shapeForTool,
  applyFactAction,
  mutate,
  storeProposed,
  addProposed,
  newFactId,
  cleanFact,
};
