/* POST /api/classify
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { writingId, title?, body }
 * Reply: { slide: "<one of the eleven slide-category literals>" | null }
 *
 * Tags one piece of writing with the slide category it fits — once,
 * at publish time. This is NOT the old organize machinery: nothing is
 * rearranged, re-clustered, or moved afterwards. The tag is stored on
 * the essay and the story view simply shows, per category, the most
 * recent essay that fits it. Recency does the curating; the model only
 * answers "which slide does this piece fit?".
 *
 * The founder's own title is the strongest signal: an essay explicitly
 * about fundraising belongs to The Ask, whatever its themes rhyme
 * with. Anthropic key held server-side.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");

const SLIDE_CATEGORIES = [
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

const CATEGORY_DESCRIPTIONS = {
  "The Problem": "The pain, friction, or stuck feeling the founder's work addresses.",
  "A Persona": "A specific person who feels the problem — concrete, named or sketched.",
  "Why Now?": "Why this is timely — what shifted in the world or in the founder's life.",
  "The Team": "Who is doing the work, what their experience and conviction is.",
  "The Product": "The thing being built or done, how it works in practice.",
  "How We Make Money": "How the work sustains itself financially — pricing, revenue, subscriptions.",
  "Go to Market": "How it reaches the people it's for — channels, networks, distribution.",
  "The Moat": "What makes this hard to copy — flywheel, network effects, founder edge.",
  "The Vision": "Where this is heading at scale — the bigger picture.",
  "Competition": "What else is in the space and how this differs.",
  "The Ask": "What the founder needs from outside — money, intros, time, partners.",
};

// Explicit intent beats thematic similarity. Born from a real
// complaint: an essay explicitly about fundraising kept landing
// somewhere other than The Ask.
const EXPLICIT_TOPIC_RULE =
  "EXPLICIT TOPIC WINS: a writing (or its title) may name a category's territory outright — " +
  "fundraising, raising money, investors, what they're asking for → The Ask; " +
  "competitors or alternatives → Competition; pricing, revenue, subscriptions → How We Make Money; " +
  "who's building it → The Team; a specific person who feels the problem → A Persona; " +
  "timing or what just changed → Why Now?; channels, launch, word of mouth → Go to Market; " +
  "defensibility → The Moat; the long-term picture → The Vision; " +
  "the thing being built → The Product; the pain itself → The Problem. " +
  "When the territory is named explicitly, pick that category — explicit intent outweighs thematic similarity. " +
  "The `title:` line is the founder's own label for the writing; treat it as the strongest signal of where they meant it to live.";

function buildSystemPrompt() {
  const lines = [
    "You tag a founder's writing with the ONE slide category it fits best, from the eleven below. The category names are FIXED literals — return one exactly, character-for-character, or null when the writing truly fits none.",
    "",
    "The eleven slide categories:",
    "",
  ];
  for (const c of SLIDE_CATEGORIES) {
    lines.push(`- ${c}`);
    lines.push(`    ${CATEGORY_DESCRIPTIONS[c]}`);
    lines.push("");
  }
  lines.push(
    EXPLICIT_TOPIC_RULE,
    "",
    "Bias toward a category — most founder writing fits SOMEWHERE under one of the eleven; only return null when none applies at all.",
    "",
    "Respond as a single JSON object, exactly:",
    '  { "slide": "<one of the eleven literals, or null>" }',
    "",
    "Do not invent new categories. Do not paraphrase the eleven. Never wrap the JSON in code fences. Never add anything outside the JSON.",
  );
  return lines.join("\n");
}

// The user message: the founder's own title (their statement of
// intent) above the body, verbatim.
function buildUserContent(body, title) {
  const t = typeof title === "string" ? title.trim() : "";
  if (!t) return body;
  return `title: ${t.slice(0, 120)}\n\n${body}`;
}

function validateSlide(value) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return SLIDE_CATEGORIES.includes(value) ? value : undefined;
}

function parseReply(text) {
  const trimmed = (text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

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

async function callModel({ system, userMessage }) {
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
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      temperature: 0,
      system: [
        { type: "text", text: String(system), cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage }],
    }),
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
  const writingId = typeof body.writingId === "string" ? body.writingId : null;
  const writingBody = typeof body.body === "string" ? body.body : "";
  const writingTitle = typeof body.title === "string" ? body.title : "";
  if (!writingId || !writingBody.trim()) {
    res.status(400).json({ error: "writingId and non-empty body are required" });
    return;
  }

  const system = buildSystemPrompt();
  let slide = undefined;
  for (let attempt = 0; attempt < 2 && slide === undefined; attempt++) {
    let rawText = "";
    try {
      rawText = await callModel({
        system,
        userMessage: buildUserContent(writingBody, writingTitle),
      });
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message || "Upstream error" });
      return;
    }
    const parsed = parseReply(rawText);
    if (parsed && typeof parsed === "object") {
      const validated = validateSlide(parsed.slide);
      if (validated !== undefined) slide = validated;
    }
  }

  res.status(200).json({ slide: slide === undefined ? null : slide });
});

module.exports = handler;
module.exports.__test__ = {
  SLIDE_CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  EXPLICIT_TOPIC_RULE,
  buildSystemPrompt,
  buildUserContent,
  validateSlide,
  parseReply,
};
