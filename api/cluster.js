/* POST /api/cluster
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { writings: [{ id, kind, earth, title, body, ... }, ...] }
 * Reply: { earths: [{ earthId, earthName, seeds: [...] }, ...] }
 *
 * Re-validates the session against Stytch on every request (same
 * pattern as /api/search), then asks Claude Haiku 4.5 to cluster the
 * founder's writings into Earth → Seed → Growth-vector tiers.
 *
 * Verbatim guarantee: every Seed and Growth-vector label must be a
 * verbatim substring of one of the founder's writings. The model is
 * instructed to return offsets, not strings; this function validates
 * each (offset, length) pair against the underlying writing and drops
 * any pair that doesn't match. Invalid responses get one retry; on
 * second failure the offending label is dropped, not shipped. Better
 * to render four Seeds than five with one AI-authored label.
 *
 * Per-Earth threshold: an Earth needs at least MIN_WRITINGS_PER_EARTH
 * writings before it produces Seeds. Below that, the Earth is omitted
 * from the response (rendered nowhere in the tree). [NEEDS INPUT]
 * default 3 from build-prompt.md.
 *
 * Per-Seed bounds: 2–5 Seeds per Earth. An Earth that yields only one
 * surviving Seed is omitted entirely (the floor is 2). Anything above
 * 5 is trimmed to the top 5 by writing count.
 *
 * Zero external deps — uses Node 18+ global fetch.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");

// Per-Earth writing floor. Founder-set to 1 (down from the
// build-prompt.md default of 3). MIN_SEEDS_PER_EARTH = 2 still
// enforces "at least two distinct topic clusters", so a 1-writing
// Earth only appears if the model can lift 2+ verbatim topic phrases
// out of that single writing — otherwise it's omitted from the tree.
const MIN_WRITINGS_PER_EARTH = 1;
const MIN_SEEDS_PER_EARTH = 2;
const MAX_SEEDS_PER_EARTH = 5;
const MAX_BODY_CHARS = 6000;
const MAX_BYTES = 256 * 1024;

const SYSTEM_PROMPT = `You cluster a founder's writings into a three-tier tree for the tinker writing tool: Earth → Seed → Growth vector.

You receive a list of writings, all from a single Earth (a place the founder writes from). You return between 2 and 5 Seeds. Each Seed is a topic cluster of one or more writings. Inside each Seed, you return one Growth vector per distinct sub-topic.

CRITICAL RULE — labels must be verbatim substrings of the founder's writing.
- Every Seed label and every Growth-vector label must be a contiguous substring of exactly one of the writings you were given.
- You return offsets, NOT strings. Each label is identified by { sourceWritingId, sourceOffset, sourceLength } where sourceOffset is the 0-indexed character offset into that writing's body, and sourceLength is the length of the substring.
- The substring you select must read as a noun phrase or short phrase the founder actually used — 2 to 8 words is the typical range. Avoid full sentences. Avoid trailing punctuation. Avoid leading articles like "the" or "a" unless they're truly part of the phrase the founder used.
- Do NOT paraphrase. Do NOT summarise. Do NOT invent labels. Do NOT improve the founder's words.

Seed labels are slightly broader; Growth-vector labels are more specific. Both must be verbatim. If you cannot find a clean verbatim substring for a cluster, drop the cluster rather than invent one.

Group writings by topic, not by Earth — all writings in your input are from the same Earth. A Growth vector may cover multiple writings (those become a count badge in the UI); a Seed contains one or more Growth vectors.

RESPOND IN STRICT JSON. Single object, exactly these keys:
{
  "seeds": [
    {
      "label": { "sourceWritingId": string, "sourceOffset": number, "sourceLength": number },
      "growthVectors": [
        {
          "label": { "sourceWritingId": string, "sourceOffset": number, "sourceLength": number },
          "writingIds": [string, ...]
        },
        ...
      ]
    },
    ...
  ]
}

Never wrap the JSON in code fences. Never add explanations outside the JSON. If the writings don't cluster into at least 2 distinct topics, return { "seeds": [] }.`;

function parseBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function normalize(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function clipBody(s) {
  const trimmed = String(s || "");
  if (trimmed.length <= MAX_BODY_CHARS) return trimmed;
  return trimmed.slice(0, MAX_BODY_CHARS);
}

function groupByEarth(writings) {
  const groups = new Map();
  for (const w of writings) {
    if (!w || !w.id || !w.earth || !w.body) continue;
    const key = normalize(w.earth);
    if (!groups.has(key)) {
      groups.set(key, { earthId: key, earthName: String(w.earth).trim(), writings: [] });
    }
    groups.get(key).writings.push({
      id: w.id,
      kind: w.kind || "draft",
      title: w.title || null,
      body: clipBody(w.body),
      createdAt: w.createdAt || 0,
      updatedAt: w.updatedAt || w.createdAt || 0,
    });
  }
  return Array.from(groups.values());
}

async function callAnthropic({ system, userMessage, retry = false }) {
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
          text: system,
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

function tryParseJson(text) {
  const trimmed = String(text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try { return JSON.parse(stripped); }
  catch { return null; }
}

// Given the model's labels (offsets into a writing), pull the actual
// substring and verify it matches what the model picked. Drops any
// label whose offset is out of range, whose source writing isn't in
// our input, or whose substring is empty after trim.
function validateLabel(spec, byId) {
  if (!spec || typeof spec !== "object") return null;
  const id = String(spec.sourceWritingId || "");
  const offset = Number.isFinite(spec.sourceOffset) ? Math.floor(spec.sourceOffset) : -1;
  const length = Number.isFinite(spec.sourceLength) ? Math.floor(spec.sourceLength) : -1;
  if (!id || offset < 0 || length <= 0) return null;
  const writing = byId.get(id);
  if (!writing) return null;
  if (offset + length > writing.body.length) return null;
  const substring = writing.body.slice(offset, offset + length);
  const trimmed = substring.trim();
  if (!trimmed) return null;
  // The model is told 2–8 words is the typical range — enforce a
  // hard upper bound so a runaway full-sentence label gets dropped.
  if (trimmed.length > 120) return null;
  return {
    label: trimmed,
    sourceWritingId: id,
    sourceOffset: offset,
    sourceLength: length,
  };
}

function buildUserMessage(earthName, writings) {
  const lines = [];
  lines.push(`Earth: ${earthName}`);
  lines.push(`Writing count: ${writings.length}`);
  lines.push("");
  lines.push("Writings (each labelled with its id; body is between <body>…</body> tags):");
  lines.push("");
  for (const w of writings) {
    lines.push(`--- id: ${w.id} ---`);
    if (w.title) lines.push(`title: ${w.title}`);
    lines.push(`<body>`);
    lines.push(w.body);
    lines.push(`</body>`);
    lines.push("");
  }
  lines.push("Cluster these writings into 2–5 Seeds. Inside each Seed, list one Growth vector per distinct sub-topic. Every label must be a verbatim substring of one of the writings above; return offsets, not strings. Respond with the JSON object only.");
  return lines.join("\n");
}

async function clusterEarth(earthGroup) {
  if (!earthGroup.writings || earthGroup.writings.length < MIN_WRITINGS_PER_EARTH) {
    return null;
  }
  const byId = new Map(earthGroup.writings.map((w) => [w.id, w]));
  const userMessage = buildUserMessage(earthGroup.earthName, earthGroup.writings);

  let parsed = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    let raw;
    try {
      raw = await callAnthropic({ system: SYSTEM_PROMPT, userMessage });
    } catch (err) {
      // Surface upstream errors; the renderer falls back to the
      // previous cached tree on any non-2xx.
      throw err;
    }
    parsed = tryParseJson(raw);
  }
  if (!parsed || !Array.isArray(parsed.seeds)) return null;

  // Validate every label and filter empties. A Seed with zero
  // surviving Growth vectors gets dropped.
  const seeds = [];
  for (const rawSeed of parsed.seeds) {
    const seedLabel = validateLabel(rawSeed && rawSeed.label, byId);
    if (!seedLabel) continue;

    const growthVectors = [];
    if (Array.isArray(rawSeed.growthVectors)) {
      for (const rawGv of rawSeed.growthVectors) {
        const gvLabel = validateLabel(rawGv && rawGv.label, byId);
        if (!gvLabel) continue;
        const writingIds = Array.isArray(rawGv.writingIds)
          ? Array.from(new Set(rawGv.writingIds.filter((id) => byId.has(id))))
          : [];
        if (writingIds.length === 0) continue;
        growthVectors.push({
          label: gvLabel.label,
          sourceWritingId: gvLabel.sourceWritingId,
          sourceOffset: gvLabel.sourceOffset,
          sourceLength: gvLabel.sourceLength,
          writingIds,
        });
      }
    }
    if (growthVectors.length === 0) continue;
    seeds.push({
      label: seedLabel.label,
      sourceWritingId: seedLabel.sourceWritingId,
      sourceOffset: seedLabel.sourceOffset,
      sourceLength: seedLabel.sourceLength,
      growthVectors,
    });
  }

  // Enforce 2–5 Seeds-per-Earth bounds.
  if (seeds.length < MIN_SEEDS_PER_EARTH) return null;
  if (seeds.length > MAX_SEEDS_PER_EARTH) {
    seeds.sort((a, b) => {
      // Sort by total writing count across growth vectors, desc.
      const ca = a.growthVectors.reduce((n, gv) => n + gv.writingIds.length, 0);
      const cb = b.growthVectors.reduce((n, gv) => n + gv.writingIds.length, 0);
      return cb - ca;
    });
    seeds.length = MAX_SEEDS_PER_EARTH;
  }

  return {
    earthId: earthGroup.earthId,
    earthName: earthGroup.earthName,
    seeds,
  };
}

module.exports = async function handler(req, res) {
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

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Invalid JSON" });
    return;
  }
  if (!body || !Array.isArray(body.writings)) {
    res.status(400).json({ error: "writings is required" });
    return;
  }

  // Group by Earth on the server so the model never has to figure out
  // which writings live under which place — that's a precise key, not
  // a clustering decision.
  const groups = groupByEarth(body.writings);

  // Run all Earths in parallel — they're independent calls. A single
  // failure drops that Earth from the response; the response shape
  // already says "missing Earths get omitted" so the client renders
  // what survived.
  const results = await Promise.all(
    groups.map((g) => clusterEarth(g).catch(() => null))
  );

  const earths = results.filter(Boolean);
  res.status(200).json({ earths });
};
