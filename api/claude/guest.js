/* POST /api/claude/guest
 *
 * Body: { entryId, seed, transcript: [{ q, a }] }
 * Reply: { question }
 *
 * Unauthenticated question generator for the signed-out onboarding
 * interview. A guest gets three questions before the sign-in gate;
 * static fallbacks read canned, so this endpoint lets Claude phrase
 * them — the opener mood-tuned to the location the founder picked, the
 * follow-ups grounded in what they actually wrote — while staying safe
 * to expose without auth:
 *
 *   - The prompt is built entirely server-side. The client supplies
 *     only the scene (location) and its own prior turns; it can never
 *     pick the system prompt, the model, or the token budget, so the
 *     route is useless as a general Claude proxy.
 *   - Inputs are hard-capped (3 turns, 120-char seed, 4000-char
 *     answers) and a transcript that already holds three answers is
 *     refused — mirroring the client-side cap.
 *   - Output is one short question (max_tokens 80) from Haiku — the
 *     cheap tier, deliberately, for an unauthenticated surface.
 *   - Best-effort per-IP rate limit (in-memory token bucket per warm
 *     serverless instance). Not bulletproof across instances, but with
 *     the caps above the worst case is bounded and tiny.
 *
 * The renderer falls back to its fixed GUEST_QUESTIONS list whenever
 * this endpoint errors, rate-limits, or the deployment has no
 * ANTHROPIC_API_KEY — the guest flow never blocks on it.
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");

const MAX_TURNS = 3;
const MAX_SEED_LEN = 120;
const MAX_ENTRY_ID_LEN = 64;
const MAX_QUESTION_LEN = 300;
const MAX_ANSWER_LEN = 4000;

// Per-IP budget: enough for many guest sessions an hour, far too small
// to be interesting as free compute.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const SYSTEM_PROMPT = [
  "You ask the interview questions for tinker, a quiet writing tool for founders.",
  "The person answering has just opened the app and is not signed in; they get three",
  "questions total. Your job is to ask the next one.",
  "",
  "Constraints:",
  "- Single open-ended question, 6 to 16 words, ending with a question mark.",
  "- MUST contain the word 'learning' or one close synonym (discovering, noticing,",
  "  figuring out, realising, understanding, picking up, working out, coming to see,",
  "  finding out, recognising). Vary the synonym; don't repeat one already used.",
  "- If a location is given, let it set the mood and word choice.",
  "- If prior answers are given, your question MUST follow from them — pick up the",
  "  most alive thread in the founder's own vocabulary. Never ignore what they wrote.",
  "- Do NOT assume what they are learning. Do NOT lead. Do NOT ask about feelings.",
  "- Do NOT mention signing in, accounts, or the app itself.",
  "- Output ONLY the question. No quotes, no preamble, no trailing notes.",
].join("\n");

/** Coerce the client payload into safe, capped inputs — or null when
 *  the request is malformed or the guest has already used three turns. */
function normalizeInput(raw) {
  if (!raw || typeof raw !== "object") return null;
  const seed = typeof raw.seed === "string" ? raw.seed.trim().slice(0, MAX_SEED_LEN) : "";
  const entryId =
    typeof raw.entryId === "string" ? raw.entryId.trim().slice(0, MAX_ENTRY_ID_LEN) : "";
  const transcript = [];
  if (Array.isArray(raw.transcript)) {
    for (const turn of raw.transcript.slice(0, MAX_TURNS)) {
      if (!turn || typeof turn !== "object") continue;
      const q = typeof turn.q === "string" ? turn.q.trim().slice(0, MAX_QUESTION_LEN) : "";
      const a = typeof turn.a === "string" ? turn.a.trim().slice(0, MAX_ANSWER_LEN) : "";
      if (!q || !a) continue;
      transcript.push({ q, a });
    }
  }
  // Three answers = the guest interview is over; the gate handles the rest.
  if (transcript.length >= MAX_TURNS) return null;
  return { seed, entryId, transcript };
}

function buildUserMessage({ seed, transcript }) {
  const lines = [];
  if (seed) lines.push(`Where the founder is right now: ${seed}`);
  if (transcript.length === 0) {
    if (lines.length) lines.push("");
    lines.push("This is the opening question. Ask what they are learning, tuned to the scene.");
  } else {
    if (lines.length) lines.push("");
    lines.push("Conversation so far (the founder's answers are verbatim):", "");
    transcript.forEach((t, i) => {
      lines.push(`Q${i + 1}: ${t.q}`);
      lines.push(`A${i + 1}: ${t.a}`);
      lines.push("");
    });
    lines.push(`Ask question ${transcript.length + 1} of 3. It must follow from the answers above.`);
  }
  return lines.join("\n");
}

// ── Best-effort per-IP rate limit ────────────────────────────────────
// One bucket map per warm serverless instance. `nowFn` is injectable
// for tests.
const buckets = new Map();
function checkRateLimit(ip, nowFn) {
  const now = (nowFn || Date.now)();
  const key = ip || "unknown";
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS };
    buckets.set(key, b);
  }
  b.count += 1;
  // Opportunistic sweep so the map can't grow without bound.
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k);
    }
  }
  return b.count <= RATE_LIMIT;
}

function clientIp(req) {
  const fwd = req.headers && req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "";
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(typeof req.body === "string" ? req.body : "{}");
  } catch {
    return null;
  }
}

async function askClaude(input) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), { status: 503 });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Haiku on purpose: this route is unauthenticated, and one short
      // question doesn't need the big model.
      model: "claude-haiku-4-5",
      max_tokens: 80,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserMessage(input) }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (data.error?.message || data.error)) || `Anthropic ${res.status}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const textBlock = (data.content || []).find((b) => b.type === "text");
  let question = (textBlock ? textBlock.text : "").trim();
  question = question.replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  if (!question) {
    throw Object.assign(new Error("Empty question."), { status: 502 });
  }
  if (question.length > 200) question = question.slice(0, 200);
  return question;
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkRateLimit(clientIp(req))) {
    res.status(429).json({ error: "Too many requests — try again later." });
    return;
  }
  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const input = normalizeInput(body);
  if (!input) {
    res.status(400).json({ error: "Guest interview is over or the payload is malformed." });
    return;
  }
  try {
    const question = await askClaude(input);
    res.status(200).json({ question });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
  }
});

module.exports.__test__ = {
  MAX_TURNS,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  SYSTEM_PROMPT,
  normalizeInput,
  buildUserMessage,
  checkRateLimit,
  buckets,
};
