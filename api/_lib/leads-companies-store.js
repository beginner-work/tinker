/* Target companies and the hunt funnel. Owner-scoped. Never estimates pay. */
"use strict";

const COMPANY_STATUSES = ["active", "dropped"];
const CONTACT_TYPES = ["referrer", "recruiter", "hiring_leader", "other"];
const UNAVAILABLE = "Leads are unavailable right now.";
const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "TargetCompany" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL, "domain" TEXT NOT NULL DEFAULT '', "northStar" BOOLEAN NOT NULL DEFAULT false, "priority" INTEGER NOT NULL DEFAULT 100, "status" TEXT NOT NULL, "totalComp" INTEGER, "totalCompSource" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TargetCompany_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "TargetCompany_userId_idx" ON "TargetCompany"("userId")`,
  `CREATE INDEX IF NOT EXISTS "TargetCompany_userId_name_idx" ON "TargetCompany"("userId", "name")`,
  `ALTER TABLE "TargetCompany" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100`,
  `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "companyId" TEXT`,
  `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "contactType" TEXT NOT NULL DEFAULT 'other'`,
  `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "queueOrder" INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS "Lead_companyId_idx" ON "Lead"("companyId")`,
];

let ensuring = null;
const db = () => require("./db.js");
const leads = () => require("./leads-store.js");
const fail = (status, message) => Object.assign(new Error(message), { status });
function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
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
    await leads().ensureTable();
    for (const statement of TABLE_STATEMENTS) await db().$executeRawUnsafe(statement);
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare the company tables."), { status: 503, cause: err });
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
function readBool(value, label) {
  if (value == null || value === false) return false;
  if (value === true) return true;
  throw fail(400, `${label} must be true or false.`);
}
function readComp(value, label) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) throw fail(400, `${label} must be a whole dollar amount.`);
  return n;
}
function readPriority(value, label) {
  if (value == null || value === "") return 100;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw fail(400, `${label} must be an integer from 0 to 10000.`);
  return n;
}
function requireActor(actor) {
  const label = actor && typeof actor.label === "string" ? actor.label.trim() : "";
  const kind = actor && actor.kind;
  const ok = (kind === "human" && /^user:\S/.test(label)) || (kind === "bot" && /^bot:\S/.test(label));
  if (!ok) throw fail(401, "Missing actor.");
  return label;
}
function companySort(a, b) {
  return Number(b.northStar) - Number(a.northStar)
    || (Number(a.priority == null ? 100 : a.priority) - Number(b.priority == null ? 100 : b.priority))
    || a.name.localeCompare(b.name);
}
function domainKey(domain) { return String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]; }
function nameKey(name) { return String(name || "").trim().toLowerCase(); }
function payStatus(company, floor) {
  if (floor == null || company.totalComp == null) return "unknown";
  return company.totalComp >= floor ? "clears" : "below";
}
function nextOfType(leadsRows, type) {
  const open = ["new", "drafting"];
  const rows = leadsRows.filter((row) => row.contactType === type && open.includes(row.stage));
  rows.sort((a, b) => (a.queueOrder - b.queueOrder) || (new Date(a.createdAt) - new Date(b.createdAt)));
  return rows[0] || null;
}
async function loadCompany(id, owner) {
  if (typeof id !== "string" || !id.trim()) throw fail(400, "company id is required.");
  let row;
  try { row = await db().targetCompany.findUnique({ where: { id: id.trim() } }); }
  catch (err) { throw storeDown(err); }
  if (!row || row.userId !== owner) throw fail(404, "No company with that id.");
  return row;
}
async function clearOtherNorthStars(tx, owner, keepId) {
  const rows = await tx.targetCompany.findMany({ where: { userId: owner } });
  for (const row of rows) {
    if (row.northStar && row.id !== keepId) await tx.targetCompany.update({ where: { id: row.id }, data: { northStar: false } });
  }
}

async function createCompany(input) {
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  if (!userId) throw fail(401, "Sign in to tinker first.");
  const store = leads();
  store.assertAllowed(userId, input.emailHint);
  requireActor(input.actor);
  const data = {
    userId, name: readText(input.name, "name", 200, true), domain: domainKey(input.domain),
    northStar: readBool(input.northStar, "northStar"), priority: readPriority(input.priority, "priority"),
    status: readEnum(input.status || "active", COMPANY_STATUSES, "status"),
    totalComp: readComp(input.totalComp, "totalComp"), totalCompSource: readText(input.totalCompSource, "totalCompSource", 500, false),
  };
  await ensureTable();
  try {
    return await db().$transaction(async (tx) => {
      const saved = await tx.targetCompany.create({ data });
      if (saved.northStar) await clearOtherNorthStars(tx, userId, saved.id);
      return saved;
    });
  } catch (err) { if (err && err.status) throw err; throw storeDown(err); }
}

async function listCompanies({ userId, emailHint, status } = {}) {
  const store = leads();
  if (typeof userId !== "string" || !userId.trim()) throw fail(401, "Sign in to tinker first.");
  store.assertAllowed(userId, emailHint);
  await ensureTable();
  let rows;
  try { rows = await db().targetCompany.findMany({ where: { userId } }); }
  catch (err) { throw storeDown(err); }
  if (status) rows = rows.filter((row) => row.status === status);
  rows.sort(companySort);
  return rows;
}

async function updateCompany({ id, userId, emailHint, actor, patch }) {
  const store = leads();
  if (typeof userId !== "string" || !userId.trim()) throw fail(401, "Sign in to tinker first.");
  store.assertAllowed(userId, emailHint);
  requireActor(actor);
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const keys = ["name", "domain", "northStar", "priority", "status", "totalComp", "totalCompSource"].filter((key) => Object.prototype.hasOwnProperty.call(source, key));
  if (!keys.length) throw fail(400, "Nothing to update.");
  await ensureTable();
  const row = await loadCompany(id, userId);
  const data = {};
  if (keys.includes("name")) data.name = readText(source.name, "name", 200, true);
  if (keys.includes("domain")) data.domain = domainKey(source.domain);
  if (keys.includes("northStar")) data.northStar = readBool(source.northStar, "northStar");
  if (keys.includes("priority")) data.priority = readPriority(source.priority, "priority");
  if (keys.includes("status")) data.status = readEnum(source.status, COMPANY_STATUSES, "status");
  if (keys.includes("totalComp")) data.totalComp = readComp(source.totalComp, "totalComp");
  if (keys.includes("totalCompSource")) data.totalCompSource = readText(source.totalCompSource, "totalCompSource", 500, false);
  try {
    return await db().$transaction(async (tx) => {
      const saved = await tx.targetCompany.update({ where: { id: row.id }, data });
      if (saved.northStar) await clearOtherNorthStars(tx, userId, saved.id);
      return saved;
    });
  } catch (err) { if (err && err.status) throw err; throw storeDown(err); }
}

async function matchOrCreateCompany(tx, owner, { name, domain }) {
  const n = nameKey(name);
  const d = domainKey(domain);
  if (!n && !d) return null;
  const rows = await tx.targetCompany.findMany({ where: { userId: owner } });
  let found = rows.find((row) => (d && domainKey(row.domain) === d) || (n && nameKey(row.name) === n));
  if (found) {
    const data = {};
    if (n && !found.name) data.name = name;
    if (d && !found.domain) data.domain = d;
    if (Object.keys(data).length) found = await tx.targetCompany.update({ where: { id: found.id }, data });
    return found;
  }
  return tx.targetCompany.create({
    data: { userId: owner, name: name || d || "Company", domain: d, northStar: false, priority: 100, status: "active", totalComp: null, totalCompSource: "" },
  });
}

async function getFunnel({ userId, emailHint }) {
  const store = leads();
  if (typeof userId !== "string" || !userId.trim()) throw fail(401, "Sign in to tinker first.");
  store.assertAllowed(userId, emailHint);
  await ensureTable();
  const settings = await store.getOutreachSettings({ userId, emailHint });
  const floor = settings.minTotalComp == null ? null : settings.minTotalComp;
  let companies, leadRows;
  try {
    companies = await db().targetCompany.findMany({ where: { userId } });
    leadRows = await db().lead.findMany({ where: { userId } });
  } catch (err) { throw storeDown(err); }
  const active = companies.filter((row) => row.status === "active");
  const north = active.filter((row) => row.northStar).sort(companySort);
  const rest = active.filter((row) => !row.northStar);
  rest.sort((a, b) => {
    const pa = payStatus(a, floor); const pb = payStatus(b, floor);
    const rank = (p) => (p === "below" ? 1 : 0);
    return rank(pa) - rank(pb)
      || (Number(a.priority == null ? 100 : a.priority) - Number(b.priority == null ? 100 : b.priority))
      || a.name.localeCompare(b.name);
  });
  const ordered = north.concat(rest);
  return {
    minTotalComp: floor,
    companies: ordered.map((company) => {
      const linked = leadRows.filter((row) => row.companyId === company.id);
      return {
        company: shape(company),
        payStatus: payStatus(company, floor),
        nextReferrer: (() => { const row = nextOfType(linked, "referrer"); return row ? shape(row) : null; })(),
        nextRecruiter: (() => { const row = nextOfType(linked, "recruiter"); return row ? shape(row) : null; })(),
        nextHiringLeader: (() => { const row = nextOfType(linked, "hiring_leader"); return row ? shape(row) : null; })(),
      };
    }),
  };
}

module.exports = {
  UNAVAILABLE, TABLE_STATEMENTS, COMPANY_STATUSES, CONTACT_TYPES,
  ensureTable, resetTableCache, presentCompany: shape,
  createCompany, listCompanies, updateCompany, matchOrCreateCompany, getFunnel, loadCompany,
  domainKey, nameKey, payStatus, nextOfType, companySort, readPriority,
};
