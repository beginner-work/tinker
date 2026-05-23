/* POST /api/post-on-social
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { platform: string, essay: { id: string, title?: string, body: string } }
 * Reply: {
 *   score: integer 1-10,
 *   reason: string,
 *   reader_question: string,
 *   fit: boolean (score >= 7),
 *   scorer_model: string
 * }
 *
 * Scores a single piece of the founder's writing for how well it would
 * land as a post on the chosen platform. The model never writes post
 * text — only the score, the reason, and one reader-POV question that
 * points the writer at a concrete observation a scroller would notice
 * in THIS essay. The writer opens the platform's composer empty and
 * writes the post themselves.
 *
 * Mirrors api/classify/index.js for prompt-shape, model selection,
 * server-side key handling, and parsing.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");

const MODEL = "claude-haiku-4-5-20251001";
const FIT_THRESHOLD = 7;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(typeof req.body === "string" ? req.body : "{}");
  } catch {
    return null;
  }
}

function buildSystemPrompt() {
  return [
    "You score a single piece of writing for how well it would land as a post on a specific social platform. The writer is not asking you to write the post — they will write it themselves in their own words. You give:",
    "",
    "1. score: an integer 1–10. 10 means \"this would absolutely land on this platform\"; 1 means \"this would not land — too long, wrong register, wrong topic for that audience.\" Score conservatively. Most essays should be 4–7.",
    "",
    "2. reason: one short sentence that explains the score by referencing something specific IN the essay. Quote a phrase from the essay if a phrase carries the reason. Never generic (\"strong voice,\" \"good topic\"). Always concrete (\"the line about your barber handing you a hundred dollars is the kind of receipt that lands here\").",
    "",
    "3. reader_question: one short question that points the writer at a concrete observation a scroller would notice in THIS essay. The question is for the writer to chew on before they open the composer — it gives them an angle. Never generic (\"what would your reader think?\"). Always specific (\"what does it feel like to be your barber in that moment — could you open with that?\").",
    "",
    "Register awareness by platform: LinkedIn = longer, professional. X = punchy, short. Bluesky = casual, conversational. Threads = personal, low-stakes. Substack Notes = short, literary. For platforms you don't recognise, score as generic prose for a general feed.",
    "",
    "Respond with one JSON object: {\"score\": N, \"reason\": \"...\", \"reader_question\": \"...\"}. Never wrap in code fences. Never add explanation outside the JSON.",
  ].join("\n");
}

function parseJson(text) {
  const trimmed = (text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try { return JSON.parse(stripped); }
  catch { return null; }
}

async function callClaude({ system, userMessage, model, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), { status: 503 });
  }
  const body = {
    model: model || MODEL,
    max_tokens: Math.min(Math.max(Number(maxTokens) || 512, 1), 1024),
    system: [
      { type: "text", text: String(system), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userMessage }],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (data.error?.message || data.error)) || `Anthropic ${res.status}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

function clampScore(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  if (n < 1) return 1;
  if (n > 10) return 10;
  return n;
}

function validateString(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

const handler = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  try {
    await authenticateSession(token);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const platform = validateString(body.platform);
  const essay = body.essay && typeof body.essay === "object" ? body.essay : null;
  const essayBody = essay ? validateString(essay.body) : null;
  if (!platform || !essay || !essayBody) {
    res.status(400).json({ error: "platform and essay.body are required" });
    return;
  }

  const essayTitle = validateString(essay.title);
  const userMessage = [
    `Platform: ${platform}`,
    "",
    "Writing:",
    essayTitle ? `Title: ${essayTitle}` : null,
    "",
    essayBody,
  ].filter((line) => line !== null).join("\n");

  const system = buildSystemPrompt();

  let score = null;
  let reason = null;
  let readerQuestion = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let rawText = "";
    let parsed = null;
    try {
      rawText = await callClaude({
        system,
        userMessage,
        model: MODEL,
        maxTokens: 512,
      });
      parsed = parseJson(rawText);
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message || "Upstream error" });
      return;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const s = clampScore(parsed.score);
    const r = validateString(parsed.reason);
    const q = validateString(parsed.reader_question);
    if (s !== null && r && q) {
      score = s;
      reason = r;
      readerQuestion = q;
      break;
    }
  }

  if (score === null || !reason || !readerQuestion) {
    res.status(502).json({ error: "Couldn't read this one." });
    return;
  }

  res.status(200).json({
    score,
    reason,
    reader_question: readerQuestion,
    fit: score >= FIT_THRESHOLD,
    scorer_model: MODEL,
  });
});

module.exports = handler;
module.exports.__test__ = {
  MODEL,
  FIT_THRESHOLD,
  buildSystemPrompt,
  parseJson,
  clampScore,
  validateString,
};
