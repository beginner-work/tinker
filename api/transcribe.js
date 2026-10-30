/* POST /api/transcribe
 *
 * Server-to-server speech-to-text. Accepts an audio upload (webm / ogg /
 * mp4 / wav / mp3), calls ElevenLabs Scribe with ELEVENLABS_API_KEY, and
 * returns { text, words, durationMs, requestId }.
 *
 * Auth (one of):
 *   Authorization: Bearer <TINKER_SERVICE_TOKEN>
 *   X-Tinker-Service-Token: <TINKER_SERVICE_TOKEN>
 *   Authorization: Bearer <Stytch session>  (Tinker UI only)
 *
 * Optional X-Tinker-Caller (e.g. "lindowlabs.dev") labels service usage
 * rows. Never expose ELEVENLABS_API_KEY or TINKER_SERVICE_TOKEN to the
 * browser: embeds should proxy through their own origin.
 *
 * Env:
 *   TINKER_SERVICE_TOKEN   shared secret for S2S callers
 *   ELEVENLABS_API_KEY     ElevenLabs key (also used by /feed TTS)
 *   ELEVENLABS_STT_MODEL   optional; defaults to scribe_v2
 *   DATABASE_URL           Postgres for TranscriptionRequest rows
 */

"use strict";

const { withResponseLogging } = require("./_lib/log.js");
const defaultPrisma = require("./_lib/db.js");
const stytch = require("./_lib/stytch.js");
const transcribe = require("./_lib/transcribe.js");

function createHandler(deps) {
  const prisma = (deps && deps.prisma) || defaultPrisma;
  const authenticateSession =
    (deps && deps.authenticateSession) || stytch.authenticateSession;
  const callStt = (deps && deps.callElevenLabsStt) || transcribe.callElevenLabsStt;
  const parseUpload = (deps && deps.parseAudioUpload) || transcribe.parseAudioUpload;
  const logRow = (deps && deps.logTranscription) || transcribe.logTranscription;
  const newId = (deps && deps.newRequestId) || transcribe.newRequestId;

  async function resolveCaller(req) {
    const expected = transcribe.serviceToken();
    const headers = req.headers || {};
    const bearer = transcribe.extractBearer(headers.authorization || headers.Authorization);
    const headerToken = String(
      headers["x-tinker-service-token"] || headers["X-Tinker-Service-Token"] || "",
    ).trim();

    if (expected) {
      if (bearer && transcribe.timingSafeEqual(bearer, expected)) {
        const label = String(
          headers["x-tinker-caller"] || headers["X-Tinker-Caller"] || "service",
        ).trim() || "service";
        return { caller: `service:${label}`, via: "service-token" };
      }
      if (headerToken && transcribe.timingSafeEqual(headerToken, expected)) {
        const label = String(
          headers["x-tinker-caller"] || headers["X-Tinker-Caller"] || "service",
        ).trim() || "service";
        return { caller: `service:${label}`, via: "service-token" };
      }
    }

    // Tinker UI: signed-in Stytch session (no service token in the browser).
    if (bearer) {
      try {
        const session = await authenticateSession(bearer);
        const userId =
          (session && session.session && session.session.user_id) ||
          (session && session.user && session.user.user_id) ||
          "";
        if (userId) return { caller: `user:${userId}`, via: "session" };
      } catch {
        // Fall through to unauthorized / misconfigured responses below.
      }
    }

    if (!expected) {
      const err = new Error("TINKER_SERVICE_TOKEN is not configured on this deploy.");
      err.status = 503;
      throw err;
    }
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  return withResponseLogging(async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Tinker-Service-Token, X-Tinker-Caller",
      );
      res.status(204).end();
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const requestId = newId();
    const started = Date.now();
    let caller = "unknown";
    let mimeType = "";
    let byteLength = 0;
    let durationMs = null;
    let text = "";
    let words = [];
    let elevenLabsRequestId = "";

    try {
      const auth = await resolveCaller(req);
      caller = auth.caller;

      if (!transcribe.elevenLabsApiKey()) {
        const err = new Error("ELEVENLABS_API_KEY is not configured on this deploy.");
        err.status = 503;
        throw err;
      }

      const audio = await parseUpload(req);
      mimeType = audio.mimeType;
      byteLength = audio.byteLength;

      const result = await callStt({
        buffer: audio.buffer,
        mimeType: audio.mimeType,
      });
      text = result.text || "";
      words = result.words || [];
      durationMs = result.durationMs;
      elevenLabsRequestId = result.elevenLabsRequestId || "";

      const latencyMs = Date.now() - started;
      await logRow(prisma, {
        id: requestId,
        caller,
        status: "ok",
        latencyMs,
        durationMs,
        mimeType,
        byteLength,
        text,
        words,
        error: "",
        elevenLabsRequestId,
      });

      res.status(200).json({
        text,
        words,
        durationMs,
        requestId,
      });
    } catch (err) {
      const status = (err && err.status) || 500;
      const message = (err && err.message) || "Transcription failed";
      if (err && err.elevenLabsRequestId) elevenLabsRequestId = err.elevenLabsRequestId;
      const latencyMs = Date.now() - started;
      await logRow(prisma, {
        id: requestId,
        caller,
        status: "error",
        latencyMs,
        durationMs,
        mimeType,
        byteLength,
        text,
        words,
        error: String(message).slice(0, 500),
        elevenLabsRequestId,
      });
      res.status(status).json({ error: message, requestId });
    }
  });
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.__test__ = { createHandler };
