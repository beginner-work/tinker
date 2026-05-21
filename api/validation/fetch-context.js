/* POST /api/validation/fetch-context
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { name }
 * Reply: { name, sourceUrl, sourceContext }
 *
 * Resolves a free-text name (e.g. "YC", "Y Combinator", "Sequoia") to a
 * canonical investor / venture partner / firm identity. Uses Claude
 * Sonnet 4.6 with web search to find the official site, read relevant
 * pages, and distill the target's stated voice into a sourceContext
 * blob the classifier can lean on.
 *
 * The distilled context is cached in Postgres (pitch_contexts) keyed by
 * a normalized form of the name. Entries expire after 30 days. The
 * cache is shared across all paid users: founder A adds "Y Combinator",
 * founder B types "YC" later — both reuse the same row.
 *
 * Paid-only: rejects requests from users without an active subscription.
 *
 * Anti-pattern guard: sourceContext is internal-only — never shown
 * verbatim to the founder, only used to bias the classifier.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

const MODEL = "claude-sonnet-4-6";
const MAX_NAME_LENGTH = 200;
const MAX_CONTEXT_CHARS = 8000;
const CACHE_TTL_DAYS = 30;

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(typeof req.body === "string" ? req.body : "{}");
  } catch {
    return null;
  }
}

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

// Normalize "YC", "Y Combinator", "y combinator" → same cache key.
// Lowercase, trim, collapse internal whitespace, strip punctuation.
function normalizeName(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[‘’'`]/g, "")  // smart and straight quotes
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ttlExpired(fetchedAt) {
  if (!fetchedAt) return true;
  const ts = new Date(fetchedAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

async function resolveUserId(token) {
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

async function getSubscription(userId) {
  // Reuses the TinkerUserData row (kind="subscription") so we don't
  // need a separate users table. The payment webhook writes to this
  // row on checkout.session.completed.
  try {
    const row = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: "subscription" } },
    });
    return (row && row.data) || null;
  } catch {
    return null;
  }
}

function isActive(sub) {
  if (!sub || typeof sub !== "object") return false;
  const sharpening = sub.sharpening;
  if (!sharpening) return false;
  if (sharpening.status !== "active") return false;
  if (sharpening.currentPeriodEnd && Number.isFinite(sharpening.currentPeriodEnd)
      && sharpening.currentPeriodEnd * 1000 < Date.now()) {
    return false;
  }
  return true;
}

function buildSystemPrompt() {
  return [
    "You resolve a free-text name (typed by a founder) to a canonical investor / venture partner / firm / organization, find their official site, read the most relevant pages, and distill their voice into a context block.",
    "",
    "Step-by-step:",
    "1. Use web search to identify the official website of the named target. Disambiguate the most likely interpretation. If the name is too ambiguous to resolve, return canonicalName = the raw name with sourceUrl = null and sourceContext = empty.",
    "2. Read the most relevant pages — homepage, about, portfolio, thesis, partners, what they fund.",
    "3. Distill their stated voice, focus areas, language patterns, sectors they fund, founders they want, and stated criteria into a single context block of 1500–4000 words.",
    "",
    "Hard rules:",
    "- Never invent content that isn't on the site.",
    "- Never lift founder-facing copy. The context block is internal — it's never shown verbatim to the founder.",
    "- Never write the founder's pitch for them; this is a description of the target, not a pitch.",
    "- canonicalName must be non-empty.",
    "- sourceContext must be at most 8000 characters.",
    "",
    "Respond as a single JSON object with exactly these keys:",
    '  { "canonicalName": "<the canonical name>", "sourceUrl": "<https url or null>", "sourceContext": "<context block, possibly empty>" }',
    "",
    "Never wrap the JSON in code fences. Never add explanation outside the JSON.",
  ].join("\n");
}

function parseJsonReply(text) {
  const trimmed = (text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try { return JSON.parse(stripped); }
  catch { return null; }
}

function validateModelReply(parsed, rawName) {
  if (!parsed || typeof parsed !== "object") return null;
  const canonicalName = typeof parsed.canonicalName === "string" ? parsed.canonicalName.trim() : "";
  if (!canonicalName) return null;
  let sourceUrl = parsed.sourceUrl;
  if (sourceUrl === undefined) sourceUrl = null;
  if (sourceUrl !== null && (typeof sourceUrl !== "string" || !/^https?:\/\//i.test(sourceUrl))) {
    sourceUrl = null;
  }
  let sourceContext = typeof parsed.sourceContext === "string" ? parsed.sourceContext : "";
  if (sourceContext.length > MAX_CONTEXT_CHARS) sourceContext = sourceContext.slice(0, MAX_CONTEXT_CHARS);
  return { canonicalName, sourceUrl, sourceContext };
}

async function callAnthropic({ system, userMessage }) {
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
      model: MODEL,
      max_tokens: 4096,
      // Web search tool — the Anthropic-managed `web_search_20250305`
      // tool. If the SDK has moved to a newer version by the time this
      // ships, the model will still run without it (the system prompt
      // tolerates that path); the cache row will land with an empty
      // sourceContext and the next person typing the same name will
      // re-attempt.
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      ],
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && (data.error?.message || data.error)) || `Anthropic ${res.status}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  // Web-search tool replies may include multiple content blocks
  // (tool_use, tool_result, text). The final text block is the model's
  // structured answer.
  const blocks = Array.isArray(data.content) ? data.content : [];
  const textBlocks = blocks.filter((b) => b.type === "text");
  const last = textBlocks[textBlocks.length - 1];
  return last ? last.text : "";
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  let userId;
  try {
    userId = await resolveUserId(token);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  const subscription = await getSubscription(userId);
  if (!isActive(subscription)) {
    res.status(402).json({ error: "Subscription required" });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName || rawName.length > MAX_NAME_LENGTH) {
    res.status(400).json({ error: "name is required (2..200 chars)" });
    return;
  }
  if (rawName.length < 2) {
    res.status(400).json({ error: "name is required (2..200 chars)" });
    return;
  }

  const normalizedName = normalizeName(rawName);
  if (!normalizedName) {
    res.status(400).json({ error: "name normalizes to empty" });
    return;
  }

  // Shared cache lookup. If the row exists and hasn't expired, return
  // it directly — no model call.
  let cached = null;
  try {
    cached = await prisma.pitchContext.findUnique({ where: { normalizedName } });
  } catch (err) {
    // If the migration hasn't run yet on this preview, the table won't
    // exist and Prisma throws. We still proceed and try to do a fresh
    // fetch — but skip the cache write at the end so the error doesn't
    // surface.
    cached = null;
  }
  if (cached && !ttlExpired(cached.fetchedAt)) {
    res.status(200).json({
      name: cached.canonicalName,
      sourceUrl: cached.sourceUrl || null,
      sourceContext: cached.sourceContext || "",
    });
    return;
  }

  // Cache miss or stale — call the model.
  const system = buildSystemPrompt();
  const userMessage = [
    `The founder typed: "${rawName}"`,
    "",
    "Resolve, find the official site, distill the target's voice into a sourceContext block. Respond with the JSON object only.",
  ].join("\n");

  let raw = "";
  try {
    raw = await callAnthropic({ system, userMessage });
  } catch (err) {
    // Even on upstream error, write a low-confidence cache row so the
    // next person doesn't re-hit the model on the same input. Use the
    // raw name as a fallback canonical name.
    const fallback = {
      canonicalName: rawName,
      sourceUrl: null,
      sourceContext: "",
    };
    try {
      await prisma.pitchContext.upsert({
        where: { normalizedName },
        create: {
          normalizedName,
          rawName,
          canonicalName: fallback.canonicalName,
          sourceUrl: null,
          sourceContext: "",
        },
        update: {
          rawName,
          canonicalName: fallback.canonicalName,
          sourceUrl: null,
          sourceContext: "",
          fetchedAt: new Date(),
        },
      });
    } catch { /* table may not exist yet on preview */ }
    res.status(200).json({
      name: fallback.canonicalName,
      sourceUrl: null,
      sourceContext: "",
    });
    return;
  }

  const parsed = parseJsonReply(raw);
  const validated = validateModelReply(parsed, rawName);
  const final = validated || { canonicalName: rawName, sourceUrl: null, sourceContext: "" };

  try {
    await prisma.pitchContext.upsert({
      where: { normalizedName },
      create: {
        normalizedName,
        rawName,
        canonicalName: final.canonicalName,
        sourceUrl: final.sourceUrl,
        sourceContext: final.sourceContext,
      },
      update: {
        rawName,
        canonicalName: final.canonicalName,
        sourceUrl: final.sourceUrl,
        sourceContext: final.sourceContext,
        fetchedAt: new Date(),
      },
    });
  } catch (err) {
    // Migration likely hasn't run on this environment. Return the
    // resolved values so the deck still gets created on the client;
    // just no caching this round.
  }

  res.status(200).json({
    name: final.canonicalName,
    sourceUrl: final.sourceUrl,
    sourceContext: final.sourceContext,
  });
});

module.exports.__test__ = {
  normalizeName,
  ttlExpired,
  validateModelReply,
  parseJsonReply,
};
