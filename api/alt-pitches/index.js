/* POST /api/alt-pitches
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { writings: [{ id: string, snippet: string }, ...] }
 * Reply: { pitches: [{ title: string, writingIds: string[] }, ...] }
 *
 * Companion to /api/classify. Takes the founder's "doesn't fit"
 * writings — the ones the classifier returned `deckHeading: null` for —
 * and asks the model to bucket them into 1–4 alternate pitches. Each
 * bucket gets one writingId list and one single-word title that names
 * the bucket. Every input writing must land in exactly one bucket.
 *
 * The title must be exactly one capitalized word — the sidebar pitch
 * switcher renders it as a chip and there's no room for a phrase. We
 * validate and drop anything malformed; a bucket without a valid title
 * is merged into the next valid one before reply.
 *
 * Anthropic key held server-side. Mirrors /api/claude/converse and
 * /api/classify.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");

const MAX_WRITINGS = 60;
const MAX_SNIPPET_CHARS = 800;
const MAX_BUCKETS = 4;
const MIN_BUCKETS = 1;

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
    "You group a founder's stray writings — the ones that don't fit their main starter pitch — into 1 to 4 alternate pitches.",
    "",
    "Each alternate pitch is a coherent thread of writings that share a beat the founder keeps returning to outside of their starter deck. Cluster by the thread, not by topic keywords.",
    "",
    "For each cluster, name it with EXACTLY ONE WORD. Choose a noun that captures the throughline (e.g. \"Craft\", \"Money\", \"Doubt\", \"Rest\"). The word must be a single English word, capitalized, no spaces, no hyphens, no punctuation, 3 to 14 letters.",
    "",
    "Every writing id you receive MUST appear in exactly one cluster. Do not invent ids. Do not drop ids. Do not duplicate ids across clusters.",
    "",
    "Prefer fewer clusters when the writings genuinely share a thread. Only split when the threads are clearly different.",
    "",
    "Respond as a single JSON object, with exactly this shape:",
    '  { "pitches": [ { "title": "<OneWord>", "writingIds": ["<id>", ...] }, ... ] }',
    "",
    "Never wrap the JSON in code fences. Never add explanations outside the JSON. Do not output any other keys.",
  ].join("\n");
}

function buildUserMessage(writings) {
  const lines = ["The founder's stray writings (each one didn't fit the starter pitch):", ""];
  for (const w of writings) {
    lines.push(`id: ${w.id}`);
    lines.push(`---`);
    lines.push(w.snippet);
    lines.push("");
  }
  lines.push("Group them into 1 to 4 alternate pitches as specified.");
  return lines.join("\n");
}

// One capitalized English word, 3–14 letters. The sidebar chip can't
// fit a phrase, and the audit allowlist needs a single token to test
// against, so the validator is strict on shape.
function validateTitle(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[A-Z][a-z]{2,13}$/.test(trimmed)) return null;
  return trimmed;
}

function dedupeWritingIds(ids, allowed) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== "string") continue;
    if (!allowed.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// Apply the contract guarantees to the model's reply: titles validate
// to single words, ids are real, every input id appears in exactly one
// bucket. Unclaimed ids fall into the first bucket; if every bucket
// failed validation, build one fallback bucket titled "Other" that
// holds every input id.
function reconcilePitches(parsed, inputIds) {
  const allowed = new Set(inputIds);
  const claimed = new Set();
  const pitches = [];

  const raw = parsed && Array.isArray(parsed.pitches) ? parsed.pitches : [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const title = validateTitle(p.title);
    if (!title) continue;
    const ids = dedupeWritingIds(
      Array.isArray(p.writingIds) ? p.writingIds : [],
      allowed,
    ).filter((id) => !claimed.has(id));
    if (ids.length === 0) continue;
    for (const id of ids) claimed.add(id);
    pitches.push({ title, writingIds: ids });
    if (pitches.length >= MAX_BUCKETS) break;
  }

  // Catch-all for ids the model dropped or never validated. We bias
  // toward putting them in the first valid bucket so the founder's
  // writings aren't orphaned. If nothing validated, build "Other".
  const leftover = inputIds.filter((id) => !claimed.has(id));
  if (leftover.length > 0) {
    if (pitches.length === 0) {
      pitches.push({ title: "Other", writingIds: leftover });
    } else {
      pitches[0].writingIds.push(...leftover);
    }
  }

  return pitches;
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

  const writings = normalizeInputs(body.writings);
  if (writings.length === 0) {
    res.status(200).json({ pitches: [] });
    return;
  }

  // One writing trivially clusters to itself — short-circuit the model
  // call. The title is "Solo" so the chip has something to render; the
  // founder can rename it later if we add an editor.
  if (writings.length === 1) {
    res.status(200).json({
      pitches: [{ title: "Solo", writingIds: [writings[0].id] }],
    });
    return;
  }

  const system = buildSystemPrompt();
  const userMessage = buildUserMessage(writings);
  const isPreview = process.env.VERCEL_ENV === "preview";

  let pitches = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let rawText = "";
    try {
      rawText = await callClusterer({
        system,
        userMessage,
        model: "claude-haiku-4-5-20251001",
        maxTokens: 1024,
      });
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message || "Upstream error" });
      return;
    }
    if (isPreview) {
      try { console.log(`[alt-pitches] attempt=${attempt} raw=${rawText.slice(0, 400)}`); }
      catch { /* ignore */ }
    }
    const parsed = parseClassifierJson(rawText);
    if (!parsed) continue;

    const reconciled = reconcilePitches(parsed, writings.map((w) => w.id));
    if (reconciled.length >= MIN_BUCKETS) {
      pitches = reconciled;
      break;
    }
  }

  if (!pitches) {
    // Model never produced a usable reply; drop everything into a
    // single "Other" bucket so the founder still sees their writings.
    pitches = [{ title: "Other", writingIds: writings.map((w) => w.id) }];
  }

  res.status(200).json({ pitches });
});

module.exports = handler;
module.exports.__test__ = {
  MAX_WRITINGS,
  MAX_BUCKETS,
  validateTitle,
  reconcilePitches,
  parseClassifierJson,
  normalizeInputs,
  buildSystemPrompt,
};
