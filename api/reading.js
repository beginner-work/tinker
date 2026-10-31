/* /api/reading
 *
 * Milestone 1 reading agent. Actions via ?action=:
 *   POST session  → start a session from any public article URL
 *   POST speak    → TTS chunk from resume cursor
 *   POST ask      → interrupt with voice/typed question (Claude + tool use)
 *   POST event    → log LinkedIn / email / resume clicks
 *   GET  metrics  → read-only counts (service token or owner session)
 *
 * Auth for session/speak/ask/event (one of):
 *   Authorization: Bearer <TINKER_SERVICE_TOKEN>
 *   X-Tinker-Service-Token: <TINKER_SERVICE_TOKEN>
 *   Authorization: Bearer <Stytch session>
 *   Or a valid sessionId capability on speak/ask/event (possession auth)
 *
 * Session create prefers service token or Stytch. When
 * READING_PUBLIC_SESSIONS is unset or "1", the same-origin widget may
 * create a session without a token (session id is the capability).
 * Set READING_PUBLIC_SESSIONS=0 to require strong auth for session create.
 *
 * Env (Production):
 *   TINKER_SERVICE_TOKEN, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY
 *   READING_VOICE_ID (optional; stock Savvy default; never Tyler's voice)
 *   READING_MODEL / ASK_MODEL (optional)
 *   READING_PUBLIC_SESSIONS (optional; default allow for widget bootstrap)
 *   DATABASE_URL
 */

"use strict";

const { withResponseLogging } = require("./_lib/log.js");
const defaultPrisma = require("./_lib/db.js");
const stytch = require("./_lib/stytch.js");
const reading = require("./_lib/reading-agent.js");
const { readJsonBody } = require("./_lib/user-data.js");
const metricsEmit = require("./_lib/metrics/emit.js");
const resumeMetrics = require("./_lib/metrics/resume.js");

function actionOf(req) {
  try {
    return new URL(req.url || "/", "https://tinker.local")
      .searchParams.get("action") || "";
  } catch {
    return "";
  }
}

function createHandler(deps) {
  const prisma = (deps && deps.prisma) || defaultPrisma;
  const authenticateSession =
    (deps && deps.authenticateSession) || stytch.authenticateSession;
  const createSession = (deps && deps.createSession) || reading.createSession;
  const loadSession = (deps && deps.loadSession) || reading.loadSession;
  const ensureSessionText =
    (deps && deps.ensureSessionText) || reading.ensureSessionText;
  const answerReadingQuestion =
    (deps && deps.answerReadingQuestion) || reading.answerReadingQuestion;
  const speakChunk = (deps && deps.speakChunk) || reading.speakChunk;
  const updateResume = (deps && deps.updateResume) || reading.updateResume;
  const logQuestion = (deps && deps.logQuestion) || reading.logQuestion;
  const bumpSessionQuestionCount =
    (deps && deps.bumpSessionQuestionCount) || reading.bumpSessionQuestionCount;
  const logClick = (deps && deps.logClick) || reading.logClick;
  const collectMetrics = (deps && deps.collectMetrics) || reading.collectMetrics;
  const emitSessionStart =
    (deps && deps.emitSessionStart) || metricsEmit.emitSessionStart;
  const emitQuestionAsked =
    (deps && deps.emitQuestionAsked) || metricsEmit.emitQuestionAsked;
  const emitSdkLoaded = (deps && deps.emitSdkLoaded) || metricsEmit.emitSdkLoaded;
  const emitAnswerLinkClick =
    (deps && deps.emitAnswerLinkClick) || metricsEmit.emitAnswerLinkClick;
  const recordEmbedHost =
    (deps && deps.recordEmbedHost) || resumeMetrics.recordEmbedHost;
  const readBody = (deps && deps.readJsonBody) || readJsonBody;
  const chunkTextFromWord =
    (deps && deps.chunkTextFromWord) || reading.chunkTextFromWord;

  function clientMeta(body) {
    const anonymousId = resumeMetrics.normalizeAnonymousId(
      body && (body.anonymousId || body.aid),
    );
    const isOwner = metricsEmit.isOwnerTraffic(
      body && (body.owner === true || body.owner === "1" || body.isOwner)
        ? true
        : body && body.owner,
    );
    const embedHost = resumeMetrics.normalizeHost(
      (body && (body.embedHost || body.host)) || "",
    );
    const platform = reading.normalizePlatform(body && body.platform);
    return { anonymousId, isOwner, embedHost, platform };
  }

  async function resolveStrongAuth(req) {
    const expected = reading.serviceToken();
    const headers = req.headers || {};
    const bearer = reading.extractBearer(
      headers.authorization || headers.Authorization,
    );
    const headerToken = String(
      headers["x-tinker-service-token"] || headers["X-Tinker-Service-Token"] || "",
    ).trim();

    if (expected) {
      if (bearer && reading.timingSafeEqual(bearer, expected)) {
        const label =
          String(
            headers["x-tinker-caller"] || headers["X-Tinker-Caller"] || "service",
          ).trim() || "service";
        return { caller: `service:${label}`, via: "service-token" };
      }
      if (headerToken && reading.timingSafeEqual(headerToken, expected)) {
        const label =
          String(
            headers["x-tinker-caller"] || headers["X-Tinker-Caller"] || "service",
          ).trim() || "service";
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

  async function resolveSessionAuth(req, sessionId) {
    try {
      return await resolveStrongAuth(req);
    } catch (err) {
      if (err && err.status === 503) throw err;
      // Possession of an unguessable session id is enough for speak/ask/event.
      const row = await loadSession(prisma, sessionId);
      if (row && row.id) {
        return { caller: row.caller || "session", via: "session-id", session: row };
      }
      throw err;
    }
  }

  function publicSessionsAllowed() {
    const raw = String(process.env.READING_PUBLIC_SESSIONS || "1").trim().toLowerCase();
    return raw !== "0" && raw !== "false" && raw !== "off";
  }

  async function resolveSessionCreateAuth(req) {
    try {
      return await resolveStrongAuth(req);
    } catch (err) {
      if (err && err.status === 503) throw err;
      if (publicSessionsAllowed()) {
        return { caller: "widget:public", via: "public-session" };
      }
      throw err;
    }
  }

  async function handleSession(req, res) {
    const auth = await resolveSessionCreateAuth(req);
    const body = await readBody(req);
    const url = String(body.url || body.sourceUrl || "").trim();
    if (!url) {
      res.status(400).json({ error: "url is required" });
      return;
    }
    const meta = clientMeta(body);
    const started = Date.now();
    const created = await createSession(prisma, {
      url,
      caller: auth.caller,
      anonymousId: meta.anonymousId,
      isOwner: meta.isOwner,
      embedHost: meta.embedHost,
      platform: meta.platform,
    });
    if (meta.embedHost) {
      await recordEmbedHost(prisma, meta.embedHost);
      await emitSdkLoaded(
        {
          host: meta.embedHost,
          anonymousId: meta.anonymousId || "",
          platform: meta.platform || "",
        },
        { isOwner: meta.isOwner, headers: req.headers },
      );
    }
    await emitSessionStart(
      {
        sessionId: created.sessionId,
        anonymousId: meta.anonymousId || "",
        sourceHost: created.companyHost || "",
        site_domain: created.companyHost || "",
        host: meta.embedHost || "",
        platform: meta.platform || created.platform || "",
      },
      { isOwner: meta.isOwner, headers: req.headers },
    );
    res.status(200).json({
      ...created,
      latencyMs: Date.now() - started,
    });
  }

  async function handleSpeak(req, res) {
    const body = await readBody(req);
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }
    const auth = await resolveSessionAuth(req, sessionId);
    if (!reading.elevenLabsApiKey()) {
      res.status(503).json({ error: "ELEVENLABS_API_KEY is not configured on this deploy." });
      return;
    }

    const session = auth.session || (await loadSession(prisma, sessionId));
    if (!session) {
      res.status(404).json({ error: "Unknown sessionId" });
      return;
    }

    const fromWordIndex =
      body.fromWordIndex != null
        ? Math.max(0, Math.floor(Number(body.fromWordIndex)))
        : session.resumeWordIndex || 0;
    const maxChars =
      body.maxChars != null
        ? Math.max(200, Math.floor(Number(body.maxChars)))
        : reading.SPEAK_CHUNK_CHARS;

    const { text } = await ensureSessionText(session);
    const chunk = chunkTextFromWord(text, fromWordIndex, maxChars);
    if (!chunk.chunkText) {
      res.status(200).json({
        sessionId,
        audio: "",
        fromWordIndex: chunk.fromWordIndex,
        toWordIndex: chunk.toWordIndex,
        done: true,
        wordCount: chunk.wordCount,
        sourceUrl: session.sourceUrl,
        attribution: session.author
          ? `${session.title} by ${session.author}`
          : session.title,
      });
      return;
    }

    const spoken = await speakChunk({
      text: chunk.chunkText,
      voiceId: session.voiceId || reading.readingVoiceId(),
    });
    await updateResume(prisma, sessionId, chunk.toWordIndex);

    res.status(200).json({
      sessionId,
      audio: spoken.audioBase64 || "",
      contentType: spoken.contentType || "audio/mpeg",
      voiceId: spoken.voiceId,
      fromWordIndex: chunk.fromWordIndex,
      toWordIndex: chunk.toWordIndex,
      done: chunk.done,
      wordCount: chunk.wordCount,
      chunkText: chunk.chunkText,
      sourceUrl: session.sourceUrl,
      title: session.title,
      author: session.author,
      attribution: session.author
        ? `${session.title} by ${session.author}`
        : session.title,
    });
  }

  async function handleAsk(req, res) {
    const body = await readBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const question = String(body.question || "").trim();
    const input = reading.normalizeInputType(body.input);
    const requestId = reading.newRequestId();
    const started = Date.now();

    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required", requestId });
      return;
    }
    if (!question) {
      res.status(400).json({ error: "question is required", requestId });
      return;
    }
    if (question.length > 2000) {
      res.status(400).json({ error: "question is too long", requestId });
      return;
    }
    if (!input) {
      res.status(400).json({ error: 'input must be "voice" or "typed"', requestId });
      return;
    }

    const auth = await resolveSessionAuth(req, sessionId);
    if (!reading.anthropicApiKey()) {
      res.status(503).json({
        error: "ANTHROPIC_API_KEY is not configured on this deploy.",
        requestId,
      });
      return;
    }
    if (!reading.elevenLabsApiKey()) {
      res.status(503).json({
        error: "ELEVENLABS_API_KEY is not configured on this deploy.",
        requestId,
      });
      return;
    }

    const session = auth.session || (await loadSession(prisma, sessionId));
    if (!session) {
      res.status(404).json({ error: "Unknown sessionId", requestId });
      return;
    }

    const position = reading.normalizePosition(body.position) || {
      wordIndex: session.resumeWordIndex || 0,
    };
    const rawTranscript = String(body.rawTranscript || "").trim().slice(0, 4000);
    const meta = clientMeta(body);
    const anonymousId = meta.anonymousId || session.anonymousId || "";
    const isOwner = meta.isOwner || Boolean(session.isOwner);
    const platform = meta.platform || reading.normalizePlatform(session.platform);

    let answerText = "";
    let model = "";
    let voiceId = session.voiceId || reading.readingVoiceId();
    let fetchedSource = false;
    let fetchedSourceUrl = "";
    let audio = "";

    try {
      const { text, links } = await ensureSessionText(session);
      const answered = await answerReadingQuestion({
        title: session.title,
        author: session.author,
        sourceUrl: session.sourceUrl,
        text,
        links: links || session.links || [],
        question,
        input,
        rawTranscript,
        position,
      });
      answerText = answered.answerText;
      model = answered.model;
      fetchedSource = Boolean(answered.toolUsed);
      fetchedSourceUrl = answered.fetchedSourceUrl || "";

      const spoken = await speakChunk({ text: answerText, voiceId });
      audio = spoken.audioBase64 || "";
      voiceId = spoken.voiceId || voiceId;

      const resumeWordIndex =
        typeof position.wordIndex === "number"
          ? position.wordIndex
          : session.resumeWordIndex || 0;
      await updateResume(prisma, sessionId, resumeWordIndex);

      const latencyMs = Date.now() - started;
      const siteDomain = session.companyHost || "";
      await logQuestion(prisma, {
        id: requestId,
        sessionId,
        caller: auth.caller,
        status: "ok",
        latencyMs,
        inputType: input,
        question,
        rawTranscript,
        answerText,
        model,
        voiceId,
        hasAudio: Boolean(audio),
        fetchedSource,
        fetchedSourceUrl,
        resumeWordIndex,
        position,
        sourceUrl: session.sourceUrl,
        companyHost: siteDomain,
        anonymousId,
        isOwner,
        platform,
      });
      await bumpSessionQuestionCount(prisma, sessionId);
      await emitQuestionAsked(
        {
          sessionId,
          anonymousId: anonymousId || "",
          input,
          sourceHost: siteDomain,
          site_domain: siteDomain,
          platform: platform || "",
        },
        { isOwner, headers: req.headers },
      );

      res.status(200).json({
        answerText,
        audio,
        requestId,
        latencyMs,
        sessionId,
        resumeWordIndex,
        fetchedSource,
        fetchedSourceUrl,
        sourceUrl: session.sourceUrl,
        companyHost: siteDomain,
        title: session.title,
        author: session.author,
        attribution: session.author
          ? `${session.title} by ${session.author}`
          : session.title,
        linkedInUrl: reading.LINKEDIN_URL,
        emailUrl: reading.EMAIL_URL,
      });
    } catch (err) {
      const status = (err && err.status) || 500;
      const message = (err && err.message) || "Ask failed";
      const latencyMs = Date.now() - started;
      await logQuestion(prisma, {
        id: requestId,
        sessionId,
        caller: auth.caller,
        status: "error",
        latencyMs,
        inputType: input,
        question,
        rawTranscript,
        answerText,
        model,
        voiceId,
        hasAudio: false,
        fetchedSource,
        fetchedSourceUrl,
        resumeWordIndex: position.wordIndex || 0,
        position,
        sourceUrl: session.sourceUrl,
        companyHost: session.companyHost || "",
        anonymousId,
        isOwner,
        platform,
        error: String(message).slice(0, 500),
      });
      res.status(status).json({ error: message, requestId });
    }
  }

  async function handleEvent(req, res) {
    const body = await readBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const target = String(body.target || body.type || "").trim().toLowerCase();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }
    if (!["linkedin", "email", "source", "resume"].includes(target)) {
      res.status(400).json({
        error: 'target must be "linkedin", "email", "source", or "resume"',
      });
      return;
    }
    const auth = await resolveSessionAuth(req, sessionId);
    const session = auth.session || (await loadSession(prisma, sessionId));
    if (!session) {
      res.status(404).json({ error: "Unknown sessionId" });
      return;
    }
    const href =
      target === "linkedin"
        ? reading.LINKEDIN_URL
        : target === "email"
          ? reading.EMAIL_URL
          : target === "source"
            ? session.sourceUrl
            : String(body.href || "");
    const meta = clientMeta(body);
    const anonymousId = meta.anonymousId || session.anonymousId || "";
    const isOwner = meta.isOwner || Boolean(session.isOwner);
    await logClick(prisma, {
      sessionId,
      caller: auth.caller,
      target,
      href,
      sourceUrl: session.sourceUrl,
      companyHost: session.companyHost || "",
      anonymousId,
      isOwner,
    });
    if (["linkedin", "email", "source"].includes(target)) {
      await emitAnswerLinkClick(
        {
          sessionId,
          anonymousId: anonymousId || "",
          target,
          sourceHost: session.companyHost || "",
        },
        { isOwner, headers: req.headers },
      );
    }
    if (target === "resume" && body.wordIndex != null) {
      await updateResume(prisma, sessionId, body.wordIndex);
    }
    res.status(200).json({ ok: true, target, href });
  }

  async function handleMetrics(req, res) {
    await resolveStrongAuth(req);
    const metrics = await collectMetrics(prisma);
    res.status(200).json(metrics);
  }

  return withResponseLogging(async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Tinker-Service-Token, X-Tinker-Caller",
      );
      res.status(204).end();
      return;
    }

    const action = actionOf(req).trim().toLowerCase();

    try {
      if (action === "session" && req.method === "POST") {
        await handleSession(req, res);
        return;
      }
      if (action === "speak" && req.method === "POST") {
        await handleSpeak(req, res);
        return;
      }
      if (action === "ask" && req.method === "POST") {
        await handleAsk(req, res);
        return;
      }
      if (action === "event" && req.method === "POST") {
        await handleEvent(req, res);
        return;
      }
      if (action === "metrics" && req.method === "GET") {
        await handleMetrics(req, res);
        return;
      }
      res.status(404).json({
        error:
          'Unknown action. Use ?action=session|speak|ask|event|metrics',
      });
    } catch (err) {
      const status = (err && err.status) || 500;
      res.status(status).json({ error: (err && err.message) || "Reading agent error" });
    }
  });
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.__test__ = { createHandler };
