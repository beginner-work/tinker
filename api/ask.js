/* POST /api/ask
 *
 * Server-to-server grounded answer + TTS for embeddable hosts
 * (starting with lindowlabs.dev). Accepts JSON:
 *   {
 *     question,
 *     input: "voice" | "typed",
 *     rawTranscript?,
 *     position?: { wordIndex?, timestampMs?, paragraph? },
 *     sourceId,   // e.g. "lindowlabs-minds-and-models"
 *     context?
 *   }
 *
 * Auth (same as /api/transcribe — one of):
 *   Authorization: Bearer <TINKER_SERVICE_TOKEN>
 *   X-Tinker-Service-Token: <TINKER_SERVICE_TOKEN>
 *   Authorization: Bearer <Stytch session>  (Tinker UI only)
 *
 * Optional X-Tinker-Caller (e.g. "lindowlabs.dev") labels usage rows.
 * Never expose ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, or
 * TINKER_SERVICE_TOKEN to the browser: embeds proxy through their origin.
 *
 * Response: { answerText, audio, requestId, latencyMs }
 *   audio is a base64 MP3 string (no data: prefix).
 *
 * Env:
 *   TINKER_SERVICE_TOKEN   shared secret for S2S callers
 *   ANTHROPIC_API_KEY      Claude for grounded answers
 *   ELEVENLABS_API_KEY     TTS (same key as /feed and /api/transcribe)
 *   ASK_MODEL              optional; defaults to Claude Haiku 4.5
 *   DATABASE_URL           Postgres for AskRequest rows
 */

"use strict";

const { withResponseLogging } = require("./_lib/log.js");
const defaultPrisma = require("./_lib/db.js");
const stytch = require("./_lib/stytch.js");
const ask = require("./_lib/ask.js");
const { readJsonBody } = require("./_lib/user-data.js");

function createHandler(deps) {
  const prisma = (deps && deps.prisma) || defaultPrisma;
  const authenticateSession =
    (deps && deps.authenticateSession) || stytch.authenticateSession;
  const answerFn = (deps && deps.answerWithClaude) || ask.answerWithClaude;
  const speakFn = (deps && deps.speakAnswer) || ask.speakAnswer;
  const logRow = (deps && deps.logAsk) || ask.logAsk;
  const newId = (deps && deps.newRequestId) || ask.newRequestId;
  const loadSource = (deps && deps.loadSource) || ask.loadSource;
  const parseBody = (deps && deps.parseAskBody) || ask.parseAskBody;
  const readBody = (deps && deps.readJsonBody) || readJsonBody;

  async function resolveCaller(req) {
    const expected = ask.serviceToken();
    const headers = req.headers || {};
    const bearer = ask.extractBearer(headers.authorization || headers.Authorization);
    const headerToken = String(
      headers["x-tinker-service-token"] || headers["X-Tinker-Service-Token"] || "",
    ).trim();

    if (expected) {
      if (bearer && ask.timingSafeEqual(bearer, expected)) {
        const label =
          String(headers["x-tinker-caller"] || headers["X-Tinker-Caller"] || "service").trim() ||
          "service";
        return { caller: `service:${label}`, via: "service-token" };
      }
      if (headerToken && ask.timingSafeEqual(headerToken, expected)) {
        const label =
          String(headers["x-tinker-caller"] || headers["X-Tinker-Caller"] || "service").trim() ||
          "service";
        return { caller: `service:${label}`, via: "service-token" };
      }
    }

    if (bearer) {
      try {
        const session = await authenticateSession(bearer);
        const userId =
          (session && session.session && session.session.user_id) ||
          (session && session.user && session.user.user_id) ||
          "";
        if (userId) return { caller: `user:${userId}`, via: "session" };
      } catch {
        // Fall through.
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
    let parsed = {
      question: "",
      input: "",
      sourceId: "",
      rawTranscript: "",
      position: null,
      context: "",
    };
    let answerText = "";
    let model = "";
    let voiceId = "";
    let hasAudio = false;
    let audio = "";

    try {
      const auth = await resolveCaller(req);
      caller = auth.caller;

      if (!ask.anthropicApiKey()) {
        const err = new Error("ANTHROPIC_API_KEY is not configured on this deploy.");
        err.status = 503;
        throw err;
      }
      if (!ask.elevenLabsApiKey()) {
        const err = new Error("ELEVENLABS_API_KEY is not configured on this deploy.");
        err.status = 503;
        throw err;
      }

      const body = await readBody(req);
      parsed = parseBody(body);

      const source = loadSource(parsed.sourceId);
      if (!source) {
        const err = new Error(`Unknown sourceId: ${parsed.sourceId}`);
        err.status = 404;
        throw err;
      }
      voiceId = source.voiceId || ask.DEFAULT_VOICE_ID;

      const answered = await answerFn({
        source,
        question: parsed.question,
        input: parsed.input,
        rawTranscript: parsed.rawTranscript,
        position: parsed.position,
        context: parsed.context,
      });
      answerText = answered.answerText;
      model = answered.model;

      const spoken = await speakFn({ text: answerText, voiceId });
      audio = spoken.audioBase64 || "";
      voiceId = spoken.voiceId || voiceId;
      hasAudio = Boolean(audio);

      const latencyMs = Date.now() - started;
      await logRow(prisma, {
        id: requestId,
        caller,
        status: "ok",
        latencyMs,
        sourceId: parsed.sourceId,
        inputType: parsed.input,
        question: parsed.question,
        rawTranscript: parsed.rawTranscript,
        editedTranscript: parsed.question,
        position: parsed.position,
        context: parsed.context,
        answerText,
        model,
        voiceId,
        hasAudio,
        error: "",
      });

      res.status(200).json({
        answerText,
        audio,
        requestId,
        latencyMs,
        label: source.label,
      });
    } catch (err) {
      const status = (err && err.status) || 500;
      const message = (err && err.message) || "Ask failed";
      const latencyMs = Date.now() - started;
      await logRow(prisma, {
        id: requestId,
        caller,
        status: "error",
        latencyMs,
        sourceId: parsed.sourceId,
        inputType: parsed.input,
        question: parsed.question,
        rawTranscript: parsed.rawTranscript,
        editedTranscript: parsed.question,
        position: parsed.position,
        context: parsed.context,
        answerText,
        model,
        voiceId,
        hasAudio,
        error: String(message).slice(0, 500),
      });
      res.status(status).json({ error: message, requestId });
    }
  });
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.__test__ = { createHandler };
