/* Shared pitch-clustering helpers.
 *
 * The clustering, naming, validation, and verbatim-phrase resolver
 * logic lives here so both the legacy /api/alt-pitches endpoint (the
 * client-orchestrated round-trip) and the new /api/pitches/organize
 * job (the server-driven backend job) share the same contract. Any
 * shape change goes here and both callers pick it up.
 */

"use strict";

const MAX_WRITINGS = 60;
const MAX_SNIPPET_CHARS = 800;
const MAX_BUCKETS = 4;

// The eleven universal deck headings. Same list as /api/classify and
// src/renderer/pitches.js. Duplicated here so this module stands on
// its own; both endpoints re-export so test code doesn't have to
// reach across modules.
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

const HEADING_DESCRIPTIONS = {
  "The Problem":
    "The pain, friction, or stuck feeling the pitch addresses.",
  "A Persona":
    "A specific person who feels the problem — concrete, named or sketched.",
  "Why Now?":
    "Why this pitch is timely — what shifted in the world or in the founder's life.",
  "The Team":
    "Who is doing the work, what their experience and conviction is.",
  "The Product":
    "The thing being built or done, how it works in practice.",
  "How We Make Money":
    "How the pitch sustains itself financially.",
  "Go to Market":
    "How it reaches the people it's for — channels, networks, distribution.",
  "The Moat":
    "What makes this hard to copy — flywheel, network effects, founder edge.",
  "The Vision":
    "Where this is heading at scale — the bigger picture.",
  "Competition":
    "What else is in the space and how this one differs.",
  "The Ask":
    "What the founder needs from outside — money, intros, time, partners.",
};

function buildClusterPrompt(existingPitchTitles) {
  const lines = [
    "You group a founder's writings into 1 to 4 pitches. Each pitch is a coherent thread the founder keeps returning to.",
    "",
    "For each cluster you must:",
    "  1. Name it with EXACTLY ONE WORD. Capitalized noun, 3 to 14 letters, no spaces, no hyphens, no punctuation (e.g. \"Craft\", \"Money\", \"Doubt\", \"Coffee\").",
    "  2. For every writing in the cluster, pick ONE of the eleven universal deck-heading literals below — the beat in the pitch where this writing belongs.",
    "  3. For every writing, copy a verbatim 3-to-18-word phrase from the body that captures the beat. The phrase MUST appear verbatim in that writing.",
    "",
    "The eleven deck-heading literals (treat as opaque — do not paraphrase or invent new ones):",
    "",
  ];
  for (const h of DECK_HEADINGS) {
    lines.push(`  - ${h}`);
    lines.push(`      ${HEADING_DESCRIPTIONS[h]}`);
    lines.push("");
  }

  if (existingPitchTitles && existingPitchTitles.length > 0) {
    lines.push(
      "The founder has named these pitches already. STRONGLY PREFER routing writings into one of these titles — only mint a new title when a writing genuinely doesn't fit any existing one. Reuse a title EXACTLY (same casing).",
      "",
      `Existing pitch titles: ${existingPitchTitles.map((t) => JSON.stringify(t)).join(", ")}`,
      "",
    );
  }

  lines.push(
    "Every writing id you receive MUST appear in exactly one cluster. Do not invent ids. Do not drop ids. Do not duplicate ids across clusters.",
    "",
    "Every writing MUST be slotted: pick a deckHeading (one of the eleven literals) and a verbatim phraseText for every single writing. Even if the writing only loosely matches a beat, pick the closest one — there are no orphan writings. Do not return null for deckHeading or phraseText.",
    "",
    "Some writings may be iterations of the same pitch line — different drafts of the same beat. Put iterations of the same idea under the same pitch's same heading; the deck retains the two most recent so older drafts naturally fall away. Writings on genuinely different topics belong in different pitches.",
    "",
    "Prefer fewer clusters when the writings share a thread. Only split when threads are clearly different.",
    "",
    "Respond as a single JSON object, with exactly this shape:",
    '  { "pitches": [ { "title": "<OneWord>", "writings": [ { "id": "<id>", "deckHeading": "<one of the eleven literals>", "phraseText": "<verbatim 3-to-18-word substring of the writing>" } ] } ] }',
    "",
    "Never wrap the JSON in code fences. Never add explanations outside the JSON. Do not output any other keys.",
  );
  return lines.join("\n");
}

function buildNamePrompt() {
  return [
    "Name this set of writings with EXACTLY ONE WORD. Capitalized noun, 3 to 14 letters, no spaces, no hyphens, no punctuation (e.g. \"Craft\", \"Tinker\", \"Coffee\", \"Doubt\").",
    "",
    "Choose a word that captures the throughline of the writings — what they're collectively about.",
    "",
    "Respond as a single JSON object:",
    '  { "title": "<OneWord>" }',
    "",
    "Never wrap the JSON in code fences. Never add explanations outside the JSON. Do not output any other keys.",
  ].join("\n");
}

function buildUserMessage(writings) {
  const lines = ["The founder's writings:", ""];
  for (const w of writings) {
    lines.push(`id: ${w.id}`);
    lines.push(`---`);
    lines.push(w.snippet);
    lines.push("");
  }
  return lines.join("\n");
}

// A single English word, 1-14 letters, any case. Both model output
// and founder rename input flow through this; preserving the case
// the model (or founder) picked lets "tinker" stay lowercase if
// that's how the brand reads.
function validateTitle(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z]{1,14}$/.test(trimmed)) return null;
  return trimmed;
}

function validateHeading(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return DECK_HEADINGS.includes(value) ? value : null;
}

// Server-side fallback so every writing in a rehome reply lands in
// a real slot, even when the model couldn't produce a verbatim
// phrase. Pulls the leading 6–10 words of the body — always
// verbatim by construction. Returns null only when the body is
// blank.
function fallbackPhrase(body) {
  const trimmed = String(body || "").trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const take = Math.min(words.length, 10);
  const head = words.slice(0, take).join(" ");
  const offset = body.indexOf(head);
  if (offset < 0) return null;
  return { offset, length: head.length };
}

// Round-robin through the eleven headings when the model couldn't
// (or wouldn't) pick one. Variety beats parking every fallback in a
// single bucket like "The Vision".
function fallbackHeading(index) {
  const safe = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return DECK_HEADINGS[safe % DECK_HEADINGS.length];
}

// Lifted from /api/classify; same resolver so the contract for
// verbatim phrases is identical across endpoints.
function resolvePhraseText(body, phraseText) {
  if (typeof phraseText !== "string") return null;
  const trimmed = phraseText.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 22) return null;
  if (/[\r\n]/.test(trimmed)) return null;

  let offset = body.indexOf(trimmed);
  let length = trimmed.length;
  if (offset === -1) {
    const norm = (s) => s.replace(/\s+/g, " ");
    const normalizedBody = norm(body);
    const normalizedPhrase = norm(trimmed);
    const normalizedIndex = normalizedBody.indexOf(normalizedPhrase);
    if (normalizedIndex === -1) return null;
    let realIndex = 0;
    let normCursor = 0;
    while (realIndex < body.length && normCursor < normalizedIndex) {
      const ch = body[realIndex];
      const isWs = /\s/.test(ch);
      if (isWs) {
        const start = realIndex;
        while (realIndex < body.length && /\s/.test(body[realIndex])) realIndex++;
        if (realIndex > start) normCursor++;
      } else {
        realIndex++;
        normCursor++;
      }
    }
    offset = realIndex;
    let endReal = realIndex;
    let endNorm = 0;
    while (endReal < body.length && endNorm < normalizedPhrase.length) {
      const ch = body[endReal];
      const isWs = /\s/.test(ch);
      if (isWs) {
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

async function callClusterer({ system, userMessage, model, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), { status: 503 });
  }
  const body = {
    model: model || "claude-haiku-4-5-20251001",
    max_tokens: Math.min(Math.max(Number(maxTokens) || 1024, 1), 4096),
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

function normalizeInputs(rawWritings) {
  if (!Array.isArray(rawWritings)) return [];
  const out = [];
  const seen = new Set();
  for (const w of rawWritings) {
    if (!w || typeof w !== "object") continue;
    const id = typeof w.id === "string" ? w.id : "";
    const snippet = typeof w.snippet === "string" ? w.snippet : "";
    if (!id || seen.has(id)) continue;
    const trimmed = snippet.trim();
    if (!trimmed) continue;
    seen.add(id);
    out.push({
      id,
      snippet: trimmed.length > MAX_SNIPPET_CHARS
        ? trimmed.slice(0, MAX_SNIPPET_CHARS) + "…"
        : trimmed,
    });
    if (out.length >= MAX_WRITINGS) break;
  }
  return out;
}

// Apply the contract guarantees to the model's cluster reply: titles
// validate to a single word, each writing maps to a known input id
// with a valid heading + verbatim phrase, every input id appears in
// exactly one bucket. When the model returns null/invalid for a
// writing's heading or phrase, we synthesize a fallback so every
// writing lands in a real slot — there are no orphan writings.
function reconcileClusters(parsed, inputs) {
  const inputIds = inputs.map((w) => w.id);
  const bodyById = new Map(inputs.map((w) => [w.id, w.snippet]));
  const allowed = new Set(inputIds);
  const claimed = new Set();
  const pitches = [];
  let fallbackIndex = 0;

  function slotForWriting(id, w) {
    const body = bodyById.get(id) || "";
    const heading = validateHeading(w && w.deckHeading) || fallbackHeading(fallbackIndex++);
    const resolved = w && w.phraseText
      ? resolvePhraseText(body, w.phraseText)
      : null;
    const phrase = resolved || fallbackPhrase(body);
    return {
      id,
      deckHeading: heading,
      phrase: phrase ? { writingId: id, offset: phrase.offset, length: phrase.length } : null,
    };
  }

  const raw = parsed && Array.isArray(parsed.pitches) ? parsed.pitches : [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const title = validateTitle(p.title);
    if (!title) continue;

    const writings = [];
    const rawWritings = Array.isArray(p.writings) ? p.writings : [];
    for (const w of rawWritings) {
      if (!w || typeof w !== "object") continue;
      const id = typeof w.id === "string" ? w.id : "";
      if (!allowed.has(id) || claimed.has(id)) continue;
      claimed.add(id);
      writings.push(slotForWriting(id, w));
    }

    if (writings.length === 0) continue;
    pitches.push({ title, writings });
    if (pitches.length >= MAX_BUCKETS) break;
  }

  const leftover = inputIds.filter((id) => !claimed.has(id));
  if (leftover.length > 0) {
    const orphan = leftover.map((id) => slotForWriting(id, null));
    if (pitches.length === 0) {
      pitches.push({ title: "Other", writings: orphan });
    } else {
      pitches[0].writings.push(...orphan);
    }
  }

  return pitches;
}

// ── High-level cluster + name calls ──────────────────────────────────
//
// Both endpoints reach for these. They take a normalized writings
// array and return the same shape the legacy /api/alt-pitches reply
// holds — `{ pitches: [{ title, writings: [{ id, deckHeading,
// phrase | null }] }] }` for cluster, `{ title }` for name. Callers
// own how the result folds back into local/server state.

async function clusterWritings({ writings, existingPitchTitles, log }) {
  const system = buildClusterPrompt(existingPitchTitles || []);
  const userMessage = buildUserMessage(writings);

  for (let attempt = 0; attempt < 2; attempt++) {
    const rawText = await callClusterer({
      system,
      userMessage,
      model: "claude-haiku-4-5-20251001",
      maxTokens: 2048,
    });
    if (typeof log === "function") log(attempt, rawText);
    const parsed = parseClassifierJson(rawText);
    if (!parsed) continue;
    const reconciled = reconcileClusters(parsed, writings);
    if (reconciled.length >= 1) return reconciled;
  }

  // Model never produced a usable reply — synthesise slots so every
  // writing still lands somewhere.
  const fallback = reconcileClusters({ pitches: [] }, writings);
  if (fallback.length > 0) return fallback;
  return [{
    title: "Other",
    writings: writings.map((w, i) => {
      const p = fallbackPhrase(w.snippet);
      return {
        id: w.id,
        deckHeading: fallbackHeading(i),
        phrase: p ? { writingId: w.id, offset: p.offset, length: p.length } : null,
      };
    }),
  }];
}

async function nameWritings({ writings, log }) {
  const system = buildNamePrompt();
  const userMessage = buildUserMessage(writings);

  for (let attempt = 0; attempt < 2; attempt++) {
    const rawText = await callClusterer({
      system,
      userMessage,
      model: "claude-haiku-4-5-20251001",
      maxTokens: 64,
    });
    if (typeof log === "function") log(attempt, rawText);
    const parsed = parseClassifierJson(rawText);
    if (parsed && typeof parsed === "object") {
      const validated = validateTitle(parsed.title);
      if (validated) return validated;
    }
  }
  return null;
}

module.exports = {
  DECK_HEADINGS,
  HEADING_DESCRIPTIONS,
  MAX_WRITINGS,
  MAX_SNIPPET_CHARS,
  MAX_BUCKETS,
  buildClusterPrompt,
  buildNamePrompt,
  buildUserMessage,
  validateTitle,
  validateHeading,
  fallbackPhrase,
  fallbackHeading,
  resolvePhraseText,
  parseClassifierJson,
  callClusterer,
  normalizeInputs,
  reconcileClusters,
  clusterWritings,
  nameWritings,
};
