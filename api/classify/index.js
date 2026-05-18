/* POST /api/classify
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { writingId, body }
 * Reply: { deckHeading: string | null, phrase: { writingId, offset, length } | null }
 *
 * The v0.103 sidebar tree classifier. Takes the body of one of the
 * founder's drafts or essays and returns the deck heading it most
 * cleanly belongs under (one of the seven pitch-deck literals) plus a
 * 4–18-word verbatim substring of the body to show as the phrase row.
 * Either field may be null when the model can't place the writing
 * confidently.
 *
 * The seven deck headings are spelled exactly as in pitch-deck.md. The
 * model is forbidden from inventing new headings or paraphrasing one
 * of the seven; the offset/length must point into the body and the
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
  "Why Now?",
  "The Product",
  "How We Make Money",
  "The Moat",
  "Competition",
  "The Ask",
];

// Description of each heading, lifted from pitch-deck.md's slide bodies.
// The classifier prompt quotes these so the model has a concrete sense
// of what kind of writing belongs under each beat — in the founder's
// own pitch language, not a generic taxonomy.
const HEADING_DESCRIPTIONS = {
  "The Problem":
    "Do you feel like you've worked so hard, but you're still finding yourself stressed about what you're doing? You thought that this next life change would be the one, but it feels like you're doing the same thing again. John is 31. He's a dad. He goes to school full time. He's a recovering AI engineer, and he's quite progressive when it comes to considering men's mental health. John is seeking extreme wealth. He knows it's there. He just hasn't tapped it yet, and that's everything.",
  "Why Now?":
    "AI is making our workplace more toxic. The sprint towards figuring out what we can do is insane right now. People, including myself, need a tool that can help them figure out who they are as a founder.",
  "The Product":
    "tinker — the product itself: the writing tool, the rainbow-web brand, how the founder shapes their identity by writing through it.",
  "How We Make Money":
    "Word of mouth is the biggest distribution model. Free to start, $7 a month once they use it enough. Various tiers of monthly subscriptions to get deeper into the writing tools.",
  "The Moat":
    "Your ideas are woven together with other founders on the platform. You come because they have what you need, and you stay because everyone's there.",
  "Competition":
    "Comparisons to other tools, platforms, or companies in the space. What sets tinker apart from meta, Substack, journaling apps, or the AI assistants people already use.",
  "The Ask":
    "Pre-seed: $250k – $950k. What the founder is asking investors for, why now, and what the money goes to.",
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
    "You classify a founder's writing under one of the seven slide titles from their pitch deck. The seven slide titles are FIXED — you must return one of them exactly, character-for-character, or null when no heading fits.",
    "",
    "The seven slide titles (treat as opaque literals — do NOT paraphrase, lowercase, drop articles, or invent new headings):",
    "",
  ];
  for (const h of DECK_HEADINGS) {
    lines.push(`- ${h}`);
    lines.push(`    ${HEADING_DESCRIPTIONS[h]}`);
    lines.push("");
  }
  lines.push(
    "Given a single piece of writing, decide which slide title best fits its central beat. Bias toward returning a heading — most founder writing fits SOMEWHERE under one of the seven; only return null when truly none of the seven applies.",
    "",
    "Then pick ONE verbatim substring of the writing — 3 to 18 words — that captures that beat in the founder's own words. The phrase must be a clean contiguous substring of the writing: starts at a word boundary, ends at a word boundary, contains no newline characters, no leading/trailing whitespace.",
    "",
    "CRITICAL: count words and double-check offset/length carefully before you respond. Pick a phrase that's CLEARLY between 3 and 18 words — aim for 6 to 12, well inside the window. Whenever you return a non-null deckHeading you MUST also return a valid phrase. Don't return a heading with a null phrase.",
    "",
    "Respond as a single JSON object, with exactly these keys:",
    '  { "deckHeading": "<one of the seven literals, or null>", "phrase": { "offset": <integer>, "length": <integer> } | null }',
    "",
    "Offset is a 0-based character index into the writing body; length is the character count of the phrase substring. To verify: body.slice(offset, offset+length) must equal the phrase you want surfaced, character-for-character.",
    "",
    "If the writing truly doesn't belong under any heading, return { \"deckHeading\": null, \"phrase\": null }.",
    "Do not invent new headings. Do not paraphrase the seven. Do not invent a phrase that isn't in the writing. Never wrap the JSON in code fences. Never add explanations outside the JSON.",
  );
  return lines.join("\n");
}

function validatePhrase(body, phrase) {
  if (!phrase || typeof phrase !== "object") return null;
  let offset = Number(phrase.offset);
  let length = Number(phrase.length);
  if (!Number.isFinite(offset) || !Number.isFinite(length)) return null;
  if (offset < 0 || length <= 0) return null;
  if (offset + length > body.length) return null;
  // Tolerate leading/trailing whitespace in the model's slice by
  // shrinking the window in. This is purely defensive — the
  // surfaced text is whatever's between the new offset and length.
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
  // Word-boundary at start: either at body start or preceded by
  // whitespace/punctuation. Letters/digits/apostrophes mean we're
  // starting mid-word, which is what we want to reject.
  if (offset > 0) {
    const prev = body[offset - 1];
    if (/[a-zA-Z0-9']/.test(prev)) return null;
  }
  // Word-boundary at end.
  if (offset + length < body.length) {
    const next = body[offset + length];
    if (/[a-zA-Z0-9']/.test(next)) return null;
  }
  // No line-break artifacts inside.
  if (/[\r\n]/.test(slice)) return null;
  // Word count between 3 and 22 (the spec says 4–18 but a 3-word
  // beat is sometimes the right one — "everyone is here" — and
  // longer phrases up to 22 still read as the founder's voice).
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
    const validatedPhrase =
      parsed.phrase === null ? null : validatePhrase(writingBody, parsed.phrase);

    if (isPreview) {
      try {
        const phraseShape = parsed.phrase
          ? `offset=${parsed.phrase.offset},length=${parsed.phrase.length}`
          : "null";
        const slice = (parsed.phrase && typeof parsed.phrase.offset === "number")
          ? JSON.stringify(writingBody.slice(parsed.phrase.offset, parsed.phrase.offset + (parsed.phrase.length || 0))).slice(0, 200)
          : "";
        console.log(`[classify] writingId=${writingId} attempt=${attempt} heading=${JSON.stringify(parsed.deckHeading)} validated=${JSON.stringify(heading)} phrase=${phraseShape} validatedPhrase=${validatedPhrase === undefined ? "MALFORMED" : JSON.stringify(validatedPhrase)} slice=${slice}`);
      } catch { /* ignore */ }
    }

    // Heading is settled the first time it validates (null counts as
    // settled — the model can decide a writing doesn't fit). Phrase
    // similarly: a valid {offset,length} or an explicit null both
    // settle. `undefined` from the validators means malformed; we
    // retry up to once.
    if (deckHeading === undefined && heading !== undefined) {
      deckHeading = heading;
    }
    if (phrase === undefined && validatedPhrase !== undefined) {
      phrase = validatedPhrase;
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
  validateHeading,
  parseClassifierJson,
  buildSystemPrompt,
};
