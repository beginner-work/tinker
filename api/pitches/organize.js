/* POST /api/pitches/organize
 *
 * Authorization: Bearer <stytch session_token>
 *
 * The backend pitch-organization job. Reads the user's essays,
 * drafts, and existing pitches blob straight out of TinkerUserData,
 * decides which writings haven't been slotted into any pitch yet,
 * runs the cluster + name model calls server-side, folds the results
 * back into the blob, and persists the result as kind="pitches".
 *
 * The client used to do all of this at app load — fetch /api/alt-pitches
 * (cluster), then /api/alt-pitches (name) one-pitch-at-a-time, folding
 * each reply into localStorage. That blocked the boot path on N
 * round-trips and ran on every hydrate. This endpoint moves the whole
 * sequence to the server: the client triggers it once (debounced after
 * a writing changes) and reads the persisted blob via the normal
 * /api/user-data/pitches hydrate path.
 *
 * Reply shape:
 *   { ok: true, pitches: <full blob>, updatedAt, summary }
 *
 * `summary` is { offPitchCount, rehomed, renamed, pitchesBefore,
 * pitchesAfter, skippedReason | null } — useful for preview logs and
 * for the client to decide whether to bother re-rendering.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");
const { organize } = require("../_lib/pitches-organizer.js");
const {
  clusterWritings,
  nameWritings,
} = require("../_lib/pitches-clusterer.js");

const KIND_ESSAYS = "essays";
const KIND_DRAFTS = "drafts";
const KIND_PITCHES = "pitches";

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

// The organize body is tiny (`{}` for the normal debounced trigger,
// `{ "redistribute": true }` for the founder-pressed re-align button).
// Vercel may have parsed it already; otherwise read the stream. A
// missing/blank/garbled body just yields {} — the job runs in its
// default (rehome-only) mode.
function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 4096) { req.destroy(); resolve({}); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
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

async function loadKind(userId, kind) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  return row ? row.data : null;
}

async function saveKind(userId, kind, data) {
  return prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind } },
    create: { userId, kind, data },
    update: { data },
  });
}

const handler = withResponseLogging(async function handler(req, res) {
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

  const isPreview = process.env.VERCEL_ENV === "preview";

  let body = {};
  try { body = await readJsonBody(req); }
  catch { body = {}; }
  const redistribute = !!(body && body.redistribute);

  let essays, drafts, storedBlob;
  try {
    [essays, drafts, storedBlob] = await Promise.all([
      loadKind(userId, KIND_ESSAYS),
      loadKind(userId, KIND_DRAFTS),
      loadKind(userId, KIND_PITCHES),
    ]);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load user data" });
    return;
  }

  const safeEssays = Array.isArray(essays) ? essays : [];
  const safeDrafts = Array.isArray(drafts) ? drafts : [];

  let result;
  try {
    result = await organize({
      storedBlob,
      essays: safeEssays,
      drafts: safeDrafts,
      redistribute,
      cluster: async ({ writings, existingPitchTitles }) =>
        clusterWritings({
          writings,
          existingPitchTitles,
          log: isPreview
            ? (attempt, raw) => {
                try { console.log(`[pitches.organize.cluster] user=${userId} attempt=${attempt} raw=${String(raw).slice(0, 400)}`); }
                catch { /* ignore */ }
              }
            : null,
        }),
      name: async ({ writings }) =>
        nameWritings({
          writings,
          log: isPreview
            ? (attempt, raw) => {
                try { console.log(`[pitches.organize.name] user=${userId} attempt=${attempt} raw=${String(raw).slice(0, 200)}`); }
                catch { /* ignore */ }
              }
            : null,
        }),
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Organize failed" });
    return;
  }

  let updatedAt;
  try {
    const saved = await saveKind(userId, KIND_PITCHES, result.blob);
    updatedAt = saved.updatedAt;
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to save pitches" });
    return;
  }

  if (isPreview) {
    try {
      console.log(`[pitches.organize] user=${userId} summary=${JSON.stringify(result.summary)}`);
    } catch { /* ignore */ }
  }

  res.status(200).json({
    ok: true,
    pitches: result.blob,
    updatedAt,
    summary: result.summary,
  });
});

module.exports = handler;
module.exports.__test__ = {
  extractBearer,
};
