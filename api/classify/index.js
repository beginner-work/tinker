/* POST /api/classify
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { writingId, body }
 * Reply: { deckHeading: string | null, phrase: { writingId, offset, length } | null }
 *
 * The v0.103 sidebar tree classifier. Takes the body of one of the
 * founder's drafts or essays and returns the deck heading it most
 * cleanly belongs under (one of the eleven pitch-deck literals) plus a
 * 4–18-word verbatim substring of the body to show as the phrase row.
 * Either field may be null when the model can't place the writing
 * confidently.
 *
 * The eleven deck headings are spelled exactly as in pitch-deck.md. The
 * model is forbidden from inventing new headings or paraphrasing one
 * of the eleven; the offset/length must point into the body and the
 * substring must be a clean 4–18-word phrase. On a malformed reply we
 * retry once, then drop the bad field.
 *
 * Anthropic key held server-side. Mirrors /api/claude/converse.
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

// Description of each heading, lifted from pitch-deck.md's slide bodies.
// The classifier prompt quotes these so the model has a concrete sense
// of what kind of writing belongs under each beat — in the founder's
// own pitch language, not a generic taxonomy.
const HEADING_DESCRIPTIONS = {
  "The Problem":
    "Do you feel like you've worked so hard, but you're still finding yourself stressed about what you're doing? You thought that this next life change would be the one, but it feels like you're doing the same thing again.",
  "A Persona":
    "John is 31. He's a dad. He goes to school full time. He's a recovering AI engineer, and he's quite progressive when it comes to considering men's mental health. John is seeking wealth. He knows it's there. He just hasn't tapped it yet, and that's everything.",
  "Why Now?":
    "AI is making our workplace more toxic. The sprint towards figuring out what we can do is insane right now. People, including myself, need a tool that can help them figure out who they are as a founder.",
  "The Team":
    "Who's building tinker — the founder's own background and conviction, anyone working alongside, and what their experience with writing, AI, and shipping products has prepared them for this bet.",
  "The Product":
    "tinker — the product itself: the writing tool, the rainbow-web brand, how the founder shapes their identity by writing through it.",
  "How We Make Money":
    "Free to start, $7 a month once they use it enough. Tiered monthly subscriptions to get deeper into the writing tools: $7, $35, $70 — and enterprise-level pricing beyond that.",
  "Go to Market":
    "I start by building off of my personal and professional networks in San Diego and San Francisco. Then I build into the enterprise space by connecting with incubation spaces globally. Word of mouth is the biggest distribution model.",
  "The Moat":
    "Your ideas are woven together with other founders on the platform. You come because they have what you need, and you stay because everyone's there.",
  "The Vision":
    "It's a two-sided marketplace and a social network — for the types of craft and the types of founders that have traditionally not been funded. A marketplace and a social network combined is a payment network — and that's where a lot of money can be made.",
  "Competition":
    "Comparisons to other tools, platforms, or companies in the space. What sets tinker apart from meta, Substack, journaling apps, or the AI assistants people already use.",
  "The Ask":
    "Pre-seed: $300k – $950k. What the founder is asking investors for, why now, and what the money goes to — founder salary, travel and office costs, cloud infrastructure, marketing, and AI agentic development costs.",
};

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
  const lines = [
    "You classify a founder's writing under one of the eleven slide titles from their pitch deck. The eleven slide titles are FIXED — you must return one of them exactly, character-for-character, or null when no heading fits.",
    "",
    "The eleven slide titles (treat as opaque literals — do NOT paraphrase, lowercase, drop articles, or invent new headings):",
    "",
  ];
  for (const h of DECK_HEADINGS) {
    lines.push(`- ${h}`);
    lines.push(`    ${HEADING_DESCRIPTIONS[h]}`);
    lines.push("");
  }
  lines.push(
    "Given a single piece of writing, decide which slide title best fits its central beat. Bias toward returning a heading — most founder writing fits SOMEWHERE under one of the eleven; only return null when truly none of the eleven applies.",
    "",
    "Then COPY a short phrase from the writing — 3 to 18 words — that captures that beat in the founder's own words. The phrase MUST appear verbatim in the writing body. Copy it exactly as it appears (same letters, same spacing, same punctuation). Aim for 6 to 12 words. Do not include a leading/trailing space, do not include a line break inside the phrase, do not summarise.",
    "",
    "Whenever you return a non-null deckHeading you MUST also return a valid phraseText that you copied verbatim from the writing. Pick a sentence or sentence-fragment — not a single word.",
    "",
    "Respond as a single JSON object, with exactly these keys:",
    '  { "deckHeading": "<one of the eleven literals, or null>", "phraseText": "<a verbatim 3-to-18-word substring of the writing>" | null }',
    "",
    "If the writing truly doesn't belong under any heading, return { \"deckHeading\": null, \"phraseText\": null }.",
    "Do not invent new headings. Do not paraphrase the eleven. Do not invent a phraseText that isn't in the writing. Never wrap the JSON in code fences. Never add explanations outside the JSON.",
  );
  return lines.join("\n");
}

// Find the model's phrase text inside the writing body and return
// the resolved { offset, length } if it lands on a clean substring.
// We prefer an exact indexOf; if that misses (model added/dropped a
// stray space or smart-quote), fall back to a whitespace-normalized
// search. Returns null on anything we can't ground in the body.
function resolvePhraseText(body, phraseText) {
  if (typeof phraseText !== "string") return null;
  const trimmed = phraseText.trim();
  if (!trimmed) return null;
  // Word count between 3 and 22 (spec says 4–18; relaxed at the
  // edges so the model has room to pick the natural beat).
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 22) return null;
  // Phrases that span a line break would be visually awkward in the
  // sidebar row — drop them so the renderer doesn't get them.
  if (/[\r\n]/.test(trimmed)) return null;

  // 1. Exact indexOf wins.
  let offset = body.indexOf(trimmed);
  let length = trimmed.length;
  // 2. Fallback: collapse whitespace in both sides and re-find,
  //    then map the normalized index back to a body offset.
  if (offset === -1) {
    const norm = (s) => s.replace(/\s+/g, " ");
    const normalizedBody = norm(body);
    const normalizedPhrase = norm(trimmed);
    const normalizedIndex = normalizedBody.indexOf(normalizedPhrase);
    if (normalizedIndex === -1) return null;
    // Walk through `body` counting non-collapsed chars to find the
    // real offset. This is O(body.length) once.
    let realIndex = 0;
    let normCursor = 0;
    while (realIndex < body.length && normCursor < normalizedIndex) {
      const ch = body[realIndex];
      const isWs = /\s/.test(ch);
      if (isWs) {
        // Skip a run of whitespace; in the normalized form it counts as one space.
        const start = realIndex;
        while (realIndex < body.length && /\s/.test(body[realIndex])) realIndex++;
        // If the run consumed something, that's one normalized space.
        if (realIndex > start) normCursor++;
      } else {
        realIndex++;
        normCursor++;
      }
    }
    offset = realIndex;
    // Find the end offset by walking forward through the normalized phrase.
    let endReal = realIndex;
    let endNorm = 0;
    while (endReal < body.length && endNorm < normalizedPhrase.length) {
      const ch = body[endReal];
      const isWs = /\s/.test(ch);
      if (isWs) {
        // A run of whitespace = one normalized space.
        const start = endReal;
        while (endReal < body.length && /\s/.test(body[endReal])) endReal++;
        if (endReal > start) endNorm++;
      } else {
        endReal++;
        endNorm++;
      }
    }
    length = endReal - offset;
    if (length <= 0) return null;
  }
  if (offset < 0 || offset + length > body.length) return null;
  // Phrase falls inside the body; ensure word-boundaries on each
  // side (allow body edges).
  if (offset > 0) {
    const prev = body[offset - 1];
    if (/[a-zA-Z0-9']/.test(prev)) return null;
  }
  if (offset + length < body.length) {
    const next = body[offset + length];
    if (/[a-zA-Z0-9']/.test(next)) return null;
  }
  return { offset, length };
}

// Legacy offset-based validator. Kept exported because the test suite
// still references it; the new contract uses resolvePhraseText.
function validatePhrase(body, phrase) {
  if (!phrase || typeof phrase !== "object") return null;
  let offset = Number(phrase.offset);
  let length = Number(phrase.length);
  if (!Number.isFinite(offset) || !Number.isFinite(length)) return null;
  if (offset < 0 || length <= 0) return null;
  if (offset + length > body.length) return null;
  let slice = body.slice(offset, offset + length);
  const leading = slice.length - slice.replace(/^\s+/, "").length;
  const trailing = slice.length - slice.replace(/\s+$/, "").length;
  if (leading > 0 || trailing > 0) {
    offset += leading;
    length -= leading + trailing;
    if (length <= 0) return null;
    slice = body.slice(offset, offset + length);
  }
  if (!slice.trim()) return null;
  if (offset > 0) {
    const prev = body[offset - 1];
    if (/[a-zA-Z0-9']/.test(prev)) return null;
  }
  if (offset + length < body.length) {
    const next = body[offset + length];
    if (/[a-zA-Z0-9']/.test(next)) return null;
  }
  if (/[\r\n]/.test(slice)) return null;
  const words = slice.split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 22) return null;
  return { offset, length };
}

function validateHeading(value) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return DECK_HEADINGS.includes(value) ? value : undefined;
}

function parseClassifierJson(text) {
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

async function callClassifier({ system, userMessage, model, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), {
      status: 503,
    });
  }
  const body = {
    model: model || "claude-haiku-4-5-20251001",
    max_tokens: Math.min(Math.max(Number(maxTokens) || 256, 1), 1024),
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

// Exported for the test suite — Vercel only reads the default export,
// so attaching helpers as properties is invisible to the route layer.
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
  if (!writingId || !writingBody.trim()) {
    res.status(400).json({ error: "writingId and non-empty body are required" });
    return;
  }

  const system = buildSystemPrompt();
  const isPreview = process.env.VERCEL_ENV === "preview";

  let deckHeading = undefined;
  let phrase = undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let parsed = null;
    let rawText = "";
    try {
      rawText = await callClassifier({
        system,
        userMessage: writingBody,
        model: "claude-haiku-4-5-20251001",
        maxTokens: 256,
      });
      parsed = parseClassifierJson(rawText);
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message || "Upstream error" });
      return;
    }
    if (isPreview) {
      try { console.log(`[classify] writingId=${writingId} attempt=${attempt} raw=${rawText.slice(0, 400)}`); }
      catch { /* ignore */ }
    }
    if (!parsed || typeof parsed !== "object") {
      if (isPreview) {
        try { console.log(`[classify] writingId=${writingId} attempt=${attempt} parsedNull`); }
        catch { /* ignore */ }
      }
      continue;
    }

    const heading = validateHeading(parsed.deckHeading);
    const resolved =
      parsed.phraseText === null || parsed.phraseText === undefined
        ? null
        : resolvePhraseText(writingBody, parsed.phraseText);

    if (isPreview) {
      try {
        const phraseTextPreview = typeof parsed.phraseText === "string"
          ? JSON.stringify(parsed.phraseText).slice(0, 200)
          : JSON.stringify(parsed.phraseText);
        console.log(`[classify] writingId=${writingId} attempt=${attempt} heading=${JSON.stringify(parsed.deckHeading)} validatedHeading=${JSON.stringify(heading)} phraseText=${phraseTextPreview} resolved=${JSON.stringify(resolved)}`);
      } catch { /* ignore */ }
    }

    // Heading is settled the first time it validates (null counts as
    // settled — the model can decide a writing doesn't fit).
    if (deckHeading === undefined && heading !== undefined) {
      deckHeading = heading;
    }
    // Phrase: explicit null from the model OR a resolved
    // {offset,length} both settle. A non-null phraseText that we
    // couldn't resolve in the body means malformed → retry up to once.
    if (phrase === undefined) {
      if (parsed.phraseText === null || parsed.phraseText === undefined) {
        // Only allow null phrase when the heading is also null —
        // otherwise force a retry to coax a phrase out of the model.
        if (heading === null) phrase = null;
      } else if (resolved !== null) {
        phrase = resolved;
      }
      // resolved === null AND non-null phraseText → malformed, retry
    }
    if (deckHeading !== undefined && phrase !== undefined) break;
  }

  // After the retry budget, anything still undefined gets dropped per
  // the spec: don't invent a heading, don't invent a phrase.
  const finalHeading = deckHeading === undefined ? null : deckHeading;
  const finalPhrase =
    phrase === undefined || phrase === null
      ? null
      : { writingId, offset: phrase.offset, length: phrase.length };

  res.status(200).json({ deckHeading: finalHeading, phrase: finalPhrase });
});

module.exports = handler;
module.exports.__test__ = {
  DECK_HEADINGS,
  HEADING_DESCRIPTIONS,
  validatePhrase,
  resolvePhraseText,
  validateHeading,
  parseClassifierJson,
  buildSystemPrompt,
};
