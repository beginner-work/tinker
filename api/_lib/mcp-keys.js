/* Durable MCP API keys.
 *
 * Plaintext keys are shown once, at mint, and never stored. Postgres
 * keeps the SHA-256 hex hash, a label, the approving user's id,
 * createdAt, and revokedAt (null until revoke). Lookup is by hash.
 * A non-null revokedAt rejects the key on the next request.
 * List and revoke only see rows for that user.
 *
 * The table matches prisma/migrations/20260923120000_add_mcp_api_keys.
 * Vercel builds do not run migrate deploy (the Neon pooler advisory
 * lock times out), so the first mint or key check creates the same
 * table if it is missing.
 */

"use strict";

const crypto = require("crypto");

const KEY_PREFIX = "mcp_";
// 32 random bytes, base64url, no padding and no dots.
const KEY_BODY = /^[A-Za-z0-9_-]{43}$/;
const LABEL_MAX = 80;

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "McpApiKey" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "McpApiKey_pkey" PRIMARY KEY ("id")
)`,
  `ALTER TABLE "McpApiKey" ADD COLUMN IF NOT EXISTS "userId" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "McpApiKey_keyHash_key" ON "McpApiKey"("keyHash")`,
  `CREATE INDEX IF NOT EXISTS "McpApiKey_userId_idx" ON "McpApiKey"("userId")`,
];

let ensuring = null;

function db() {
  return require("./db.js");
}

function hashKey(plaintext) {
  return crypto.createHash("sha256").update(String(plaintext), "utf8").digest("hex");
}

function isMcpApiKey(token) {
  return typeof token === "string" && token.startsWith(KEY_PREFIX);
}

function isWellFormedMcpKey(token) {
  if (!isMcpApiKey(token)) return false;
  if (token.includes(".")) return false;
  return KEY_BODY.test(token.slice(KEY_PREFIX.length));
}

function generateKey() {
  return KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
}

function userIdFromSession(session) {
  return (
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    ""
  );
}

function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  }
  return userId.trim();
}

function normalizeLabel(label) {
  if (typeof label !== "string") {
    throw Object.assign(new Error("Label is required."), { status: 400 });
  }
  const trimmed = label.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Label is required."), { status: 400 });
  }
  if (trimmed.length > LABEL_MAX) {
    throw Object.assign(
      new Error(`Label must be ${LABEL_MAX} characters or fewer.`),
      { status: 400 },
    );
  }
  return trimmed;
}

function invalidKey() {
  return Object.assign(new Error("Invalid API key."), { status: 401 });
}

function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error("API key store unavailable."), { status: 503 });
}

async function ensureTable() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    const prisma = db();
    for (const statement of TABLE_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare the MCP API key table."), {
      status: 503,
      cause: err,
    });
  });
  return ensuring;
}

function resetTableCache() {
  ensuring = null;
}

async function mintMcpKey({ label, userId }) {
  const clean = normalizeLabel(label);
  const owner = requireUserId(userId);
  const key = generateKey();
  const keyHash = hashKey(key);
  await ensureTable();
  let row;
  try {
    row = await db().mcpApiKey.create({
      data: { keyHash, label: clean, userId: owner },
    });
  } catch (err) {
    throw storeDown(err);
  }
  return {
    id: row.id,
    label: row.label,
    userId: row.userId,
    createdAt: row.createdAt,
    key,
  };
}

async function revokeMcpKey(id, userId) {
  const owner = requireUserId(userId);
  if (typeof id !== "string" || !id.trim()) {
    throw Object.assign(new Error("Key id is required."), { status: 400 });
  }
  const keyId = id.trim();
  await ensureTable();
  let existing;
  try {
    existing = await db().mcpApiKey.findUnique({ where: { id: keyId } });
  } catch (err) {
    throw storeDown(err);
  }
  if (!existing || existing.userId !== owner) {
    throw Object.assign(new Error("No API key with that id."), { status: 404 });
  }
  if (existing.revokedAt) return existing;
  try {
    return await db().mcpApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  } catch (err) {
    throw storeDown(err);
  }
}

async function listMcpKeys(userId) {
  const owner = requireUserId(userId);
  await ensureTable();
  try {
    return await db().mcpApiKey.findMany({
      where: { userId: owner },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        createdAt: true,
        revokedAt: true,
      },
    });
  } catch (err) {
    throw storeDown(err);
  }
}

async function authenticateMcpKey(token) {
  if (!isWellFormedMcpKey(token)) throw invalidKey();
  let row;
  try {
    await ensureTable();
    row = await db().mcpApiKey.findUnique({
      where: { keyHash: hashKey(token) },
    });
  } catch (err) {
    throw storeDown(err);
  }
  if (!row || row.revokedAt || !row.userId) throw invalidKey();
  return { id: row.id, label: row.label, userId: row.userId };
}

module.exports = {
  KEY_PREFIX,
  LABEL_MAX,
  TABLE_STATEMENTS,
  hashKey,
  isMcpApiKey,
  isWellFormedMcpKey,
  userIdFromSession,
  ensureTable,
  resetTableCache,
  mintMcpKey,
  revokeMcpKey,
  listMcpKeys,
  authenticateMcpKey,
};
