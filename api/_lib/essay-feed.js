/* Pure helpers for the private mobile essay feed.
 *
 * Reads essays from the existing TinkerUserData "essays" blob (same DAL
 * surface as /api/user-data/essays and voice/model). Does not change the
 * essay data model. Stars live in a separate kind; audio cache is a
 * dedicated table keyed by (userId, essayId, voiceId).
 */

"use strict";

const STARS_KIND = "essay-feed-stars";
const ESSAYS_KIND = "essays";

function elevenLabsApiKey() {
  const key = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY || "";
  return typeof key === "string" ? key.trim() : "";
}

function elevenLabsVoiceId() {
  const id = process.env.ELEVENLABS_VOICE_ID || "";
  return typeof id === "string" ? id.trim() : "";
}

/** Play is available only when both key and voice id are configured. */
function audioFeatureEnabled() {
  return Boolean(elevenLabsApiKey() && elevenLabsVoiceId());
}

/**
 * Pull readable prose out of an essay/draft body.
 * Handles the known bug where a body object was stringified as
 * "[object Object]" — try to recover text from common shapes, else "".
 * Never returns the literal "[object Object]".
 */
function extractBodyText(essay) {
  if (!essay || typeof essay !== "object") return "";

  let body = essay.body;
  if (body == null && essay.stitched && typeof essay.stitched === "object") {
    body = essay.stitched.body;
  }

  if (body != null && typeof body === "object") {
    return extractFromObject(body);
  }

  const s = String(body == null ? "" : body).trim();
  if (!s || s === "[object Object]") {
    // Last chance: some integrations stuffed the real text elsewhere.
    if (essay.stitched && typeof essay.stitched.body === "string") {
      const stitched = essay.stitched.body.trim();
      if (stitched && stitched !== "[object Object]") return stitched;
    }
    if (typeof essay.text === "string" && essay.text.trim() && essay.text.trim() !== "[object Object]") {
      return essay.text.trim();
    }
    if (typeof essay.content === "string" && essay.content.trim() && essay.content.trim() !== "[object Object]") {
      return essay.content.trim();
    }
    return "";
  }
  return s;
}

function extractFromObject(body) {
  if (Array.isArray(body)) {
    return body
      .map((part) => {
        if (typeof part === "string") return part.trim();
        if (part && typeof part === "object") {
          if (typeof part.text === "string") return part.text.trim();
          if (typeof part.body === "string") return part.body.trim();
          if (typeof part.content === "string") return part.content.trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof body.text === "string" && body.text.trim()) return body.text.trim();
  if (typeof body.body === "string" && body.body.trim()) return body.body.trim();
  if (typeof body.content === "string" && body.content.trim()) return body.content.trim();
  if (typeof body.markdown === "string" && body.markdown.trim()) return body.markdown.trim();
  if (typeof body.value === "string" && body.value.trim()) return body.value.trim();
  return "";
}

function isEmptyDraft(essay) {
  if (!essay || typeof essay !== "object") return true;
  // Draft-shaped records without publishable prose.
  const body = extractBodyText(essay);
  if (!body) return true;
  if (essay.kind === "draft" && !body) return true;
  // Explicit empty draft markers used by the writing flow.
  if (essay.stitched && typeof essay.stitched === "object") {
    const stitchedBody = extractFromObject(
      typeof essay.stitched.body === "object" && essay.stitched.body
        ? essay.stitched.body
        : { body: essay.stitched.body },
    );
    if (!String(essay.body || "").trim() && !stitchedBody && !String(essay._scratch || "").trim()) {
      return true;
    }
  }
  return false;
}

function isTestEssay(essay) {
  if (!essay || typeof essay !== "object") return true;
  if (essay.test === true || essay.isTest === true) return true;
  if (String(essay.kind || "").toLowerCase() === "test") return true;
  const title = String(essay.title == null ? "" : essay.title).trim();
  const body = extractBodyText(essay);
  if (/^test$/i.test(title)) return true;
  if (/\[test\]/i.test(title)) return true;
  if (/^test\s+essay\b/i.test(title)) return true;
  if (/^lorem ipsum/i.test(body)) return true;
  // Tiny fixture bodies that are clearly not real writing.
  if (/^test([\s._-]|$)/i.test(title) && body.length > 0 && body.length < 40) return true;
  return false;
}

/**
 * Deterministic "strongest line" picker.
 * Manual override hook: essay.feedHeadline (string) wins when set —
 * structure leaves room for a later per-essay override UI/field.
 */
function pickHeadline(essay) {
  if (essay && typeof essay.feedHeadline === "string" && essay.feedHeadline.trim()) {
    return {
      headline: essay.feedHeadline.trim(),
      source: "override",
    };
  }

  const body = extractBodyText(essay);
  const title = essay && typeof essay.title === "string" ? essay.title.trim() : "";
  const candidates = [];

  if (title && !/^untitled\b/i.test(title) && title.length >= 8) {
    candidates.push({ text: title, fromTitle: true });
  }

  const chunks = body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    // Prefer a complete-feeling line, not a fragment.
    if (chunk.length < 16 || chunk.length > 180) continue;
    if (chunk === "[object Object]") continue;
    candidates.push({ text: chunk, fromTitle: false });
  }

  if (!candidates.length) {
    const fallback = title || (chunks[0] || "").slice(0, 120) || "Untitled";
    return { headline: fallback, source: "heuristic" };
  }

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    const score = scoreLine(c.text, c.fromTitle);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return { headline: best.text, source: "heuristic" };
}

function scoreLine(text, fromTitle) {
  let score = 0;
  const len = text.length;
  // Sweet spot for a mobile headline.
  if (len >= 28 && len <= 110) score += 40;
  else if (len >= 16 && len <= 140) score += 20;
  else score += 5;

  if (/[.!?]$/.test(text)) score += 12;
  if (fromTitle) score += 8;
  // Prefer lines that aren't list/meta noise.
  if (/^(chapter|part|section|todo|note)\b/i.test(text)) score -= 20;
  if (/^(and|but|so|then|also)\b/i.test(text)) score -= 6;
  // Mild boost for concrete / first-person presence (Tyler's voice).
  if (/\b(I|I'm|I've|my|we|our)\b/.test(text)) score += 6;
  // Prefer fewer commas (punchier).
  const commas = (text.match(/,/g) || []).length;
  if (commas === 0) score += 4;
  else if (commas > 3) score -= 4;
  return score;
}

/**
 * Filter + present essays for the feed.
 * Ordering: newest first (matches essays blob / self-reflections).
 */
function buildFeedItems(essays, { starredIds } = {}) {
  const starSet = new Set(Array.isArray(starredIds) ? starredIds.map(String) : []);
  const list = Array.isArray(essays) ? essays : [];
  const items = [];

  for (const essay of list) {
    if (!essay || !essay.id) continue;
    if (essay.archived) continue;
    if (isTestEssay(essay)) continue;
    if (isEmptyDraft(essay)) continue;
    const body = extractBodyText(essay);
    if (!body || body === "[object Object]") continue;

    const { headline, source } = pickHeadline(essay);
    if (!headline || headline === "[object Object]") continue;

    const createdAt = Number(essay.createdAt) || Date.parse(essay.createdAt) || 0;
    const updatedAt = Number(essay.updatedAt) || Date.parse(essay.updatedAt) || createdAt;

    items.push({
      id: String(essay.id),
      headline,
      headlineSource: source,
      // Future override field — null until set on the essay record.
      feedHeadline: typeof essay.feedHeadline === "string" ? essay.feedHeadline : null,
      body,
      title: typeof essay.title === "string" ? essay.title : "",
      createdAt,
      updatedAt,
      starred: starSet.has(String(essay.id)),
      kind: essay.kind || "essay",
    });
  }

  items.sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return String(b.id).localeCompare(String(a.id));
  });

  return items;
}

function normalizeStarIds(data) {
  if (!data || typeof data !== "object") return [];
  const ids = Array.isArray(data.essayIds) ? data.essayIds : [];
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const s = String(id || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function toggleStar(essayIds, essayId, starred) {
  const id = String(essayId || "").trim();
  if (!id) return normalizeStarIds({ essayIds });
  const set = new Set(normalizeStarIds({ essayIds }));
  if (starred) set.add(id);
  else set.delete(id);
  return Array.from(set);
}

function audioCacheKey(essayId, voiceId) {
  return `${String(essayId || "").trim()}::${String(voiceId || "").trim()}`;
}

/**
 * Cache-on-first-play: return cached audio when present for this
 * essayId+voiceId; otherwise call generateFn once and store the result.
 * generateFn is injected so tests can mock ElevenLabs.
 */
async function getOrCreateAudio({
  essayId,
  voiceId,
  readCache,
  writeCache,
  generateFn,
  text,
}) {
  const eid = String(essayId || "").trim();
  const vid = String(voiceId || "").trim();
  if (!eid || !vid) {
    throw Object.assign(new Error("essayId and voiceId are required"), { status: 400 });
  }
  if (!audioFeatureEnabled()) {
    throw Object.assign(new Error("Voice playback is not configured"), { status: 503 });
  }

  const existing = await readCache(eid, vid);
  if (existing && existing.audioBase64) {
    return {
      cached: true,
      contentType: existing.contentType || "audio/mpeg",
      audioBase64: existing.audioBase64,
      voiceId: vid,
      essayId: eid,
    };
  }

  const prose = String(text || "").trim();
  if (!prose || prose === "[object Object]") {
    throw Object.assign(new Error("Essay has no readable text"), { status: 400 });
  }

  const generated = await generateFn({ text: prose, voiceId: vid });
  const audioBase64 = generated.audioBase64;
  const contentType = generated.contentType || "audio/mpeg";
  if (!audioBase64) {
    throw Object.assign(new Error("Voice generation returned empty audio"), { status: 502 });
  }

  await writeCache({
    essayId: eid,
    voiceId: vid,
    audioBase64,
    contentType,
  });

  return {
    cached: false,
    contentType,
    audioBase64,
    voiceId: vid,
    essayId: eid,
  };
}

async function callElevenLabsTts({ text, voiceId, apiKey, fetchFn }) {
  const key = apiKey || elevenLabsApiKey();
  const vid = voiceId || elevenLabsVoiceId();
  const doFetch = fetchFn || fetch;
  if (!key || !vid) {
    throw Object.assign(new Error("Voice playback is not configured"), { status: 503 });
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`;
  const res = await doFetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: String(text).slice(0, 5000),
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
    }),
  });

  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { /* ignore */ }
    throw Object.assign(
      new Error(`ElevenLabs error ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`),
      { status: 502 },
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    audioBase64: buf.toString("base64"),
    contentType: res.headers.get("content-type") || "audio/mpeg",
  };
}

module.exports = {
  STARS_KIND,
  ESSAYS_KIND,
  elevenLabsApiKey,
  elevenLabsVoiceId,
  audioFeatureEnabled,
  extractBodyText,
  isEmptyDraft,
  isTestEssay,
  pickHeadline,
  buildFeedItems,
  normalizeStarIds,
  toggleStar,
  audioCacheKey,
  getOrCreateAudio,
  callElevenLabsTts,
};
