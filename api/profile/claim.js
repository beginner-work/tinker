/* POST /api/profile/claim — bind a stashed landing-form profile to the
 * signed-in Stytch account.
 *
 * The beginner landing form parks a profile in a pending TinkerUserData
 * row (userId="pending:<token>", kind="profile") and hands the token to
 * the app as `#claim=<token>`. After phone/PIN verify, the app calls
 * this endpoint with its Stytch session token + the claim token. We copy
 * the pending profile onto (user_id, "profile") — first write wins, so a
 * replayed token never clobbers an established profile — then delete the
 * pending row (single-use).
 *
 * No schema migration: reuses the shared (userId, kind) -> JSON store.
 * Auth mirrors api/_lib/user-data.js (Stytch session → user_id).
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

const KIND = "profile";
const PENDING_PREFIX = "pending:";
// Pending profiles are a short-lived bearer capability; expire them so a
// leaked/stale token can't be claimed indefinitely.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 16 * 1024;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

async function resolveUserId(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  const session = await authenticateSession(token);
  const userId =
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    "";
  if (!userId) {
    throw Object.assign(new Error("Session missing user id"), { status: 401 });
  }
  return userId;
}

function isExpired(data) {
  const created = data && data.createdAt ? Date.parse(data.createdAt) : NaN;
  return Number.isFinite(created) && Date.now() - created > TTL_MS;
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Invalid body" });
    return;
  }
  const claimToken =
    body && typeof body.claim_token === "string" ? body.claim_token.trim() : "";
  if (!claimToken) {
    res.status(400).json({ error: "Body must include a `claim_token`" });
    return;
  }

  const pendingKey = { userId_kind: { userId: PENDING_PREFIX + claimToken, kind: KIND } };
  const deletePending = () =>
    prisma.tinkerUserData.delete({ where: pendingKey }).catch(() => {});

  try {
    const pending = await prisma.tinkerUserData.findUnique({ where: pendingKey });

    // Nothing to claim (already consumed, never existed, or — on a
    // preview reading a different DB — simply not here): benign no-op.
    if (!pending || !pending.data) {
      res.status(200).json({ ok: true, claimed: false });
      return;
    }
    if (isExpired(pending.data)) {
      await deletePending();
      res.status(200).json({ ok: true, claimed: false });
      return;
    }

    // No overwrite: an established profile wins. Still consume the token.
    const existing = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: KIND } },
    });
    if (existing && existing.data) {
      await deletePending();
      res.status(200).json({ ok: true, claimed: false, profile: existing.data });
      return;
    }

    const profile = pending.data;
    await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: KIND } },
      create: { userId, kind: KIND, data: profile },
      update: { data: profile },
    });
    await deletePending();
    res.status(200).json({ ok: true, claimed: true, profile });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
