/* POST /api/entry/attach
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { entry: { id, createdAt, location, answers: [{ q, a, at }] } }
 * Reply: { ok: true, entryId, attachedAt }
 *
 * Attribution bridge for the signed-out onboarding flow. The web app
 * now opens on the welcome location grid and lets a founder answer up
 * to three interview questions before signing in; guest-entry.js
 * records that pre-login work locally under an anonymous entry id and
 * calls this endpoint the moment the founder verifies. We validate the
 * Stytch session, then store the entry — stamped with the user id and
 * the Stytch session id that claimed it — in the shared TinkerUserData
 * table under kind "entries", so the anonymous first touch is durably
 * tied to the account and session it converted into.
 *
 * Idempotent: entries merge by id, and the first attachedAt/sessionId
 * stamp wins, so a retried POST (flaky network, double event) never
 * duplicates or re-claims an entry.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");
const { readJsonBody, extractBearer } = require("../_lib/user-data.js");

const KIND = "entries";

// A founder realistically has one guest entry per device; the cap only
// guards against a runaway client filling the row.
const MAX_ENTRIES = 20;
const MAX_ANSWERS = 10;
const MAX_ID_LEN = 64;
const MAX_LOCATION_LEN = 120;
const MAX_QUESTION_LEN = 300;
const MAX_ANSWER_LEN = 4000;

/** Coerce the client-supplied entry into the exact stored shape, or
 *  null when there's nothing attributable in it. */
function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.trim().slice(0, MAX_ID_LEN) : "";
  if (!id) return null;
  const createdAt = Number(raw.createdAt) > 0 ? Number(raw.createdAt) : null;
  const location =
    typeof raw.location === "string"
      ? raw.location.trim().slice(0, MAX_LOCATION_LEN) || null
      : null;
  const answers = [];
  if (Array.isArray(raw.answers)) {
    for (const turn of raw.answers.slice(0, MAX_ANSWERS)) {
      if (!turn || typeof turn !== "object") continue;
      const q = typeof turn.q === "string" ? turn.q.trim().slice(0, MAX_QUESTION_LEN) : "";
      const a = typeof turn.a === "string" ? turn.a.trim().slice(0, MAX_ANSWER_LEN) : "";
      if (!q || !a) continue;
      answers.push({ q, a, at: Number(turn.at) > 0 ? Number(turn.at) : null });
    }
  }
  if (!location && answers.length === 0) return null;
  return { id, createdAt, location, answers };
}

/** Fold one attach into the stored list. Merging by id keeps the call
 *  idempotent; the original attachedAt/sessionId stamps are preserved
 *  on re-attach so the first claim stays the claim of record. */
function mergeEntries(existing, entry, meta) {
  const list = Array.isArray(existing)
    ? existing.filter((e) => e && typeof e === "object" && typeof e.id === "string")
    : [];
  const record = {
    ...entry,
    attachedAt: meta.attachedAt,
    sessionId: meta.sessionId || null,
  };
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    record.attachedAt = list[idx].attachedAt || meta.attachedAt;
    record.sessionId = list[idx].sessionId || meta.sessionId || null;
    list[idx] = record;
  } else {
    list.push(record);
  }
  return list.slice(-MAX_ENTRIES);
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  let sessionId = "";
  try {
    const token = extractBearer(req.headers && req.headers.authorization);
    const session = await authenticateSession(token);
    userId =
      (session && session.session && session.session.user_id) ||
      (session && session.user && session.user.user_id) ||
      "";
    sessionId = (session && session.session && session.session.session_id) || "";
    if (!userId) {
      throw Object.assign(new Error("Session missing user id"), { status: 401 });
    }
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Invalid JSON" });
    return;
  }

  const entry = normalizeEntry(body && body.entry);
  if (!entry) {
    res.status(400).json({ error: "Body must include an `entry` with an id and a location or answers" });
    return;
  }

  try {
    const row = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: KIND } },
    });
    const attachedAt = Date.now();
    const merged = mergeEntries(row ? row.data : null, entry, { attachedAt, sessionId });
    await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: KIND } },
      create: { userId, kind: KIND, data: merged },
      update: { data: merged },
    });
    const saved = merged.find((e) => e.id === entry.id);
    res.status(200).json({ ok: true, entryId: entry.id, attachedAt: saved ? saved.attachedAt : attachedAt });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});

module.exports.__test__ = {
  KIND,
  MAX_ENTRIES,
  MAX_ANSWERS,
  normalizeEntry,
  mergeEntries,
};
