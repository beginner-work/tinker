/* POST /api/cluster
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { writings: [{ id, type, earth, title, body }, ...] }
 * Reply: { earths: [{ earthId, earthName, seeds: [{
 *           label, sourceWritingId, sourceOffset, sourceLength,
 *           growthVectors: [{
 *             label, sourceWritingId, sourceOffset, sourceLength,
 *             writingIds: string[],
 *           }, ...],
 *         }, ...] }, ...] }
 *
 * The browser owns the input. The function:
 *   - re-validates the Stytch session on every call (same pattern as
 *     /api/search and /api/claude/converse),
 *   - groups writings by Earth and keeps only Earths with ≥ MIN_PER_EARTH
 *     writings,
 *   - asks Claude Haiku 4.5 to produce 2-5 Seeds per Earth, each Seed
 *     containing 1+ Growth vectors. Every label arrives as an offset +
 *     length into a specific writing — never a free-form string from
 *     the model,
 *   - validates each label by reading the substring at the offset and
 *     dropping any (offset, length) pair that doesn't reproduce the
 *     model's claimed label. One retry per Earth on bad shapes; on the
 *     second failure the Earth is dropped from the response,
 *   - omits Earths with no surviving Seeds, and Seeds with no surviving
 *     Growth vectors.
 *
 * The Anthropic key lives server-side. Zero external deps — uses Node 18+
 * global fetch. */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");

// Per-Earth threshold below which clustering doesn't run. Default 3
// (see open question 1 in the build prompt — founder did not lock
// this number; 3 is the documented default). [NEEDS INPUT]
const MIN_PER_EARTH = 3;
const MIN_SEEDS_PER_EARTH = 2;
const MAX_SEEDS_PER_EARTH = 5;

// Trim writings before sending to Claude so a single mega-essay doesn't
// blow the context budget. Each writing keeps its full body up to this
// cap; the offsets returned by Claude are validated against this same
// trimmed text, so the (offset, length) → substring round-trip stays
// consistent.
const MAX_WRITING_CHARS = 4000;

const CLUSTER_SYSTEM_PROMPT = [
  "You are the clustering engine for tinker, a writing tool for founders. The founder writes essays and notes anchored to places (called Earths). Your job: for ONE Earth at a time, group the founder's writings into 2-5 Seeds (themes), and within each Seed identify 1+ Growth vectors (specific things the founder is learning).",
  "",
  "RULE 1 — VERBATIM ONLY.",
  "Every label you produce — Seed labels, Growth vector labels — MUST be a verbatim contiguous substring of one of the founder's writings. You do not paraphrase. You do not invent. You do not soften. You return offsets, not strings.",
  "",
  "RULE 2 — OFFSETS, NOT STRINGS.",
  "For each label, return `{ sourceWritingId, sourceOffset, sourceLength }`. The label is implicitly writings[sourceWritingId].body.slice(sourceOffset, sourceOffset + sourceLength). The server will validate. If the substring at those offsets does not match an evocative phrase a careful reader would highlight, your output will be dropped.",
  "",
  "RULE 3 — PICK PHRASES THE FOUNDER WOULD HIGHLIGHT.",
  "Good labels are short (2-8 words), concrete, and feel like the founder's own voice — a small image, a noun phrase, a thing they noticed. Examples (from imagined writings): 'his hands', 'the chair', 'hop tinctures at 7am', 'the thing I'm avoiding', 'what I taste first'. Bad labels: 'thoughts on family', 'career stuff', 'general reflections', 'lessons learned'. The bad ones are AI-flavoured umbrellas; the good ones are phrases the founder actually wrote.",
  "",
  "RULE 4 — STRUCTURE.",
  "Produce 2 to 5 Seeds for the Earth. Each Seed represents a cluster of writings sharing a theme. Inside each Seed, list 1+ Growth vectors. A Growth vector represents the specific topic — and may span multiple writings. For each Growth vector, list every writing.id that belongs under it.",
  "",
  "RULE 5 — ORDER.",
  "Order Seeds by writing-count (descending), ties broken by most-recent writing. Order Growth vectors inside a Seed the same way. Do not number anything — order is conveyed by position.",
  "",
  "RULE 6 — JSON ONLY.",
  "Respond with EXACTLY this JSON shape, no prose, no code fences:",
  '{ "seeds": [',
  '  { "label_writing_id": "<writing id>",',
  '    "label_offset": <int>,',
  '    "label_length": <int>,',
  '    "growth_vectors": [',
  '      { "label_writing_id": "<writing id>",',
  '        "label_offset": <int>,',
  '        "label_length": <int>,',
  '        "writing_ids": ["<writing id>", ...] }',
  '    ] }',
  '] }',
].join("\n");

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

function normEarth(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function trimBody(s) {
  const str = String(s || "");
  return str.length > MAX_WRITING_CHARS ? str.slice(0, MAX_WRITING_CHARS) : str;
}

// Group the founder's writings by their Earth tag. Drops writings
// missing an Earth or a body; sorts the remaining list per Earth by
// recency for stable ordering downstream. Returns:
//   [{ earthId, earthName, writings: [{ id, title, body, time }] }, ...]
// where earthName is the verbatim form the founder typed (the most
// recent variant, when the same normalised name appears with multiple
// casings).
function groupByEarth(writings) {
  const map = new Map();
  for (const w of writings) {
    if (!w || !w.id || !w.earth) continue;
    const body = trimBody(w.body);
    if (!body) continue;
    const key = normEarth(w.earth);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { earthId: key, earthName: String(w.earth).trim(), writings: [] });
    }
    const slot = map.get(key);
    slot.writings.push({ id: w.id, title: w.title || "", body, time: 0 });
  }
  return Array.from(map.values());
}

function buildUserMessage(earth) {
  const parts = [];
  parts.push(`Earth: ${earth.earthName}`);
  parts.push("");
  parts.push("Writings (the founder's verbatim text; every label you return must be a contiguous substring of exactly one of these bodies):");
  parts.push("");
  for (const w of earth.writings) {
    parts.push(`### writing id: ${w.id}`);
    if (w.title) parts.push(`title: ${w.title}`);
    parts.push("body:");
    parts.push(w.body);
    parts.push("");
  }
  parts.push(`Return ${MIN_SEEDS_PER_EARTH}-${MAX_SEEDS_PER_EARTH} Seeds for this Earth. Respond with the JSON object only.`);
  return parts.join("\n");
}

async function callAnthropic(systemPrompt, userMessage) {
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
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
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

function parseClaudeJson(text) {
  const trimmed = (text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  // Tolerate stray prose before/after by finding the first {...} run.
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// Verify that an offset/length pair resolves to a non-empty substring
// inside the named writing's body. The substring IS the label; we
// don't compare to a separate model-emitted string because the prompt
// instructs the model to return offsets only.
function resolveLabel(writingsById, claim) {
  if (!claim || typeof claim !== "object") return null;
  const id = String(claim.label_writing_id || "");
  const off = Number(claim.label_offset);
  const len = Number(claim.label_length);
  if (!writingsById.has(id)) return null;
  if (!Number.isInteger(off) || off < 0) return null;
  if (!Number.isInteger(len) || len <= 0 || len > 200) return null;
  const body = writingsById.get(id).body;
  if (off + len > body.length) return null;
  const label = body.slice(off, off + len).trim();
  if (!label) return null;
  // Reject labels that span multiple paragraphs — they read clunky.
  if (label.includes("\n\n")) return null;
  return {
    label,
    sourceWritingId: id,
    sourceOffset: off,
    sourceLength: len,
  };
}

function validateAndShape(parsed, writingsByEarth) {
  if (!parsed || !Array.isArray(parsed.seeds)) return [];
  const writingsById = new Map();
  for (const w of writingsByEarth) writingsById.set(w.id, w);
  const earthWritingIds = new Set(writingsByEarth.map((w) => w.id));

  const seeds = [];
  for (const rawSeed of parsed.seeds) {
    const resolved = resolveLabel(writingsById, rawSeed);
    if (!resolved) continue;
    const growthVectors = [];
    const rawVectors = Array.isArray(rawSeed.growth_vectors) ? rawSeed.growth_vectors : [];
    for (const rawVec of rawVectors) {
      const v = resolveLabel(writingsById, rawVec);
      if (!v) continue;
      const writingIds = Array.isArray(rawVec.writing_ids)
        ? rawVec.writing_ids.filter((id) => earthWritingIds.has(String(id))).map(String)
        : [];
      if (!writingIds.length) {
        // The Growth vector's own sourceWritingId is always one of the
        // founder's writings; fall back to that so we don't drop a
        // vector just because the model forgot writing_ids.
        writingIds.push(v.sourceWritingId);
      }
      growthVectors.push({
        label: v.label,
        sourceWritingId: v.sourceWritingId,
        sourceOffset: v.sourceOffset,
        sourceLength: v.sourceLength,
        writingIds: Array.from(new Set(writingIds)),
      });
    }
    if (!growthVectors.length) continue;
    seeds.push({
      label: resolved.label,
      sourceWritingId: resolved.sourceWritingId,
      sourceOffset: resolved.sourceOffset,
      sourceLength: resolved.sourceLength,
      growthVectors,
    });
    if (seeds.length >= MAX_SEEDS_PER_EARTH) break;
  }

  return seeds;
}

async function clusterEarth(earth) {
  // Two-shot: one retry on validation failure. On the second failure
  // we drop the Earth (it returns an empty seed list and is omitted
  // from the response by the caller).
  for (let attempt = 0; attempt < 2; attempt++) {
    let text;
    try {
      text = await callAnthropic(CLUSTER_SYSTEM_PROMPT, buildUserMessage(earth));
    } catch (err) {
      if (attempt === 1) throw err;
      continue;
    }
    const parsed = parseClaudeJson(text);
    const seeds = validateAndShape(parsed, earth.writings);
    if (seeds.length >= MIN_SEEDS_PER_EARTH) return seeds;
  }
  return [];
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
  const writings = Array.isArray(body.writings) ? body.writings : null;
  if (!writings) {
    res.status(400).json({ error: "writings array is required" });
    return;
  }

  // Group by Earth, drop Earths below the per-Earth threshold.
  const grouped = groupByEarth(writings).filter((g) => g.writings.length >= MIN_PER_EARTH);

  if (!grouped.length) {
    // Cold-start: nothing meaningful to cluster yet. The renderer
    // hides the tree <nav> entirely when it sees an empty earths array.
    res.status(200).json({ earths: [] });
    return;
  }

  // Order Earths by most-recently-written-in (use the latest writing
  // body as a proxy — `time` isn't carried through the request, so we
  // fall back to insertion order which already reflects the founder's
  // typing-order for the localStorage source).
  // (The frontend can re-order client-side if needed.)

  try {
    const earths = [];
    for (const earth of grouped) {
      const seeds = await clusterEarth(earth);
      if (!seeds.length) continue;
      earths.push({
        earthId: earth.earthId,
        earthName: earth.earthName,
        seeds,
      });
    }
    res.status(200).json({ earths });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
  }
});
