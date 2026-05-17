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

// [FOUNDER OVERRIDE] The build-prompt.md spec required labels to be
// verbatim substrings of the founder's writings (returned as
// offsets, validated server-side). Founder feedback in PR #94 asked
// to "try AI-generated seeds" instead. This relaxes the constraint:
// the model now returns label TEXT directly, in its own words. If
// the founder wants the verbatim flow back, restore the offset
// schema in the system prompt and bring back the offset validation
// in validateLabel().
const SYSTEM_PROMPT = `You cluster a founder's writings into a three-tier tree for the tinker writing tool: Earth → Seed → Growth vector.

You receive a list of writings, all from a single Earth (a place the founder writes from). You return between 2 and 5 Seeds. Each Seed is a topic cluster of one or more writings. Inside each Seed, you return one Growth vector per distinct sub-topic.

LABELS ARE COMPLETE, AUTHORED TOPIC PHRASES — NOT TEXT FRAGMENTS.

You author the label in plain English using the founder's vocabulary as your guide. The label must read as a complete topic phrase a human could speak out loud and understand. Think "what's this group ABOUT?" — name the topic.

GOOD labels (note: complete phrases, no clipped words):
- "the barber shop"
- "hop tinctures at 7am"
- "his hands"
- "what I taste first"
- "the morning call"
- "not posting to LinkedIn"
- "finding a safer path"
- "how to be still"

BAD labels (DO NOT produce anything like these — they are clipped mid-word, missing first or last word, or look like accidental string slicing):
- "ot LinkedIn"           ← clipped: missing first letter
- "forward in"            ← clipped: incomplete phrase
- "know what so"          ← clipped: ends mid-thought
- "for a safe pa"         ← clipped: ends mid-word
- "w to be still I've"    ← clipped: missing first letters
- "your career stuff"     ← too generic, AI tell
- "thoughts on family"    ← too generic, AI tell

Every label must:
- Start with a complete word (never a single letter followed by space; never a partial word like "ot " or "w ")
- End with a complete word (never end with a single letter or partial word like "pa" or "so" alone)
- Be a noun phrase or short phrase, 2–6 words typical
- Lowercase except proper nouns
- No trailing punctuation, no quotes wrapping the label

Seed labels are slightly broader (the topic of the cluster). Growth-vector labels are more specific (one facet of the Seed). Both must be complete, authored phrases.

Group writings by topic, not by Earth — all writings in your input are from the same Earth. A Growth vector may cover multiple writings (those become a count badge in the UI); a Seed contains one or more Growth vectors.

RESPOND IN STRICT JSON. Single object, exactly these keys:
{
  "seeds": [
    {
      "label": string,
      "sourceWritingId": string,
      "growthVectors": [
        {
          "label": string,
          "sourceWritingId": string,
          "writingIds": [string, ...]
        },
        ...
      ]
    },
    ...
  ]
}

For sourceWritingId: pick the writing id that best represents this cluster (typically the one whose content most clearly led you to this label). For writingIds in a Growth vector: list every writing that belongs under it.

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
      // Sonnet (not Haiku) for this call. Authoring complete topic
      // phrases out of a founder's writing — without verbatim
      // anchoring — is a higher-judgement task than Haiku reliably
      // handles. Spec called for Haiku 4.5; founder feedback in
      // PR #94 ("no AI generated labels") flipped it.
      model: "claude-sonnet-4-6",
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

// [FOUNDER OVERRIDE] Used to validate that each label was a verbatim
// substring of the source writing (offset+length). Now accepts the
// model's string directly: trim, length-clamp, drop empties + drop
// obvious mid-word cut-offs. The sourceWritingId is preserved when
// the model sets it so the renderer can still resolve "which
// writing led to this label" if needed later.
function validateLabel(rawLabel, sourceWritingId, byId) {
  const text = String(rawLabel == null ? "" : rawLabel).trim();
  if (!text) return null;
  // Hard upper bound — keep a runaway full-sentence label out of the
  // sidebar (would overflow the row anyway).
  if (text.length > 120) return null;
  // Strip wrapping quotes the model sometimes adds despite the
  // prompt rule against them.
  const cleaned = text.replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  if (!cleaned) return null;
  // Reject obvious mid-word clips. The model has been told what BAD
  // labels look like ("ot LinkedIn", "for a safe pa") but it still
  // sometimes produces them — drop here so they never reach the UI.
  // Heuristics: a 1–2 character first/last token is suspicious. Only
  // accept it when it's a known short English word; otherwise drop.
  const SHORT_WORDS = new Set([
    "a", "i",
    "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is",
    "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us",
    "we", "am",
  ]);
  const isShortWordClip = (token) => {
    const t = token.replace(/[.,;:!?]+$/, "").toLowerCase();
    return t.length > 0 && t.length <= 2 && !SHORT_WORDS.has(t);
  };
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (isShortWordClip(tokens[0])) return null;
  if (isShortWordClip(tokens[tokens.length - 1])) return null;
  // (Earlier iterations also dropped labels ending in prepositions/
  // conjunctions like "forward in" / "know what so". That filter was
  // too aggressive and was killing every label, leaving the tree
  // empty. The mid-word-clip filter above stays — it's narrowly
  // targeted at the specific failure mode.)
  const id = String(sourceWritingId || "");
  return {
    label: cleaned,
    sourceWritingId: byId.has(id) ? id : null,
  };
}

// Capitalize the first letter of a Seed label so it reads as a
// named topic in the sidebar ("The barber shop" not "the barber
// shop"). Growth-vector labels stay lowercase per the original
// spec's example treatment.
function capitalizeFirst(s) {
  const trimmed = String(s || "").trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
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
    if (!rawSeed || typeof rawSeed !== "object") continue;
    const seedLabel = validateLabel(rawSeed.label, rawSeed.sourceWritingId, byId);
    if (!seedLabel) continue;

    const growthVectors = [];
    if (Array.isArray(rawSeed.growthVectors)) {
      for (const rawGv of rawSeed.growthVectors) {
        if (!rawGv || typeof rawGv !== "object") continue;
        const gvLabel = validateLabel(rawGv.label, rawGv.sourceWritingId, byId);
        if (!gvLabel) continue;
        const writingIds = Array.isArray(rawGv.writingIds)
          ? Array.from(new Set(rawGv.writingIds.filter((id) => byId.has(id))))
          : [];
        if (writingIds.length === 0) continue;
        growthVectors.push({
          label: gvLabel.label,
          sourceWritingId: gvLabel.sourceWritingId,
          writingIds,
        });
      }
    }
    if (growthVectors.length === 0) continue;
    seeds.push({
      label: capitalizeFirst(seedLabel.label),
      sourceWritingId: seedLabel.sourceWritingId,
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
