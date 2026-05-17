/* POST /api/cluster
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { writings: [{ id, earth, title, body }, ...] }
 * Reply: { earths: [{ earthId, earthName, seeds: [{ label, sourceWritingId,
 *                       sourceOffset, sourceLength, growthVectors: [{ label,
 *                       sourceWritingId, sourceOffset, sourceLength,
 *                       writingIds: [...] }] }] }] }
 *
 * The three-tier sidebar's compute step. Groups writings by their Earth
 * field, then asks Claude Haiku 4.5 to surface 2–5 Seeds per Earth with
 * verbatim labels lifted from the founder's own writing. Every label
 * comes back as a (sourceWritingId, sourceOffset, sourceLength) tuple;
 * we validate the offset by reading the substring server-side and
 * dropping anything that doesn't match exactly. Better four real Seeds
 * than five with one AI-authored label.
 *
 * Re-validates the Stytch session on every request — same pattern as
 * /api/search and /api/claude/converse. The Anthropic key is held
 * server-side and never touches the browser.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { withResponseLogging } = require("./_lib/log.js");

// Per the founder's answer to the open question, the per-Earth floor
// is 1 writing. Clustering still has to surface ≥2 Seeds per Earth
// (else the Earth is omitted from the response — see Constraints in
// the build prompt), so on a single-writing Earth the model is asked
// to pull out two distinct verbatim phrases from that one body.
const MIN_WRITINGS_PER_EARTH = 1;
const MIN_SEEDS_PER_EARTH = 2;
const MAX_SEEDS_PER_EARTH = 5;
const MAX_GROWTH_VECTORS_PER_SEED = 8;

const CLUSTER_MODEL = "claude-haiku-4-5";
const CLUSTER_MAX_TOKENS = 2048;

const CLUSTER_SYSTEM_PROMPT = [
  "You read a single founder's writings from one place ('Earth') and surface the topics inside.",
  "",
  "The founder will see your output as a tree in their sidebar. They never see this prompt; they only see the labels you pick. Every label must be a verbatim phrase the founder wrote — never paraphrased, never invented, never characterised. You are mirroring their writing back to them, not commentating.",
  "",
  "OUTPUT SHAPE — RESPOND IN STRICT JSON ONLY (no code fences, no prose):",
  '{ "seeds": [ {',
  '  "label": "<verbatim phrase>",',
  '  "sourceWritingId": "<writing id>",',
  '  "sourceOffset": <integer index into that writing\'s body>,',
  '  "sourceLength": <integer length, ≥3>,',
  '  "growthVectors": [ {',
  '    "label": "<verbatim phrase>",',
  '    "sourceWritingId": "<writing id>",',
  '    "sourceOffset": <integer>,',
  '    "sourceLength": <integer, ≥3>,',
  '    "writingIds": ["<writing id>", ...]',
  "  } ]",
  "} ] }",
  "",
  "RULES:",
  "1. Each Seed is a cluster — a recurring theme inside this Earth. Aim for 2–5 Seeds. If the writings under this Earth don't support 2 distinct themes, return as many as you can (1 is acceptable; the caller will decide whether to render).",
  "2. Each Seed contains 1+ Growth vectors — the specific things being learned. Pull a verbatim phrase from one of the writings the Growth vector represents. A Growth vector can span multiple writings if they're about the same specific thing; list every writing's id in writingIds.",
  "3. Labels are short — 1–6 words is the right shape. Pick evocative phrases the founder actually typed: \"the barber shop\", \"hop tinctures at 7am\", \"his hands\". Avoid generic phrases (\"the thing\", \"some stuff\"). Avoid AI-tone (\"thoughts on...\", \"reflections about...\"). If you find yourself smoothing a phrase, stop — pick a different one verbatim instead.",
  "4. Offsets are 0-indexed character offsets into the body of the writing identified by sourceWritingId. body.substring(sourceOffset, sourceOffset + sourceLength) MUST equal label exactly. If you can't pinpoint the offset, do not invent one — drop that label.",
  "5. Cover the writings without forcing every snippet under a Seed. It's fine if some writing is only represented at the Earth level (the founder will still see the Earth row).",
  "6. Do NOT include any characterisation of the founder, advice, summary, or commentary. The tree is a mirror. The labels are the founder's own words, picked and arranged.",
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

function normalizeName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Group writings by Earth (normalized). Writings without an `earth`
// field are dropped — they predate the welcome grid or the user
// skipped the scene capture; either way the tree can't place them.
function groupByEarth(writings) {
  const map = new Map();
  for (const w of writings) {
    if (!w || typeof w !== "object") continue;
    const earthName = String(w.earth || "").trim();
    if (!earthName) continue;
    const key = normalizeName(earthName);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { earthId: key, earthName, writings: [] });
    const bucket = map.get(key);
    // Prefer the most recent capitalisation of the Earth name as the
    // canonical display. Treat the longest version as a tie-breaker
    // (founder typed "Kitchen counter" not "kitchen counter").
    if (earthName.length > bucket.earthName.length) bucket.earthName = earthName;
    bucket.writings.push({
      id: String(w.id || ""),
      title: String(w.title || ""),
      body: String(w.body || ""),
    });
  }
  return map;
}

function buildUserMessage(earthName, writings) {
  const lines = [];
  lines.push(`Earth: ${earthName}`);
  lines.push("");
  lines.push(`Writings under this Earth (${writings.length} total). Each is delimited; offsets you return refer to character positions inside the body string between <body> and </body>, 0-indexed.`);
  lines.push("");
  for (const w of writings) {
    lines.push(`Writing id: ${w.id}`);
    if (w.title) lines.push(`Title: ${w.title}`);
    lines.push("<body>");
    lines.push(w.body);
    lines.push("</body>");
    lines.push("");
  }
  lines.push(`Surface ${MIN_SEEDS_PER_EARTH}–${MAX_SEEDS_PER_EARTH} Seeds with verbatim labels. Return JSON only.`);
  return lines.join("\n");
}

// Strict JSON parse with one tolerance: strip code fences if the model
// wrapped its response in them. Anything else fails fast.
function parseJsonResponse(text) {
  const trimmed = String(text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    return JSON.parse(stripped);
  } catch {
    // Last-chance: pull out the first {...} block. Rare; the system
    // prompt is explicit about no prose.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

// Resolve sourceWritingId/Offset/Length against the actual writing
// body and verify the substring matches the label exactly. Returns
// true only when the offset is sound — the label, the offset, and the
// body all line up.
function offsetValidates(label, sourceWritingId, sourceOffset, sourceLength, writingsById) {
  if (typeof label !== "string" || !label.length) return false;
  if (typeof sourceWritingId !== "string" || !sourceWritingId) return false;
  if (!Number.isInteger(sourceOffset) || sourceOffset < 0) return false;
  if (!Number.isInteger(sourceLength) || sourceLength < 1) return false;
  const writing = writingsById.get(sourceWritingId);
  if (!writing) return false;
  const body = String(writing.body || "");
  if (sourceOffset + sourceLength > body.length) return false;
  const slice = body.substring(sourceOffset, sourceOffset + sourceLength);
  return slice === label;
}

// Validate the model's response shape and prune every label that
// doesn't survive offset validation. Returns the cleaned seed list or
// null if validation fails entirely.
function validateSeeds(parsed, writingsById) {
  if (!parsed || !Array.isArray(parsed.seeds)) return null;
  const out = [];
  for (const seed of parsed.seeds) {
    if (!seed || typeof seed !== "object") continue;
    if (!offsetValidates(seed.label, seed.sourceWritingId, seed.sourceOffset, seed.sourceLength, writingsById)) {
      continue;
    }
    const gvs = Array.isArray(seed.growthVectors) ? seed.growthVectors : [];
    const cleanGrowthVectors = [];
    for (const gv of gvs) {
      if (!gv || typeof gv !== "object") continue;
      if (!offsetValidates(gv.label, gv.sourceWritingId, gv.sourceOffset, gv.sourceLength, writingsById)) {
        continue;
      }
      const ids = Array.isArray(gv.writingIds) ? gv.writingIds.filter((id) => writingsById.has(id)) : [];
      // Always include the source writing in writingIds — that's the
      // single-source case the renderer uses to route a no-badge tap.
      if (!ids.includes(gv.sourceWritingId)) ids.unshift(gv.sourceWritingId);
      cleanGrowthVectors.push({
        label: gv.label,
        sourceWritingId: gv.sourceWritingId,
        sourceOffset: gv.sourceOffset,
        sourceLength: gv.sourceLength,
        writingIds: ids.slice(0, 32),
      });
      if (cleanGrowthVectors.length >= MAX_GROWTH_VECTORS_PER_SEED) break;
    }
    if (cleanGrowthVectors.length === 0) continue;
    out.push({
      label: seed.label,
      sourceWritingId: seed.sourceWritingId,
      sourceOffset: seed.sourceOffset,
      sourceLength: seed.sourceLength,
      growthVectors: cleanGrowthVectors,
    });
  }
  return out;
}

async function clusterEarth(earthName, writings) {
  const writingsById = new Map(writings.map((w) => [w.id, w]));
  const userMessage = buildUserMessage(earthName, writings);

  const callOnce = async () => {
    const result = await callAnthropic({
      system: CLUSTER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      maxTokens: CLUSTER_MAX_TOKENS,
    });
    const parsed = parseJsonResponse(result.text);
    return validateSeeds(parsed, writingsById);
  };

  // One retry on bad/empty validation. After the second swing, give up
  // on this Earth — the renderer omits it.
  let seeds = await callOnce().catch(() => null);
  if (!seeds || seeds.length === 0) {
    seeds = await callOnce().catch(() => null);
  }
  if (!seeds) return [];

  // Enforce the 2–5 Seeds-per-Earth contract. Below 2 → omit the Earth
  // (caller filters). Above 5 → keep the 5 with the most underlying
  // writings (sum of writingIds across their growth vectors).
  if (seeds.length > MAX_SEEDS_PER_EARTH) {
    seeds.sort((a, b) => {
      const aw = a.growthVectors.reduce((n, gv) => n + gv.writingIds.length, 0);
      const bw = b.growthVectors.reduce((n, gv) => n + gv.writingIds.length, 0);
      return bw - aw;
    });
    seeds = seeds.slice(0, MAX_SEEDS_PER_EARTH);
  }
  return seeds;
}

async function callAnthropic({ system, messages, maxTokens }) {
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
      model: CLUSTER_MODEL,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (data.error?.message || data.error)) || `Anthropic ${res.status}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return { text: textBlock ? textBlock.text : "", usage: data.usage };
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

  const grouped = groupByEarth(writings);
  const eligibleEarths = [];
  for (const bucket of grouped.values()) {
    if (bucket.writings.length >= MIN_WRITINGS_PER_EARTH) eligibleEarths.push(bucket);
  }

  // Sort Earths by recency of their most recent writing — the
  // founder's most-recently-used Earth is rendered first (and the
  // renderer expands it on first paint). The browser sends id/title/
  // body only; recency comes from the writings array's ordering,
  // which the caller is expected to pass most-recent first.
  eligibleEarths.sort((a, b) => {
    const ai = writings.findIndex((w) => normalizeName(w.earth || "") === a.earthId);
    const bi = writings.findIndex((w) => normalizeName(w.earth || "") === b.earthId);
    return ai - bi;
  });

  if (eligibleEarths.length === 0) {
    res.status(200).json({ earths: [] });
    return;
  }

  // Run clustering for each Earth. Parallel so the wall-clock stays
  // reasonable for founders with 3–5 Earths.
  const results = await Promise.all(
    eligibleEarths.map(async (bucket) => {
      try {
        const seeds = await clusterEarth(bucket.earthName, bucket.writings);
        if (!seeds || seeds.length < MIN_SEEDS_PER_EARTH) return null;
        return { earthId: bucket.earthId, earthName: bucket.earthName, seeds };
      } catch {
        return null;
      }
    })
  );

  const earths = results.filter(Boolean);
  res.status(200).json({ earths });
});
