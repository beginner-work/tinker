/* POST /api/upload/pitch-video
 *
 * Two-event endpoint that drives Vercel Blob's client-direct upload
 * flow for in-app pitch recordings. The renderer never POSTs the
 * video bytes through this function (Vercel's 4.5 MB body limit
 * would cap us at ~30 seconds of 720p webm) — instead it does the
 * two-step dance from the @vercel/blob/client SDK protocol:
 *
 *   1. The renderer POSTs
 *        { type: "blob.generate-client-token",
 *          payload: { pathname, clientPayload, multipart } }
 *      with the founder's Stytch session token in the Authorization
 *      header. We authenticate, validate the pitchId in clientPayload,
 *      and ask Vercel Blob for a short-lived client token scoped to
 *      that pathname / size / content-type.
 *
 *   2. The renderer PUTs the recording straight to Vercel Blob using
 *      that token. No bytes touch this function.
 *
 *   3. Vercel Blob POSTs back to this same URL with
 *        { type: "blob.upload-completed", payload: { blob, tokenPayload } }
 *      signed with our store's read/write token. We verify the signature
 *      (handleUpload does this for us) and upsert a TinkerUserData row
 *      keyed by (userId, "pitch-video:<pitchId>") so the renderer can
 *      look up the public URL on future loads.
 *
 * Body payload shapes are owned by @vercel/blob/client's handleUpload —
 * any future protocol bump there is what defines the wire format here.
 *
 * Required env:
 *   - BLOB_READ_WRITE_TOKEN  (auto-injected by Vercel when a Blob store
 *                             is linked to the project)
 *   - STYTCH_PROJECT_ID / STYTCH_SECRET / DATABASE_URL
 */

"use strict";

const { handleUpload } = require("@vercel/blob/client");
const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

// Two upper bounds. The protocol-envelope body (the JSON event from
// the renderer / from Vercel's completion callback) is small —
// 64 KB is generous. The recording itself is capped at 200 MB by
// the client token; that's the constraint Vercel Blob enforces on
// the direct upload, not on this function.
const MAX_ENVELOPE_BYTES = 64 * 1024;
const MAX_PITCH_VIDEO_BYTES = 200 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = ["video/webm", "video/mp4"];
const PATHNAME_PREFIX = "pitch-videos/";
const MAX_PATHNAME_LEN = 256;
// Pitch IDs come from the renderer's uid() — "p_" + 8 base36 chars.
// We also tolerate plain alphanumeric for future-proofing.
const PITCH_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

// Vercel's serverless adapter populates req.query, but plain Node http
// (and our tests) does not — fall back to parsing req.url.
function urlPitchId(req) {
  const raw = String((req && req.url) || "");
  if (!raw) return "";
  const q = raw.indexOf("?");
  if (q < 0) return "";
  try {
    const params = new URLSearchParams(raw.slice(q + 1));
    return params.get("pitchId") || "";
  } catch {
    return "";
  }
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_ENVELOPE_BYTES) {
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

// Pulled out so the test can exercise the validation rules without
// having to fake the whole handleUpload protocol.
function validatePathnameForPitch(pathname, pitchId) {
  if (typeof pathname !== "string" || !pathname.startsWith(PATHNAME_PREFIX)) {
    throw new Error("Pathname must live under pitch-videos/");
  }
  if (pathname.length > MAX_PATHNAME_LEN) {
    throw new Error("Pathname is too long");
  }
  // "pitch-videos/<pitchId>/<filename>"
  const rest = pathname.slice(PATHNAME_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    throw new Error("Pathname must be pitch-videos/<pitchId>/<filename>");
  }
  const pathnameId = rest.slice(0, slash);
  if (pathnameId !== pitchId) {
    throw new Error("Pathname pitchId does not match clientPayload");
  }
  const filename = rest.slice(slash + 1);
  if (!filename || filename.includes("/") || filename.includes("..")) {
    throw new Error("Pathname filename is invalid");
  }
}

function parseClientPayload(clientPayload) {
  let parsed;
  try { parsed = JSON.parse(String(clientPayload || "{}")); }
  catch { throw new Error("Invalid clientPayload (must be JSON)"); }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid clientPayload");
  }
  const pitchId = String(parsed.pitchId || "").trim();
  if (!pitchId || !PITCH_ID_RE.test(pitchId)) {
    throw new Error("Invalid pitchId");
  }
  return { pitchId };
}

async function handler(req, res) {
  if (req.method === "GET") {
    let userId;
    try {
      userId = await resolveUserId(req);
    } catch (err) {
      res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
      return;
    }
    const pitchId = String(((req.query && req.query.pitchId) || urlPitchId(req)) || "").trim();
    if (!pitchId || !PITCH_ID_RE.test(pitchId)) {
      res.status(400).json({ error: "Invalid pitchId" });
      return;
    }
    try {
      const row = await prisma.tinkerUserData.findUnique({
        where: { userId_kind: { userId, kind: `pitch-video:${pitchId}` } },
      });
      res.status(200).json({
        data: row ? row.data : null,
        updatedAt: row ? row.updatedAt : null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Internal error" });
    }
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Bad request" });
    return;
  }

  // The "generate-client-token" leg comes from the founder's browser
  // and must carry a valid session. The "upload-completed" leg comes
  // from Vercel Blob's infrastructure (not the browser) and is HMAC-
  // signed against BLOB_READ_WRITE_TOKEN — handleUpload verifies that
  // signature itself. So we only block on auth when the founder is
  // the caller; auth is irrelevant on the completion callback.
  if (body && body.type === "blob.generate-client-token") {
    try {
      // Pre-resolve and stash userId so onBeforeGenerateToken can reach
      // it without re-validating. authenticateSession does a network
      // call to Stytch; we don't want to make two on the same request.
      req._tinkerUserId = await resolveUserId(req);
    } catch (err) {
      res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
      return;
    }
  }

  // Fail loudly when the store isn't configured — without this the
  // handleUpload() call below blows up with a generic message and
  // the founder just sees "Upload failed" with no clue what's
  // wrong. (Vercel auto-injects BLOB_READ_WRITE_TOKEN when a Blob
  // store is linked to the project, so the fix is one click in the
  // dashboard.)
  if (body && body.type === "blob.generate-client-token" && !process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({
      error:
        "Vercel Blob is not configured on this deployment. Link a Blob store in the Vercel dashboard to enable cloud saves.",
    });
    return;
  }

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload /* , multipart */) => {
        const userId = req._tinkerUserId;
        if (!userId) throw new Error("Unauthorized");

        const { pitchId } = parseClientPayload(clientPayload);
        validatePathnameForPitch(pathname, pitchId);

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_PITCH_VIDEO_BYTES,
          // Pinned, server-known identity for onUploadCompleted. The
          // client never sees this, so it can't be forged.
          tokenPayload: JSON.stringify({ userId, pitchId }),
          // The renderer composes a timestamped filename so each take
          // gets a unique pathname — random suffixes would defeat
          // future "list takes for this pitch" affordances.
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let parsed = {};
        try { parsed = JSON.parse(String(tokenPayload || "{}")); }
        catch { /* tokenPayload was issued by us — if it's malformed
                   the signature check would already have failed. */ }
        const userId = String(parsed.userId || "");
        const pitchId = String(parsed.pitchId || "");
        if (!userId || !pitchId) return;

        const kind = `pitch-video:${pitchId}`;
        const data = {
          url: blob.url,
          downloadUrl: blob.downloadUrl,
          pathname: blob.pathname,
          contentType: blob.contentType || "video/webm",
          uploadedAt: Date.now(),
        };
        try {
          await prisma.tinkerUserData.upsert({
            where: { userId_kind: { userId, kind } },
            create: { userId, kind, data },
            update: { data },
          });
        } catch (err) {
          // Throwing here makes handleUpload return 500, which signals
          // Vercel Blob to retry the callback later. That's the right
          // behaviour — we want eventual consistency, not a silent loss.
          throw err;
        }
      },
    });
    res.status(200).json(json);
  } catch (err) {
    // Surface enough detail to actually debug a failed cloud save.
    // The error class names from @vercel/blob (BlobAccessError,
    // BlobContentTypeNotAllowedError, etc.) are useful context — the
    // founder doesn't see them, but they show up in Vercel logs and
    // get echoed back to the renderer so the playback panel can
    // display a real reason instead of just "Upload failed".
    const status = err && err.status ? err.status : 400;
    const message = (err && err.message) || "Bad request";
    const name = err && err.name ? String(err.name) : "Error";
    try {
      console.error("[upload/pitch-video]", name, message, err && err.stack);
    } catch { /* logging must never throw */ }
    res.status(status).json({ error: `${name}: ${message}` });
  }
}

module.exports = withResponseLogging(handler);
// Exported for unit tests that don't want the logging wrapper or the
// full handleUpload round-trip.
module.exports._raw = handler;
module.exports._validatePathnameForPitch = validatePathnameForPitch;
module.exports._parseClientPayload = parseClientPayload;
module.exports._constants = {
  MAX_PITCH_VIDEO_BYTES,
  ALLOWED_CONTENT_TYPES,
  PATHNAME_PREFIX,
};
