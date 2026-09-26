/* Stored ask_followups interviews, one row per interview key.
 *
 * The table matches prisma/migrations/20260926150000_add_interview_decks.
 * Vercel builds do not run migrate deploy, so the first list or save
 * creates the same table if it is missing. Someone else's deck id
 * returns 404, not 403. A save with the same (userId, interviewKey)
 * returns the existing row (idempotency key). No slides: the
 * transcript is the source of truth.
 */

"use strict";

const MAX_TOPIC = 500;
const MAX_KEY = 200;
const MAX_TURNS = 200;
const MAX_TURN_TEXT = 8000;

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "InterviewDeck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interviewKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "transcript" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewDeck_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "InterviewDeck_userId_interviewKey_key" ON "InterviewDeck"("userId", "interviewKey")`,
  `CREATE INDEX IF NOT EXISTS "InterviewDeck_userId_idx" ON "InterviewDeck"("userId")`,
];

let ensuring = null;

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
  return Object.assign(new Error("Interview deck store unavailable."), { status: 503, cause: err });
}

function isUniqueConflict(err) {
  return Boolean(err && (err.code === "P2002" || /unique/i.test(String(err.message || ""))));
}

function readTopic(value) {
  if (typeof value !== "string" || !value.trim()) throw fail(400, "topic is required.");
  const trimmed = value.trim();
  if (trimmed.length > MAX_TOPIC) throw fail(400, `topic is limited to ${MAX_TOPIC} characters.`);
  return trimmed;
}

function readInterviewKey(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw fail(400, "interviewKey is required (the idempotency key for this interview).");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_KEY) throw fail(400, `interviewKey is limited to ${MAX_KEY} characters.`);
  return trimmed;
}

function readTurnText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw fail(400, `Each transcript turn needs a ${label}.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TURN_TEXT) {
    throw fail(400, `Each transcript ${label} is limited to ${MAX_TURN_TEXT} characters.`);
  }
  return trimmed;
}

function readTranscript(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw fail(400, "transcript must be a non-empty array of {q, a} turns.");
  }
  if (value.length > MAX_TURNS) {
    throw fail(400, `transcript is limited to ${MAX_TURNS} turns.`);
  }
  return value.map((turn, index) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
      throw fail(400, `transcript[${index}] must be an object with q and a.`);
    }
    return {
      q: readTurnText(turn.q, "q"),
      a: readTurnText(turn.a, "a"),
    };
  });
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
    throw Object.assign(new Error("Could not prepare the interview deck table."), {
      status: 503,
      cause: err,
    });
  });
  return ensuring;
}

function resetTableCache() {
  ensuring = null;
}

async function loadOwned(id, userId) {
  if (typeof id !== "string" || !id.trim()) throw fail(400, "Deck id is required.");
  let row;
  try {
    row = await db().interviewDeck.findUnique({ where: { id: id.trim() } });
  } catch (err) {
    throw storeDown(err);
  }
  if (!row || row.userId !== userId) throw fail(404, "No deck with that id.");
  return row;
}

async function findByKey(userId, interviewKey) {
  try {
    return await db().interviewDeck.findUnique({
      where: {
        userId_interviewKey: { userId, interviewKey },
      },
    });
  } catch (err) {
    throw storeDown(err);
  }
}

// First write wins. A retry with the same interviewKey returns the
// existing row and does not change topic or transcript.
async function saveDeck({ userId, topic, transcript, interviewKey }) {
  const owner = requireUserId(userId);
  const key = readInterviewKey(interviewKey);
  const data = {
    userId: owner,
    interviewKey: key,
    topic: readTopic(topic),
    transcript: readTranscript(transcript),
  };
  await ensureTable();
  const existing = await findByKey(owner, key);
  if (existing) return existing;
  try {
    return await db().interviewDeck.create({ data });
  } catch (err) {
    if (isUniqueConflict(err)) {
      const raced = await findByKey(owner, key);
      if (raced) return raced;
    }
    throw storeDown(err);
  }
}

async function listDecks({ userId } = {}) {
  const owner = requireUserId(userId);
  await ensureTable();
  try {
    return await db().interviewDeck.findMany({
      where: { userId: owner },
      orderBy: { updatedAt: "desc" },
    });
  } catch (err) {
    throw storeDown(err);
  }
}

async function getDeck({ id, userId }) {
  const owner = requireUserId(userId);
  await ensureTable();
  return loadOwned(id, owner);
}

module.exports = {
  TABLE_STATEMENTS,
  ensureTable,
  resetTableCache,
  saveDeck,
  listDecks,
  getDeck,
};
