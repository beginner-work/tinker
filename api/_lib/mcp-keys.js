/* Durable MCP API keys.
 *
 * Plaintext keys are shown once, at mint, and never stored. Postgres
 * keeps the SHA-256 hex hash, a label, createdAt, and revokedAt
 * (null until revoke). Lookup is by hash. A non-null revokedAt
 * rejects the key on the next request.
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "McpApiKey_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "McpApiKey_keyHash_key" ON "McpApiKey"("keyHash")`,
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

function ownerIds() {
  const raw = process.env.MCP_KEY_OWNER_USER_ID || "";
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

function userIdFromSession(session) {
  return (
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    ""
  );
}

function ownerStatus(userId) {
  const ids = ownerIds();
  return {
    configured: ids.length > 0,
    isOwner: Boolean(userId) && ids.includes(userId),
  };
}

function assertOwner(userId) {
  const status = ownerStatus(userId);
  if (!status.configured) {
    throw Object.assign(
      new Error(
        "MCP key minting is not configured. Set MCP_KEY_OWNER_USER_ID to your Stytch user id.",
      ),
      { status: 503, userId },
    );
  }
  if (!status.isOwner) {
    throw Object.assign(new Error("Only the owner can manage MCP API keys."), {
      status: 403,
    });
  }
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

async function mintMcpKey({ label }) {
  const clean = normalizeLabel(label);
  const key = generateKey();
  const keyHash = hashKey(key);
  await ensureTable();
  let row;
  try {
    row = await db().mcpApiKey.create({
      data: { keyHash, label: clean },
    });
  } catch (err) {
    throw storeDown(err);
  }
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt,
    key,
  };
}

async function revokeMcpKey(id) {
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
  if (!existing) {
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

async function listMcpKeys() {
  await ensureTable();
  try {
    return await db().mcpApiKey.findMany({
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
  if (!row || row.revokedAt) throw invalidKey();
  return { id: row.id, label: row.label };
}

module.exports = {
  KEY_PREFIX,
  LABEL_MAX,
  TABLE_STATEMENTS,
  hashKey,
  isMcpApiKey,
  isWellFormedMcpKey,
  ownerIds,
  userIdFromSession,
  ownerStatus,
  assertOwner,
  ensureTable,
  resetTableCache,
  mintMcpKey,
  revokeMcpKey,
  listMcpKeys,
  authenticateMcpKey,
};
