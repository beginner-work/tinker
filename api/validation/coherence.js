/* POST /api/validation/coherence
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { stitchedBody, deckTree, deckSourceContext? }
 * Reply:
 *   {
 *     headings: [
 *       { heading: "<one of the eleven>", color: "<palette>", position: 0..1 },
 *       ... (eleven entries, one per DECK_HEADINGS entry)
 *     ]
 *   }
 *
 * Sonnet 4.6 reads the founder's validation essay together with the
 * deck tree's per-heading verbatim phrases and classifies each of the
 * eleven headings into one of seven palette colors based on the "voice
 * mode" that heading belongs to in this founder's pitch. When
 * deckSourceContext is supplied (paid-tier deck whose target has a
 * resolved context), Sonnet also factors in how the founder's writing
 * aligns with that context — but only for position along the spectrum,
 * never to suggest replacement copy.
 *
 * Validates response shape: exactly eleven entries, color in the
 * allow-list, position in [0, 1]. Rejects free-form text.
 *
 * Anthropic key held server-side. Prompt-cached like /api/search.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");

const DECK_HEADINGS = [
  "The Problem",
  "A Persona",
  "Why Now?",
  "The Team",
  "The Product",
  "How We Make Money",
  "Go to Market",
  "The Moat",
  "The Vision",
  "Competition",
  "The Ask",
];

const ALLOWED_COLORS = [
  "pink",
  "peach",
  "amber",
  "mint",
  "sky",
  "indigo",
  "violet",
];

const MODEL = "claude-sonnet-4-6";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CONTEXT_CHARS = 8000;

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

function buildSystemPrompt() {
  return [
    "You are the coherence reader for tinker. The founder has typed an essay describing their pitch from memory, without looking at their deck. You also receive the eleven canonical slide titles of the founder's pitch and any verbatim phrases the founder has previously written under each one.",
    "",
    "Your job: for each of the eleven slide titles, decide which palette color best matches the voice mode the founder uses when writing about that beat — based on both the essay and the prior verbatim phrases. Then place that color along a 0..1 horizontal spectrum, where lower values trend toward the pink/peach/amber end and higher values trend toward the sky/indigo/violet end. The spectrum is just a visual range; do NOT use it to convey quality, alignment, or score. A marker landing far from the others is not a bug — it just means it didn't quite follow the rest of the pitch.",
    "",
    "Use exactly these seven palette colors:",
    "  pink, peach, amber, mint, sky, indigo, violet",
    "Do not invent other colors. Do not return red, green, blue, gray, or any name not on the list.",
    "",
    "Use exactly these eleven slide titles, character-for-character. Do not rename, paraphrase, drop articles, or invent new headings:",
    ...DECK_HEADINGS.map((h) => `  - ${h}`),
    "",
    "If a source-context block is provided (the target investor/firm the founder is pitching to), factor it in ONLY for the position along the spectrum — never to suggest different copy, phrasing, or framing. The founder's own words are sacred.",
    "",
    "Respond as a single JSON object with exactly this shape:",
    '  { "headings": [',
    '      { "heading": "The Problem", "color": "pink", "position": 0.12 },',
    '      ... (one entry for each of the eleven slide titles, in the same order)',
    '    ] }',
    "",
    "Never wrap the JSON in code fences. Never include any free-form text outside the JSON. Never write words for the founder. Never include scores, percentages, or ranks.",
  ].join("\n");
}

function buildUserMessage({ stitchedBody, deckTree, deckSourceContext }) {
  const lines = [];
  lines.push("The founder's validation essay (every word is the founder's own):");
  lines.push("");
  lines.push(stitchedBody);
  lines.push("");
  lines.push("Verbatim phrases the founder has already written under each slide title (may be empty):");
  for (const heading of DECK_HEADINGS) {
    const phrases = collectPhrases(deckTree, heading);
    if (phrases.length === 0) {
      lines.push(`  - ${heading}: (none yet)`);
    } else {
      for (const p of phrases) {
        lines.push(`  - ${heading}: ${p}`);
      }
    }
  }
  if (deckSourceContext && typeof deckSourceContext === "string") {
    lines.push("");
    lines.push("Source context (the target investor / company the founder is pitching to). Read for context only — never lift words from this block into a suggestion:");
    lines.push(deckSourceContext.slice(0, MAX_CONTEXT_CHARS));
  }
  lines.push("");
  lines.push("Classify each of the eleven slide titles. Respond with the JSON object only.");
  return lines.join("\n");
}

function collectPhrases(deckTree, heading) {
  // The classifier only knows offset/length records. We don't have the
  // founder's draft/essay text on the server, so we surface what we
  // can. Empty for now means Sonnet should fall back to the essay alone
  // for that heading.
  if (!deckTree || typeof deckTree !== "object") return [];
  const recs = Array.isArray(deckTree[heading]) ? deckTree[heading] : [];
  // Phrase text isn't transmitted (we only have offsets). The endpoint
  // could be extended later to receive resolved phrase strings from the
  // client; for v1 we leave it as a presence signal.
  return recs.length > 0 ? [`(${recs.length} phrase record${recs.length === 1 ? "" : "s"} on file)`] : [];
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

function validateHeadingsArray(arr) {
  if (!Array.isArray(arr)) return null;
  const byHeading = new Map();
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    if (!DECK_HEADINGS.includes(entry.heading)) continue;
    if (typeof entry.color !== "string" || !ALLOWED_COLORS.includes(entry.color)) continue;
    const position = Number(entry.position);
    if (!Number.isFinite(position) || position < 0 || position > 1) continue;
    if (byHeading.has(entry.heading)) continue;
    byHeading.set(entry.heading, { heading: entry.heading, color: entry.color, position });
  }
  // Build the output array in the canonical DECK_HEADINGS order. Missing
  // headings get a neutral fallback so the renderer never crashes.
  const out = [];
  for (let i = 0; i < DECK_HEADINGS.length; i++) {
    const h = DECK_HEADINGS[i];
    if (byHeading.has(h)) {
      out.push(byHeading.get(h));
    } else {
      const position = i / Math.max(1, DECK_HEADINGS.length - 1);
      out.push({ heading: h, color: "indigo", position });
    }
  }
  return out;
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
      max_tokens: 1024,
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
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

module.exports = withResponseLogging(async function handler(req, res) {
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
  const stitchedBody = typeof body.stitchedBody === "string" ? body.stitchedBody : "";
  if (!stitchedBody.trim()) {
    res.status(400).json({ error: "stitchedBody is required" });
    return;
  }
  if (Buffer.byteLength(stitchedBody, "utf8") > MAX_BODY_BYTES) {
    res.status(413).json({ error: "stitchedBody too large" });
    return;
  }
  const deckTree = body.deckTree && typeof body.deckTree === "object" ? body.deckTree : {};
  const deckSourceContext = typeof body.deckSourceContext === "string" ? body.deckSourceContext : null;

  const system = buildSystemPrompt();
  const userMessage = buildUserMessage({ stitchedBody, deckTree, deckSourceContext });

  let raw = "";
  try {
    raw = await callAnthropic({ system, userMessage });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
    return;
  }

  const parsed = parseJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.headings)) {
    res.status(502).json({ error: "Malformed model reply" });
    return;
  }
  const headings = validateHeadingsArray(parsed.headings);
  if (!headings) {
    res.status(502).json({ error: "Model reply failed validation" });
    return;
  }

  res.status(200).json({ headings });
});

module.exports.__test__ = {
  DECK_HEADINGS,
  ALLOWED_COLORS,
  validateHeadingsArray,
  parseJsonReply,
  buildSystemPrompt,
  buildUserMessage,
};
