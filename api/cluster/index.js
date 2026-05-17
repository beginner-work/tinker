/* POST /api/cluster
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { writings: [{ id, kind, earth, title, body, updatedAt }, ...],
 *         minWritingsPerEarth: number }
 * Reply: { earths: [{ earthId, earthName,
 *           seeds: [{ label, sourceWritingId, sourceOffset, sourceLength,
 *                     growthVectors: [{ label, sourceWritingId,
 *                       sourceOffset, sourceLength, writingIds: [...] }, ...]
 *                   }, ...]
 *         }, ...] }
 *
 * Groups the caller's writings by `earth`, then for each Earth with
 * enough writings asks Claude Haiku 4.5 to produce 2–5 Seeds, each
 * carrying its own 1+ Growth vectors. The model returns label offsets,
 * not strings, so the server can validate that every label is a
 * verbatim substring of the writing it claims to come from. Pairs
 * that don't validate are dropped, never rendered.
 *
 * Mirrors /api/search and /api/claude/converse for auth + key
 * handling. The Anthropic key lives only on the server.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");

const SYSTEM_PROMPT = `You build a quiet, mirror-like sidebar tree for a writing tool called tinker. Founders write from places (Earths). You read the writings from one Earth and pick:

  - 2 to 5 Seeds. A Seed is one cluster of related writings. The label is a verbatim phrase from one of those writings.
  - For each Seed, 1 or more Growth vectors. A Growth vector is a tighter topic inside the Seed. Each growth-vector label is a verbatim phrase from one of the writings it represents.

The rules are tight:

  1. Labels MUST be verbatim contiguous substrings of the writing's body. Return label as ABSENCE OF QUOTES, with sourceWritingId, sourceOffset (zero-based index into that writing's body), and sourceLength (character length). The label string MUST equal body.substring(sourceOffset, sourceOffset + sourceLength). No paraphrasing. No translation. No editorial cleanup. No spell-correction. If body says "his hands", label is "his hands" — not "the hands" or "His hands".

  2. Labels are short — 2 to 6 words is the sweet spot. They feel like phrases a person would say, not summaries. "the barber shop" yes; "thoughts on grooming" no. "hop tinctures at 7am" yes; "morning bitter tonics" no.

  3. Tone: composed, not commentary. Never characterise the writer. Never write a label like "your career stuff" or "thoughts on family". The label IS one of their phrases — quoted forward.

  4. A growth vector may represent multiple writings — list their IDs in writingIds. A growth vector with one writing has writingIds with one element.

  5. Each Seed must contain at least one Growth vector.

  6. Do NOT include any seed or growth vector whose label you cannot find verbatim in some writing's body. Better to return 3 valid Seeds than 5 with one invented label.

Respond with strict JSON, no prose, no markdown fences:

{
  "seeds": [
    {
      "label": "<verbatim phrase>",
      "sourceWritingId": "<id>",
      "sourceOffset": <int>,
      "sourceLength": <int>,
      "growthVectors": [
        {
          "label": "<verbatim phrase>",
          "sourceWritingId": "<id>",
          "sourceOffset": <int>,
          "sourceLength": <int>,
          "writingIds": ["<id>", ...]
        }
      ]
    }
  ]
}
`;

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

function normalizeEarth(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function groupByEarth(writings) {
  const map = new Map();
  for (const w of writings) {
    if (!w || !w.earth || !w.id || !w.body) continue;
    const key = normalizeEarth(w.earth);
    if (!map.has(key)) {
      map.set(key, { earthId: key, earthName: String(w.earth).trim(), writings: [] });
    }
    map.get(key).writings.push(w);
  }
  // Order Earths by most-recently-written-in (descending). Sidebar
  // numbering and default-expansion key off this.
  return Array.from(map.values()).sort((a, b) => {
    const ta = Math.max(...a.writings.map((w) => w.updatedAt || 0));
    const tb = Math.max(...b.writings.map((w) => w.updatedAt || 0));
    return tb - ta;
  });
}

async function callAnthropic(userMessage) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), {
      status: 503,
    });
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
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
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

function buildEarthMessage(earth) {
  const lines = [];
  lines.push(`Earth: ${earth.earthName}`);
  lines.push("");
  lines.push("Writings from this earth — body text follows the ID. The bodies are what you quote from. Treat each body's text as the canonical source of truth for offsets.");
  lines.push("");
  for (const w of earth.writings) {
    lines.push(`--- id=${w.id} ---`);
    lines.push(w.body);
    lines.push("");
  }
  lines.push("Return JSON now. 2 to 5 Seeds, each with at least one Growth vector, every label verbatim from some body. No invented strings.");
  return lines.join("\n");
}

function parseClaude(text) {
  const trimmed = (text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// Verify a (writingId, offset, length) triple actually points at a
// substring that equals the proposed label. Used to drop AI-authored
// strings — only verbatim phrases survive.
function validateLabel(label, sourceWritingId, sourceOffset, sourceLength, writingsById) {
  if (typeof label !== "string" || !label) return false;
  if (typeof sourceWritingId !== "string") return false;
  if (!Number.isInteger(sourceOffset) || sourceOffset < 0) return false;
  if (!Number.isInteger(sourceLength) || sourceLength <= 0) return false;
  const w = writingsById.get(sourceWritingId);
  if (!w) return false;
  const body = String(w.body || "");
  if (sourceOffset + sourceLength > body.length) return false;
  const slice = body.substring(sourceOffset, sourceOffset + sourceLength);
  return slice === label;
}

// Best-effort recovery when the model returns the right label but a
// wrong offset (very common failure mode — it counts characters
// poorly). Re-find the label in the source writing's body. Returns
// { offset, length } or null if the label can't be found verbatim.
function locateLabel(label, sourceWritingId, writingsById) {
  if (typeof label !== "string" || !label) return null;
  const w = writingsById.get(sourceWritingId);
  if (!w) return null;
  const body = String(w.body || "");
  const idx = body.indexOf(label);
  if (idx < 0) return null;
  return { offset: idx, length: label.length };
}

// Sanity-bound clustering input. Capping bodies stops one founder
// with 50 essays from breaking the prompt budget; the floor on
// labels prevents the model returning entire paragraphs as labels.
const MAX_BODY_CHARS = 4000;
const MAX_LABEL_CHARS = 80;

function trimWritings(writings) {
  return writings.map((w) => ({
    ...w,
    body: String(w.body || "").slice(0, MAX_BODY_CHARS),
  }));
}

// Sift through Claude's response and keep only fully-validated rows.
// One retry: if a label has the right text but a wrong offset, find
// it. Anything else gets dropped — better to ship fewer accurate
// labels than a fifth with an invented string.
function sanitizeSeeds(rawSeeds, writingsById) {
  if (!Array.isArray(rawSeeds)) return [];
  const out = [];
  for (const seed of rawSeeds) {
    if (!seed || typeof seed !== "object") continue;
    let label = typeof seed.label === "string" ? seed.label : "";
    if (label.length > MAX_LABEL_CHARS) continue;
    let { sourceWritingId, sourceOffset, sourceLength } = seed;
    let valid = validateLabel(label, sourceWritingId, sourceOffset, sourceLength, writingsById);
    if (!valid) {
      const loc = locateLabel(label, sourceWritingId, writingsById);
      if (loc) {
        sourceOffset = loc.offset;
        sourceLength = loc.length;
        valid = validateLabel(label, sourceWritingId, sourceOffset, sourceLength, writingsById);
      }
    }
    if (!valid) continue;

    const growthVectors = [];
    if (Array.isArray(seed.growthVectors)) {
      for (const gv of seed.growthVectors) {
        if (!gv || typeof gv !== "object") continue;
        const gvLabel = typeof gv.label === "string" ? gv.label : "";
        if (!gvLabel || gvLabel.length > MAX_LABEL_CHARS) continue;
        let gvOffset = gv.sourceOffset;
        let gvLength = gv.sourceLength;
        const gvSource = typeof gv.sourceWritingId === "string" ? gv.sourceWritingId : sourceWritingId;
        let gvValid = validateLabel(gvLabel, gvSource, gvOffset, gvLength, writingsById);
        if (!gvValid) {
          const loc = locateLabel(gvLabel, gvSource, writingsById);
          if (loc) {
            gvOffset = loc.offset;
            gvLength = loc.length;
            gvValid = validateLabel(gvLabel, gvSource, gvOffset, gvLength, writingsById);
          }
        }
        if (!gvValid) continue;
        // writingIds: model may include ids that aren't in this earth's
        // input. Filter to known.
        const writingIds = Array.isArray(gv.writingIds)
          ? gv.writingIds.filter((id) => typeof id === "string" && writingsById.has(id))
          : [];
        if (writingIds.length === 0) writingIds.push(gvSource);
        growthVectors.push({
          label: gvLabel,
          sourceWritingId: gvSource,
          sourceOffset: gvOffset,
          sourceLength: gvLength,
          writingIds,
        });
      }
    }
    if (growthVectors.length === 0) continue;

    out.push({
      label,
      sourceWritingId,
      sourceOffset,
      sourceLength,
      growthVectors,
    });
  }
  return out;
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
  if (!body || !Array.isArray(body.writings)) {
    res.status(400).json({ error: "writings array is required" });
    return;
  }
  const writings = trimWritings(body.writings);
  // [NEEDS INPUT] Open question 1 — per-Earth minimum: 3 vs 5.
  // Default 3 (per spec) — lets a fresh-ish writer see the tree
  // sooner. Confirm with founder before final ship.
  // [NEEDS INPUT] Open question 2 — multi-Earth single-writing edge:
  // writings under an under-threshold Earth are excluded from the
  // tree entirely (no "loose" growth vector). Default per spec.
  const minWritings = Math.max(
    1,
    Math.min(10, Number(body.minWritingsPerEarth) || 3),
  );

  const earths = groupByEarth(writings);
  const result = { earths: [] };

  for (const earth of earths) {
    if (earth.writings.length < minWritings) continue;
    const writingsById = new Map(earth.writings.map((w) => [w.id, w]));

    let parsed = null;
    try {
      const text = await callAnthropic(buildEarthMessage(earth));
      parsed = parseClaude(text);
    } catch (err) {
      // Surface upstream errors so the caller can fall back to the
      // last cached tree. Don't bail the whole loop — one bad Earth
      // shouldn't take the others down.
      try { console.error("[cluster] Earth failed", earth.earthId, err.message); } catch { /* ignore */ }
      continue;
    }
    if (!parsed) continue;

    let seeds = sanitizeSeeds(parsed.seeds, writingsById);
    // One retry if the first attempt yielded fewer than 2 seeds.
    if (seeds.length < 2) {
      try {
        const retryText = await callAnthropic(buildEarthMessage(earth) +
          "\n\nThe previous response had too few valid Seeds — try again. Remember: 2 to 5 Seeds, every label a verbatim contiguous substring.");
        const retryParsed = parseClaude(retryText);
        if (retryParsed) {
          const retrySeeds = sanitizeSeeds(retryParsed.seeds, writingsById);
          if (retrySeeds.length >= seeds.length) seeds = retrySeeds;
        }
      } catch { /* fall through to whatever the first call produced */ }
    }

    if (seeds.length < 2) continue; // Per spec: 2–5 Seeds per Earth.
    if (seeds.length > 5) seeds = seeds.slice(0, 5);

    result.earths.push({
      earthId: earth.earthId,
      earthName: earth.earthName,
      seeds,
    });
  }

  res.status(200).json(result);
});
