/* Career record: seeds, review actions, and the shape bots may read.
 *
 * Facts and rules live in Redis under career:<user id>. The browser
 * seeds on first load and is the only writer. The connector reads
 * through get_career_record and check_text. Rejected facts are omitted
 * from the tool. Restore sends a rejected fact back to proposed.
 * Proposed facts stay marked unverified.
 *
 * Employment facts carry employer, optional title, start_month,
 * end_month (null only when current), and current. Missing catalog
 * rules are merged into an existing record on browser load.
 */

"use strict";

const crypto = require("crypto");
const catalog = require("../../src/renderer/career/catalog.js");
const redis = require("./career-redis.js");

const { UNVERIFIED_NOTE, SEED_FACTS, SEED_RULES, FACT_KINDS } = catalog;
const UNAVAILABLE = redis.UNAVAILABLE;
const KIND_SET = new Set(FACT_KINDS);
const STATUSES = new Set(["proposed", "verified", "rejected"]);
const MONTH_RE = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})$/i;
const MONTHS = {
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
  apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
  aug: "08", august: "08", sep: "09", sept: "09", september: "09",
  oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12",
};
const MONTH_LABELS = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
  "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

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

function normalizeMonthToken(value) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})$/);
  if (iso && MONTH_LABELS[iso[2]]) return iso[1] + "-" + iso[2];
  const match = raw.match(MONTH_RE);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return match[2] + "-" + month;
}

function formatMonthToken(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const label = MONTH_LABELS[match[2]];
  if (!label) return "";
  return label + " " + match[1];
}

function employmentDisplayValue(fields) {
  const parts = [fields.employer];
  if (fields.title) parts.push(fields.title);
  const start = formatMonthToken(fields.start_month);
  if (fields.current || fields.end_month == null) {
    parts.push(start + " - Present");
  } else {
    parts.push(start + " - " + formatMonthToken(fields.end_month));
  }
  return parts.filter(Boolean).join(", ");
}

function cleanExperienceKinds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 80))
    .slice(0, 12);
}

function cleanEmploymentFields(fact) {
  const employer = typeof fact.employer === "string" ? fact.employer.trim().slice(0, 200) : "";
  if (!employer) return null;
  const title = typeof fact.title === "string" && fact.title.trim()
    ? fact.title.trim().slice(0, 200)
    : null;
  const start_month = normalizeMonthToken(fact.start_month);
  if (!start_month) return null;
  const current = fact.current === true;
  let end_month = null;
  if (current) {
    if (fact.end_month != null && String(fact.end_month).trim() !== "") return null;
    end_month = null;
  } else {
    end_month = normalizeMonthToken(fact.end_month);
    if (!end_month) return null;
  }
  return {
    employer,
    title,
    start_month,
    end_month,
    current,
    experience_kinds: cleanExperienceKinds(fact.experience_kinds),
  };
}

function cleanFact(fact) {
  if (!fact || typeof fact !== "object") return null;
  if (typeof fact.id !== "string" || !fact.id) return null;
  if (!KIND_SET.has(fact.kind)) return null;
  if (!STATUSES.has(fact.status)) return null;
  const source = cleanSource(fact.source);
  if (!source) return null;
  const cleaned = {
    id: fact.id,
    kind: fact.kind,
    source,
    status: fact.status,
    updated_at: typeof fact.updated_at === "string" ? fact.updated_at : null,
  };
  if (fact.kind === "employment") {
    const fields = cleanEmploymentFields(fact);
    if (!fields) return null;
    Object.assign(cleaned, fields);
    const value = typeof fact.value === "string" && fact.value.trim()
      ? fact.value.trim().slice(0, 500)
      : employmentDisplayValue(fields);
    cleaned.value = value;
    return cleaned;
  }
  if (typeof fact.value !== "string") return null;
  cleaned.value = fact.value.slice(0, 500);
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

function mergeCatalogRules(record) {
  if (!record || !Array.isArray(record.rules)) return false;
  const have = new Set(record.rules.map((rule) => rule.id));
  let changed = false;
  const updated_at = nowIso();
  for (const seed of SEED_RULES) {
    if (have.has(seed.id)) continue;
    record.rules.push({ ...clone(seed), updated_at });
    have.add(seed.id);
    changed = true;
  }
  return changed;
}

function withCatalogRules(record) {
  const next = record || emptyRecord();
  mergeCatalogRules(next);
  return next;
}

async function readRecord(userId) {
  const raw = await redis.readRaw(userId);
  if (raw == null) return null;
  return parseRecord(raw) || emptyRecord();
}

const EMPLOYMENT_BOOTSTRAP_DRAFT_KEY = "career-employment-bootstrap-v1";

async function loadEmploymentBootstrap(userId) {
  let contentStore;
  try {
    contentStore = require("./content-store.js");
  } catch {
    return [];
  }
  let row;
  try {
    row = await contentStore.findByDraftKey(userId, EMPLOYMENT_BOOTSTRAP_DRAFT_KEY);
  } catch {
    return [];
  }
  if (!row || !row.fields || typeof row.fields !== "object") return [];
  const list = Array.isArray(row.fields.employment) ? row.fields.employment : [];
  const facts = [];
  for (const item of list) {
    try {
      const fact = buildEmploymentFact({
        ...item,
        kind: "employment",
        status: item && item.status === "proposed" ? "proposed" : "verified",
      });
      if (fact) facts.push(fact);
    } catch {
      // skip malformed bootstrap rows
    }
  }
  return facts;
}

async function applyEmploymentBootstrap(userId, record, { persist }) {
  const incoming = await loadEmploymentBootstrap(userId);
  if (!incoming.length) return false;
  const changed = upsertFacts(record, incoming);
  if (changed && persist) {
    await redis.writeRaw(userId, serialize(record));
  }
  return changed;
}

async function readForTool(userId) {
  const record = await readRecord(userId);
  const shaped = record || emptyRecord();
  await applyEmploymentBootstrap(userId, shaped, { persist: false });
  return shaped;
}

async function ensureSeed(userId) {
  const existing = await readRecord(userId);
  if (existing && (existing.facts.length || existing.rules.length)) {
    let changed = mergeCatalogRules(existing);
    if (await applyEmploymentBootstrap(userId, existing, { persist: false })) changed = true;
    if (changed) {
      await redis.writeRaw(userId, serialize(existing));
    }
    return existing;
  }
  const seeded = seedRecord();
  await applyEmploymentBootstrap(userId, seeded, { persist: false });
  const created = await redis.createRaw(userId, serialize(seeded));
  if (created) return seeded;
  const again = await readRecord(userId);
  if (again) {
    let changed = mergeCatalogRules(again);
    if (await applyEmploymentBootstrap(userId, again, { persist: false })) changed = true;
    if (changed) await redis.writeRaw(userId, serialize(again));
  }
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
  if (fact.kind === "employment") {
    shaped.employer = fact.employer;
    shaped.title = fact.title == null ? null : fact.title;
    shaped.start_month = fact.start_month;
    shaped.end_month = fact.end_month == null ? null : fact.end_month;
    shaped.current = fact.current === true;
    shaped.experience_kinds = Array.isArray(fact.experience_kinds) ? fact.experience_kinds.slice() : [];
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

function applyEmploymentBody(fact, body) {
  const next = {
    employer: Object.prototype.hasOwnProperty.call(body, "employer") ? body.employer : fact.employer,
    title: Object.prototype.hasOwnProperty.call(body, "title") ? body.title : fact.title,
    start_month: Object.prototype.hasOwnProperty.call(body, "start_month") ? body.start_month : fact.start_month,
    end_month: Object.prototype.hasOwnProperty.call(body, "end_month") ? body.end_month : fact.end_month,
    current: Object.prototype.hasOwnProperty.call(body, "current") ? body.current === true : fact.current === true,
    experience_kinds: Object.prototype.hasOwnProperty.call(body, "experience_kinds")
      ? body.experience_kinds
      : fact.experience_kinds,
  };
  if (next.current) next.end_month = null;
  const fields = cleanEmploymentFields(next);
  if (!fields) {
    throw Object.assign(
      new Error("Employment needs employer, start month, and either an end month or current."),
      { status: 400 },
    );
  }
  Object.assign(fact, fields);
  if (Object.prototype.hasOwnProperty.call(body, "value") && typeof body.value === "string" && body.value.trim()) {
    fact.value = body.value.trim().slice(0, 500);
  } else {
    fact.value = employmentDisplayValue(fields);
  }
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
  if (fact.kind === "employment") {
    applyEmploymentBody(fact, body);
  } else {
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
  mergeCatalogRules(record);
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
  mergeCatalogRules(record);
  addProposed(record, facts);
  await redis.writeRaw(userId, serialize(record));
  return record;
}

function buildEmploymentFact(partial) {
  const id = typeof partial.id === "string" && partial.id ? partial.id : newFactId();
  const status = STATUSES.has(partial.status) ? partial.status : "verified";
  const source = cleanSource(partial.source);
  if (!source) {
    throw Object.assign(new Error("Employment needs a source document and excerpt."), { status: 400 });
  }
  const fields = cleanEmploymentFields(partial);
  if (!fields) {
    throw Object.assign(
      new Error("Employment needs employer, start month, and either an end month or current."),
      { status: 400 },
    );
  }
  return cleanFact({
    id,
    kind: "employment",
    value: typeof partial.value === "string" ? partial.value : employmentDisplayValue(fields),
    source,
    status,
    updated_at: typeof partial.updated_at === "string" ? partial.updated_at : nowIso(),
    ...fields,
  });
}

function upsertFacts(record, facts) {
  if (!record.facts) record.facts = [];
  let changed = false;
  for (const incoming of facts || []) {
    const cleaned = cleanFact(incoming) || (incoming && incoming.kind === "employment"
      ? buildEmploymentFact(incoming)
      : null);
    if (!cleaned) continue;
    const index = record.facts.findIndex((fact) => fact.id === cleaned.id);
    if (index >= 0) {
      record.facts[index] = cleaned;
    } else {
      record.facts.push(cleaned);
    }
    changed = true;
  }
  return changed;
}

async function upsertFactsForUser(userId, facts) {
  const raw = await redis.readRawForWrite(userId);
  const record = raw == null ? seedRecord() : (parseRecord(raw) || emptyRecord());
  mergeCatalogRules(record);
  upsertFacts(record, facts);
  await redis.writeRaw(userId, serialize(record));
  return record;
}

module.exports = {
  UNAVAILABLE,
  UNVERIFIED_NOTE,
  EMPLOYMENT_BOOTSTRAP_DRAFT_KEY,
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
  mergeCatalogRules,
  withCatalogRules,
  employmentDisplayValue,
  normalizeMonthToken,
  formatMonthToken,
  buildEmploymentFact,
  upsertFacts,
  upsertFactsForUser,
};
