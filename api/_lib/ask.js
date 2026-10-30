/* Helpers for POST /api/ask — grounded spoken answers + ElevenLabs TTS.
 *
 * Auth helpers are shared with /api/transcribe (service token + Stytch).
 * The route owns HTTP; this module owns request validation, Claude
 * answering, TTS, and AskRequest logging.
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const { callElevenLabsTts, elevenLabsApiKey } = require("./essay-feed.js");
const {
  serviceToken,
  timingSafeEqual,
  extractBearer,
  newRequestId,
} = require("./transcribe.js");
const { loadSource, DEFAULT_VOICE_ID } = require("./ask-sources/index.js");
const models = require("../../src/renderer/lib/claude-models.js");

const LINKEDIN_FALLBACK = "https://www.linkedin.com/in/tlindow";
const MAX_QUESTION_CHARS = 2000;
const MAX_CONTEXT_CHARS = 4000;
const MAX_TRANSCRIPT_CHARS = 4000;

function askModelId() {
  const raw = process.env.ASK_MODEL || models.FAST || "claude-haiku-4-5-20251001";
  return String(raw).trim() || "claude-haiku-4-5-20251001";
}

function anthropicApiKey() {
  return String(process.env.ANTHROPIC_API_KEY || "").trim();
}

function normalizeInputType(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "voice" || v === "typed") return v;
  return "";
}

function normalizePosition(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  if (raw.wordIndex != null && Number.isFinite(Number(raw.wordIndex))) {
    out.wordIndex = Math.max(0, Math.floor(Number(raw.wordIndex)));
  }
  if (raw.timestampMs != null && Number.isFinite(Number(raw.timestampMs))) {
    out.timestampMs = Math.max(0, Math.floor(Number(raw.timestampMs)));
  }
  if (raw.paragraph != null && Number.isFinite(Number(raw.paragraph))) {
    out.paragraph = Math.max(0, Math.floor(Number(raw.paragraph)));
  } else if (typeof raw.paragraph === "string" && raw.paragraph.trim()) {
    out.paragraph = raw.paragraph.trim().slice(0, 500);
  }
  return Object.keys(out).length ? out : null;
}

function parseAskBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Expected a JSON object body"), { status: 400 });
  }
  const question = String(body.question == null ? "" : body.question).trim();
  if (!question) {
    throw Object.assign(new Error("question is required"), { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    throw Object.assign(new Error("question is too long"), { status: 400 });
  }

  const input = normalizeInputType(body.input);
  if (!input) {
    throw Object.assign(new Error("input must be \"voice\" or \"typed\""), { status: 400 });
  }

  const sourceId = String(body.sourceId == null ? "" : body.sourceId).trim();
  if (!sourceId) {
    throw Object.assign(new Error("sourceId is required"), { status: 400 });
  }

  const rawTranscript =
    body.rawTranscript == null ? "" : String(body.rawTranscript).trim().slice(0, MAX_TRANSCRIPT_CHARS);

  let context = "";
  if (body.context != null) {
    if (typeof body.context === "string") {
      context = body.context.trim().slice(0, MAX_CONTEXT_CHARS);
    } else {
      try {
        context = JSON.stringify(body.context).slice(0, MAX_CONTEXT_CHARS);
      } catch {
        context = "";
      }
    }
  }

  return {
    question,
    input,
    sourceId,
    rawTranscript,
    position: normalizePosition(body.position),
    context,
  };
}

function talkParagraphs(source) {
  const talk = (source.docs || []).find((d) =>
    /homepage-talk|minds-and-models|talk/i.test(d.name),
  );
  if (!talk) return [];
  return talk.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function positionHint(source, position) {
  if (!position) return "";
  const paras = talkParagraphs(source);
  const bits = [];
  if (typeof position.paragraph === "number" && paras[position.paragraph]) {
    bits.push(`Paragraph ${position.paragraph}: ${paras[position.paragraph]}`);
  } else if (typeof position.paragraph === "string") {
    bits.push(`Around: ${position.paragraph}`);
  }
  if (typeof position.wordIndex === "number") {
    bits.push(`Visitor interrupted near word index ${position.wordIndex}.`);
  }
  if (typeof position.timestampMs === "number") {
    bits.push(`Talk timestamp ≈ ${position.timestampMs} ms.`);
  }
  // Neighbors when we have a numeric paragraph.
  if (typeof position.paragraph === "number" && paras.length) {
    const i = position.paragraph;
    const nearby = paras.slice(Math.max(0, i - 1), Math.min(paras.length, i + 2));
    if (nearby.length) {
      bits.push(`Nearby talk:\n${nearby.join("\n\n")}`);
    }
  }
  return bits.join("\n");
}

function buildUserMessage({ question, input, rawTranscript, position, context, source }) {
  const parts = [];
  parts.push(`Visitor question (${input}): ${question}`);
  if (input === "voice" && rawTranscript && rawTranscript !== question) {
    parts.push(`Raw transcript before edits: ${rawTranscript}`);
  }
  const hint = positionHint(source, position);
  if (hint) parts.push(`Listener position in the talk:\n${hint}`);
  if (context) parts.push(`Extra host context:\n${context}`);
  parts.push(
    "Reply in 2–4 first-person spoken sentences, grounded only in the corpus. If you do not know, say so and point to LinkedIn.",
  );
  return parts.join("\n\n");
}

function fallbackUnknownAnswer(linkedinUrl) {
  const url = linkedinUrl || LINKEDIN_FALLBACK;
  return `I don't have that in what I've shared here. Reach me on LinkedIn at ${url} and I'm happy to talk more.`;
}

async function answerWithClaude({
  source,
  question,
  input,
  rawTranscript,
  position,
  context,
  callClaude,
  model,
}) {
  const doCall = callClaude || callAnthropic;
  const modelId = model || askModelId();
  const user = buildUserMessage({
    question,
    input,
    rawTranscript,
    position,
    context,
    source,
  });

  const result = await doCall({
    system: source.systemPrompt,
    messages: [{ role: "user", content: user }],
    model: modelId,
    maxTokens: 400,
  });

  let text = String((result && result.text) || "").trim();
  // Strip accidental markdown fences / bullets.
  text = text.replace(/^```[\s\S]*?```$/g, "").trim();
  text = text.replace(/^[-*]\s+/gm, "").trim();
  if (!text) {
    text = fallbackUnknownAnswer(source.linkedinUrl);
  }
  return {
    answerText: text,
    model: modelId,
    usage: (result && result.usage) || null,
  };
}

async function speakAnswer({ text, voiceId, apiKey, fetchFn, ttsFn }) {
  const doTts = ttsFn || callElevenLabsTts;
  const key = apiKey || elevenLabsApiKey();
  const vid = voiceId || DEFAULT_VOICE_ID;
  if (!key) {
    throw Object.assign(new Error("ELEVENLABS_API_KEY is not configured on this deploy."), {
      status: 503,
    });
  }
  const generated = await doTts({ text, voiceId: vid, apiKey: key, fetchFn });
  return {
    audioBase64: generated.audioBase64 || "",
    contentType: generated.contentType || "audio/mpeg",
    voiceId: vid,
  };
}

async function logAsk(prismaClient, row) {
  if (!prismaClient || typeof prismaClient.askRequest?.create !== "function") {
    return null;
  }
  try {
    return await prismaClient.askRequest.create({
      data: {
        id: row.id,
        caller: row.caller || "unknown",
        status: row.status || "error",
        latencyMs: row.latencyMs || 0,
        sourceId: row.sourceId || "",
        inputType: row.inputType || "",
        question: row.question || "",
        rawTranscript: row.rawTranscript || "",
        editedTranscript: row.editedTranscript || "",
        position: row.position || null,
        context: row.context || "",
        answerText: row.answerText || "",
        model: row.model || "",
        voiceId: row.voiceId || "",
        hasAudio: Boolean(row.hasAudio),
        error: row.error || "",
      },
    });
  } catch (err) {
    console.error("[ask] failed to persist AskRequest", err && err.message);
    return null;
  }
}

module.exports = {
  LINKEDIN_FALLBACK,
  DEFAULT_VOICE_ID,
  MAX_QUESTION_CHARS,
  askModelId,
  anthropicApiKey,
  serviceToken,
  timingSafeEqual,
  extractBearer,
  newRequestId,
  loadSource,
  parseAskBody,
  normalizeInputType,
  normalizePosition,
  talkParagraphs,
  positionHint,
  buildUserMessage,
  fallbackUnknownAnswer,
  answerWithClaude,
  speakAnswer,
  logAsk,
  elevenLabsApiKey,
};
