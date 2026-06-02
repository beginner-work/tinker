/* POST /api/membership/claim — bind a one-time pre-seed pass to the signed-in
 * Stytch account.
 *
 * A backer who scans a founder's QR can buy a single $9 "30-day pre-seed pass"
 * on the beginner Back me page without being signed in. Beginner's Stripe
 * webhook parks the paid pass in a pending TinkerUserData row
 * (userId="pending:<token>", kind="membership") and the /welcome page hands the
 * token to this app as `#claim=<token>` — the same channel the landing-form
 * profile uses (see api/profile/claim.js). After phone/PIN verify the app calls
 * this endpoint with its Stytch session token + the claim token; we copy the
 * pass onto (user_id, "membership") and delete the pending row (single-use).
 *
 * Merge: an existing *subscription* membership always wins (a pass must never
 * downgrade a paying member), and between two passes the later expiry wins, so
 * a replayed or stale token can't shorten access. No schema migration — reuses
 * the shared (userId, kind) -> JSON store and mirrors profile/claim.js auth.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");
const {
  MEMBERSHIP_KIND,
  isActiveMembership,
  isOneTimePass,
} = require("../_lib/membership.js");

const PENDING_PREFIX = "pending:";
// A parked pass is a short-lived bearer capability; expire it so a leaked/stale
// token can't be claimed indefinitely (the 30-day entitlement window inside the
// pass is separate — this only bounds how long the token stays redeemable).
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

function isStaleToken(data) {
  const created = data && data.createdAt ? Date.parse(data.createdAt) : NaN;
  return Number.isFinite(created) && Date.now() - created > TTL_MS;
}

/** Pure: the pass to keep when claiming `pending` over an `existing` row.
 *  Returns null when nothing should change (an active subscription wins, and a
 *  pass never overwrites a later-expiring pass). Exported for unit tests. */
function mergePass(existing, pending) {
  // A subscription-backed membership always outranks a one-time pass.
  if (isActiveMembership(existing) && !isOneTimePass(existing)) return null;
  // Between passes, keep whichever reaches furthest out.
  if (
    isOneTimePass(existing) &&
    Number(existing.currentPeriodEnd) >= Number(pending.currentPeriodEnd)
  ) {
    return null;
  }
  return pending;
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

  const pendingKey = {
    userId_kind: { userId: PENDING_PREFIX + claimToken, kind: MEMBERSHIP_KIND },
  };
  const deletePending = () =>
    prisma.tinkerUserData.delete({ where: pendingKey }).catch(() => {});

  try {
    const pending = await prisma.tinkerUserData.findUnique({ where: pendingKey });

    // Nothing to claim (already consumed, never existed, or — on a preview
    // reading a different DB — simply not here): benign no-op. The client keeps
    // the token and retries on a later load, so a webhook that hasn't written
    // the pending row yet isn't lost.
    if (!pending || !pending.data) {
      res.status(200).json({ ok: true, claimed: false });
      return;
    }
    if (isStaleToken(pending.data)) {
      await deletePending();
      res.status(200).json({ ok: true, claimed: false });
      return;
    }

    const existing = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: MEMBERSHIP_KIND } },
    });

    const grant = mergePass(existing && existing.data, pending.data);
    if (!grant) {
      // Already covered by a subscription or a longer pass — consume the token.
      await deletePending();
      res.status(200).json({ ok: true, claimed: false, membership: existing ? existing.data : null });
      return;
    }

    await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: MEMBERSHIP_KIND } },
      create: { userId, kind: MEMBERSHIP_KIND, data: grant },
      update: { data: grant },
    });
    await deletePending();
    res.status(200).json({ ok: true, claimed: true, membership: grant });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});

module.exports.mergePass = mergePass;
