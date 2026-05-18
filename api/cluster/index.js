/* POST /api/cluster
 *
 * Authorization: Bearer <stytch session_token>
 * Body: {
 *   writings: [{ id, kind, earth, title, body, createdAt }, ...],
 *   minWritingsPerEarth: number (default 3)
 * }
 * Reply: {
 *   earths: [
 *     {
 *       earthId, earthName,
 *       seeds: [
 *         {
 *           seedId, label, sourceWritingId, sourceOffset, sourceLength,
 *           growthVectors: [
 *             {
 *               vectorId, label,
 *               sourceWritingId, sourceOffset, sourceLength,
 *               writingIds: [...]
 *             }, ...
 *           ]
 *         }, ...
 *       ]
 *     }, ...
 *   ]
 * }
 *
 * Re-validates the session against Stytch on every request, then groups
 * the founder's writings by their `earth` field, asks Claude Haiku 4.5
 * to surface 2–5 Seeds per Earth (each with a verbatim label drawn
 * from one of the writings in the cluster) and inside each Seed the
 * Growth vectors that compose it. The labels Claude returns are
 * (sourceWritingId, sourceOffset, sourceLength) tuples, which we
 * validate by reading the substring at those offsets — any tuple whose
 * substring doesn't match what Claude claimed it would say is dropped
 * before the response goes out. Better four valid Seeds than five with
 * one AI-authored label.
 *
 * Mirrors api/search.js and api/claude/converse.js for the auth +
 * Anthropic call surface — same key handling, same Stytch re-validate,
 * same prompt-cached system block.
 *
 * Hidden writings are filtered by the caller; the function trusts its
 * input. No cross-user signal, no shared taxonomy.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");

const MIN_WRITINGS_PER_EARTH_DEFAULT = 3;
const MAX_SEEDS_PER_EARTH = 5;
const MIN_SEEDS_PER_EARTH = 2;
const MAX_EARTHS = 5;

const SYSTEM_PROMPT = [
  "You build a quiet curriculum-shaped tree of one founder's writing life.",
  "",
  "Input: a single Earth (a place the founder writes from, like \"home\" or \"the back porch at 7am\"), plus the founder's writings tagged to that Earth. Each writing has an id and a body.",
  "",
  "Your job: surface 2–5 Seeds inside this Earth. A Seed is a topic-cluster — a thread the founder keeps writing about from this place. Inside each Seed, surface 1–N Growth vectors — the specific things being learned inside the topic.",
  "",
  "RULES — hard:",
  "1. Every label (Seed label, Growth vector label) MUST be a verbatim substring of one of the founder's writings. Not paraphrased. Not generalised. Not improved. The label is identified by (sourceWritingId, sourceOffset, sourceLength) — sourceOffset is a 0-based character index into the writing body; sourceLength is the substring length in characters. The substring at that location IS the label. If you cannot find a tight verbatim phrase, do not invent one — emit fewer Seeds instead.",
  "2. Labels are short. Aim for 2–6 words. Up to 40 characters as a hard ceiling. A phrase like \"the barber shop\" or \"his hands\" or \"hop tinctures at 7am\" is right; a sentence is wrong.",
  "3. Each Growth vector points at one or more writingIds — the writings whose body contains the underlying material for that vector. The same writing may appear under multiple vectors if it covers multiple things.",
  "4. Order Seeds inside the Earth by writing-count descending (the Seed with the most writings comes first); ties broken by most-recent.",
  "5. No characterisations of the founder. No \"you've been thinking about\". No \"we noticed\". No commentary. Labels are phrases lifted from the founder's text; nothing else.",
  "6. Do not produce a Seed that would have zero Growth vectors. Do not produce an Earth with only 1 Seed (caller will drop it).",
  "",
  "RULES — soft:",
  "- Prefer concrete nouns and noun phrases for labels (\"the barber shop\", not \"barbering\"). The founder's exact words are the point.",
  "- Repetition across writings is signal — if the founder uses the same phrase across multiple sessions at this Earth, it is a strong candidate.",
  "- A single writing can contribute to multiple Seeds when it covers multiple distinct threads.",
  "",
  "OUTPUT — strict JSON, no preamble, no code fences:",
  "{",
  "  \"seeds\": [",
  "    {",
  "      \"label\": \"<verbatim phrase>\",",
  "      \"sourceWritingId\": \"<id>\",",
  "      \"sourceOffset\": <int>,",
  "      \"sourceLength\": <int>,",
  "      \"growthVectors\": [",
  "        {",
  "          \"label\": \"<verbatim phrase>\",",
  "          \"sourceWritingId\": \"<id>\",",
  "          \"sourceOffset\": <int>,",
  "          \"sourceLength\": <int>,",
  "          \"writingIds\": [\"<id>\", ...]",
  "        }",
  "      ]",
  "    }",
  "  ]",
  "}",
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

function normaliseEarth(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function groupByEarth(writings) {
  const map = new Map(); // earthKey → { earthName, writings, lastTouched }
  for (const w of writings) {
    if (!w || !w.id || !w.earth || typeof w.body !== "string" || !w.body.trim()) continue;
    const key = normaliseEarth(w.earth);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        earthKey: key,
        earthName: String(w.earth).trim(),
        writings: [],
        lastTouched: 0,
      });
    }
    const slot = map.get(key);
    slot.writings.push({
      id: String(w.id),
      title: String(w.title || ""),
      body: String(w.body),
      createdAt: Number(w.createdAt) || 0,
    });
    if (w.createdAt && w.createdAt > slot.lastTouched) slot.lastTouched = w.createdAt;
  }
  return Array.from(map.values());
}

async function callAnthropic({ system, user, maxTokens }) {
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
      max_tokens: Math.min(Math.max(Number(maxTokens) || 2048, 1), 4096),
      system: [
        {
          type: "text",
          text: system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: user }],
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

function buildEarthUserMessage(earth) {
  const lines = [];
  lines.push(`Earth: "${earth.earthName}"`);
  lines.push("");
  lines.push("Writings tagged to this Earth (id → body):");
  lines.push("");
  for (const w of earth.writings) {
    lines.push(`---`);
    lines.push(`id: ${w.id}`);
    if (w.title) lines.push(`title: ${w.title}`);
    lines.push(`body:`);
    lines.push(w.body);
  }
  lines.push("---");
  lines.push("");
  lines.push(`Surface 2–5 Seeds. Inside each Seed surface 1 or more Growth vectors. Labels are verbatim substrings; provide (sourceWritingId, sourceOffset, sourceLength) for each label. Reply with the JSON object only.`);
  return lines.join("\n");
}

function tryParseJson(raw) {
  const trimmed = (raw || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try { return JSON.parse(stripped); }
  catch {
    // Attempt a loose match — the model sometimes adds explanatory text.
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

// Verify that the substring at (sourceWritingId, sourceOffset, sourceLength)
// in the writings index matches the claimed label exactly. If yes, return
// the label as-is. If no, try a soft fallback (locate the claimed label
// as a substring inside the writing's body and adjust the offset). On
// total failure, return null and the caller drops the label.
function validateLabel(claim, writingsById) {
  if (!claim || typeof claim !== "object") return null;
  const label = String(claim.label || "").trim();
  const wid = String(claim.sourceWritingId || "");
  const writing = writingsById.get(wid);
  if (!label || !writing) return null;
  if (label.length > 60) return null;
  const off = Number(claim.sourceOffset);
  const len = Number(claim.sourceLength);
  if (Number.isInteger(off) && Number.isInteger(len) && off >= 0 && len > 0 && off + len <= writing.body.length) {
    const sub = writing.body.slice(off, off + len);
    if (sub === label) {
      return { label, sourceWritingId: wid, sourceOffset: off, sourceLength: len };
    }
  }
  // Soft fallback: search the body for the label and re-anchor.
  const idx = writing.body.indexOf(label);
  if (idx >= 0) {
    return {
      label,
      sourceWritingId: wid,
      sourceOffset: idx,
      sourceLength: label.length,
    };
  }
  return null;
}

function shapeSeeds(rawSeeds, writingsById) {
  const seeds = [];
  if (!Array.isArray(rawSeeds)) return seeds;
  for (const rawSeed of rawSeeds) {
    if (!rawSeed || typeof rawSeed !== "object") continue;
    const seedLabel = validateLabel(rawSeed, writingsById);
    if (!seedLabel) continue;
    const growthVectors = [];
    if (Array.isArray(rawSeed.growthVectors)) {
      for (const rawV of rawSeed.growthVectors) {
        if (!rawV || typeof rawV !== "object") continue;
        const vLabel = validateLabel(rawV, writingsById);
        if (!vLabel) continue;
        const writingIds = Array.isArray(rawV.writingIds)
          ? rawV.writingIds.map(String).filter((id) => writingsById.has(id))
          : [];
        // Default writingIds to [sourceWritingId] if the model omitted it
        // or returned nothing valid — every vector points at ≥1 writing.
        const finalIds = writingIds.length ? writingIds : [vLabel.sourceWritingId];
        growthVectors.push({
          vectorId: "gv_" + Math.random().toString(36).slice(2, 10),
          label: vLabel.label,
          sourceWritingId: vLabel.sourceWritingId,
          sourceOffset: vLabel.sourceOffset,
          sourceLength: vLabel.sourceLength,
          writingIds: finalIds,
        });
      }
    }
    if (!growthVectors.length) continue;
    seeds.push({
      seedId: "sd_" + Math.random().toString(36).slice(2, 10),
      label: seedLabel.label,
      sourceWritingId: seedLabel.sourceWritingId,
      sourceOffset: seedLabel.sourceOffset,
      sourceLength: seedLabel.sourceLength,
      growthVectors,
    });
  }
  return seeds;
}

async function clusterOneEarth(earth, attempt = 1) {
  const writingsById = new Map(earth.writings.map((w) => [w.id, w]));
  const user = buildEarthUserMessage(earth);
  let result;
  try {
    result = await callAnthropic({ system: SYSTEM_PROMPT, user, maxTokens: 1800 });
  } catch (err) {
    if (attempt === 1) return clusterOneEarth(earth, 2);
    throw err;
  }
  const parsed = tryParseJson(result.text);
  let seeds = parsed && Array.isArray(parsed.seeds) ? shapeSeeds(parsed.seeds, writingsById) : [];
  if (seeds.length === 0 && attempt === 1) {
    // Retry once — Claude occasionally returns malformed JSON on first
    // shot. Build prompt says: invalid responses get one retry; on
    // second failure, the label is dropped (here: the Seed is dropped).
    return clusterOneEarth(earth, 2);
  }
  if (seeds.length > MAX_SEEDS_PER_EARTH) seeds = seeds.slice(0, MAX_SEEDS_PER_EARTH);
  if (seeds.length < MIN_SEEDS_PER_EARTH) return null;
  return {
    earthId: "earth_" + earth.earthKey.replace(/[^a-z0-9]+/g, "_"),
    earthName: earth.earthName,
    lastTouched: earth.lastTouched,
    seeds,
  };
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
  const minWritings = Number.isFinite(Number(body.minWritingsPerEarth))
    ? Math.max(1, Number(body.minWritingsPerEarth))
    : MIN_WRITINGS_PER_EARTH_DEFAULT;

  try {
    const earths = groupByEarth(writings)
      .filter((e) => e.writings.length >= minWritings)
      .sort((a, b) => (b.lastTouched || 0) - (a.lastTouched || 0));

    // Cluster each Earth independently (parallel). One failure
    // shouldn't take the rest down with it — just drop that Earth.
    const clusters = await Promise.all(
      earths.map((e) => clusterOneEarth(e).catch(() => null)),
    );
    const result = clusters
      .filter((c) => c && c.seeds.length >= MIN_SEEDS_PER_EARTH)
      .slice(0, MAX_EARTHS)
      .map((c) => {
        const { lastTouched, ...rest } = c;
        return rest;
      });
    res.status(200).json({ earths: result });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
  }
});
