/* GET|POST /api/voice/model
 *
 * Authorization: Bearer <stytch session_token>
 * Reply:
 *   {
 *     trained: boolean,            // is there a usable voice profile?
 *     reason?: string,             // when trained=false, why not (e.g. not enough writing yet)
 *     fresh?: boolean,             // true when the cache matched the current corpus (no recompute)
 *     essayCount: number,          // how many essays the model was built from
 *     wordCount: number,           // total words of the corpus
 *     trainedAt?: number,          // ms epoch of the last (re)train
 *     profile?: VoiceProfile       // the analysed writing voice (see parseVoiceProfile)
 *   }
 *
 * The "personal voice model" for the writing flow. This is NOT audio — it
 * is a structured analysis of *how the founder writes*: tone, cadence,
 * vocabulary, sentence rhythm, the moves they reach for and the ones they
 * avoid. It is derived from the founder's own published essays (the
 * `essays` blob in TinkerUserData, written by the renderer's sync layer)
 * and recomputed as that corpus grows — so it "trains" incrementally on
 * the writing the founder is actually doing.
 *
 * The renderer (src/renderer/voice-model.js) fetches this profile and
 * folds it into the interview prompts in src/renderer/writing.js, so the
 * questions tinker asks come out in the founder's own written voice. It
 * only shapes how questions are *phrased* — the founder-only stitching
 * guarantee in writing.js is untouched.
 *
 * Caching / "training":
 *   - We compute a cheap signature over the corpus (count + length + hash).
 *   - The trained profile is cached in TinkerUserData (userId,
 *     "voice-model") alongside that signature.
 *   - GET returns the cached profile when the signature still matches the
 *     current corpus (fresh=true); otherwise it retrains. POST always
 *     retrains. A retrain is one Anthropic call, mirroring the search /
 *     converse proxies — same Stytch gate, same server-side key.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

const VOICE_KIND = "voice-model";
const ESSAYS_KIND = "essays";
const MODEL = "claude-opus-4-8";

// Don't try to model a voice from a sentence or two — the profile would be
// noise. Wait until the founder has put down a paragraph or so across their
// essays before training.
const MIN_WORDS = 120;
// Cap the corpus we send to the analyser so a prolific founder doesn't blow
// the context budget. Most-recent-first; the newest writing is the truest
// reflection of where their voice is now.
const MAX_CORPUS_CHARS = 24000;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

// Pull readable prose out of one essay record. Essays are
// { title, body, kind, archived, ... } as written by renderer.js' store.
function essayText(e) {
  if (!e || typeof e !== "object") return "";
  const parts = [];
  if (typeof e.title === "string" && e.title.trim()) parts.push(e.title.trim());
  if (typeof e.body === "string" && e.body.trim()) parts.push(e.body.trim());
  return parts.join("\n").trim();
}

// Turn the essays blob into an ordered list of prose pieces (newest first),
// dropping archived essays and anything empty.
function buildCorpus(essays) {
  const list = Array.isArray(essays) ? essays : [];
  return list
    .filter((e) => e && !e.archived)
    .map(essayText)
    .filter(Boolean);
}

// Order-sensitive but stable signature: essay count, total length, and a
// djb2 hash of the concatenation. Two corpora with the same signature are
// treated as identical, so a cache hit skips the Anthropic call.
function corpusSignature(pieces) {
  const joined = (pieces || []).join("");
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0;
  }
  return `${(pieces || []).length}:${joined.length}:${h.toString(36)}`;
}

function corpusWordCount(pieces) {
  return (pieces || []).join(" ").split(/\s+/).filter(Boolean).length;
}

// Clamp the corpus to MAX_CORPUS_CHARS, keeping the newest pieces whole
// rather than truncating mid-essay.
function clampCorpus(pieces) {
  const kept = [];
  let total = 0;
  for (const piece of pieces) {
    if (total + piece.length > MAX_CORPUS_CHARS && kept.length > 0) break;
    kept.push(piece);
    total += piece.length + 2;
  }
  return kept;
}

const ANALYST_SYSTEM = [
  "You are a writing-voice analyst. You read a single author's prose and describe HOW they write — never what they should write, never a critique, never a rewrite.",
  "",
  "This is textual voice, not audio: tone, diction, cadence, sentence rhythm, punctuation habits, the rhetorical moves the author reaches for, and the ones they conspicuously avoid.",
  "",
  "Ground every observation in evidence you can actually see in the text. For vocabulary, lift words and short phrases the author genuinely uses — do not invent fancier ones. Do not flatter, do not translate the author 'upward' into more polished or more corporate language. Capture them as they are.",
  "",
  "Your output feeds an interview tool that will ask this author questions. The 'interviewerStyle' field must be concrete, imperative guidance for phrasing questions so they sound like they come from inside this author's own head — matching their cadence and word choice — without ever putting words in their mouth or leading them to an answer.",
  "",
  "The 'excerpts' field must be 2-4 short, characteristic sentences copied VERBATIM from the author's text — pick the lines that most show their cadence and voice. Do not paraphrase, trim, or clean them up; the interview tool shows these as live examples of how the author writes, so they must be the author's exact words.",
  "",
  "Respond as a single JSON object with exactly these keys, no code fences, no prose outside the JSON:",
  "{",
  '  "voiceCard": string,        // 1-3 sentences: how this person writes, in plain language',
  '  "tone": string,             // the prevailing tone (e.g. "dry and understated", "warm and discursive")',
  '  "cadence": string,          // sentence length and rhythm (e.g. "short declaratives, then one long run-on")',
  '  "vocabulary": string[],     // 5-12 characteristic words/short phrases lifted from THEIR text',
  '  "sentenceRhythm": string,   // how sentences and paragraphs are built and broken',
  '  "signatureMoves": string[], // 3-6 recurring rhetorical habits you can see in the text',
  '  "avoids": string[],         // 2-5 things this author does NOT do (e.g. "exclamation marks", "jargon")',
  '  "excerpts": string[],       // 2-4 short sentences copied VERBATIM from THEIR text, most characteristic of their voice',
  '  "interviewerStyle": string  // imperative guidance: how to phrase interview questions in this voice',
  "}",
].join("\n");

function buildAnalysisMessage(pieces) {
  const lines = [
    "Below are essays written by a single author, newest first, separated by ---. Analyse the author's writing voice and return the JSON object.",
    "",
  ];
  pieces.forEach((p, i) => {
    if (i > 0) lines.push("", "---", "");
    lines.push(p);
  });
  return lines.join("\n");
}

function clampStr(v, max) {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function clampStrArray(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    const s = clampStr(item, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

// Parse + clamp the model's JSON into a known-shape profile. Tolerates code
// fences and missing keys; returns null only when there's no usable object.
function parseVoiceProfile(text) {
  const trimmed = (text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  let obj;
  try {
    obj = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const profile = {
    voiceCard: clampStr(obj.voiceCard, 600),
    tone: clampStr(obj.tone, 200),
    cadence: clampStr(obj.cadence, 200),
    vocabulary: clampStrArray(obj.vocabulary, 12, 60),
    sentenceRhythm: clampStr(obj.sentenceRhythm, 300),
    signatureMoves: clampStrArray(obj.signatureMoves, 6, 200),
    avoids: clampStrArray(obj.avoids, 5, 120),
    excerpts: clampStrArray(obj.excerpts, 4, 240),
    interviewerStyle: clampStr(obj.interviewerStyle, 800),
  };
  // A profile is only useful if it carries at least a voice card or some
  // interviewer guidance. Everything-empty means the parse degenerated.
  if (!profile.voiceCard && !profile.interviewerStyle) return null;
  return profile;
}

async function callAnthropic({ system, message }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), { status: 503 });
  }
  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: message }],
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
  return { text: textBlock ? textBlock.text : "", usage: data.usage };
}

// Train a voice profile from a user's raw `essays` blob and return the data
// object to cache under (userId, "voice-model") — identical in shape to what
// the route persists. Builds the corpus exactly as the route does (newest
// first, clamped to the context budget) so the signature it stores is the
// same one a later GET computes, and the cache reads back as fresh.
//
// Shared with the one-time backfill (scripts/retrain-voice-models.js) so a
// model upgrade can be rolled across every founder's corpus the same way the
// live route trains. Returns { trained: false, reason } when there isn't
// enough writing or the analyser gives back nothing usable.
async function trainFromEssays(essays) {
  const pieces = clampCorpus(buildCorpus(essays));
  const wordCount = corpusWordCount(pieces);
  const essayCount = pieces.length;

  if (wordCount < MIN_WORDS) {
    return { trained: false, reason: "not_enough_writing", essayCount, wordCount };
  }

  const result = await callAnthropic({
    system: ANALYST_SYSTEM,
    message: buildAnalysisMessage(pieces),
  });
  const profile = parseVoiceProfile(result.text);
  if (!profile) {
    return { trained: false, reason: "no_usable_profile", essayCount, wordCount };
  }

  const signature = corpusSignature(pieces);
  return {
    trained: true,
    essayCount,
    wordCount,
    data: { signature, essayCount, wordCount, trainedAt: Date.now(), profile, model: MODEL },
  };
}

async function resolveUserId(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  const session = await authenticateSession(token);
  const userId =
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    "";
  if (!userId) {
    throw Object.assign(new Error("Session missing user id"), { status: 401 });
  }
  return userId;
}

async function readEssays(userId) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: ESSAYS_KIND } },
  });
  return row && Array.isArray(row.data) ? row.data : [];
}

async function readCachedModel(userId) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: VOICE_KIND } },
  });
  return row && row.data && typeof row.data === "object" ? row.data : null;
}

async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  let essays;
  try {
    essays = await readEssays(userId);
  } catch (err) {
    res.status(500).json({ error: err.message || "Could not read essays" });
    return;
  }

  const pieces = clampCorpus(buildCorpus(essays));
  const signature = corpusSignature(pieces);
  const wordCount = corpusWordCount(pieces);
  const essayCount = pieces.length;

  // Not enough writing to model a voice yet. Report it plainly — the
  // renderer just runs the default interview until there's a corpus.
  if (wordCount < MIN_WORDS) {
    res.status(200).json({
      trained: false,
      reason: "not_enough_writing",
      essayCount,
      wordCount,
    });
    return;
  }

  const forceRetrain = req.method === "POST";
  let cached = null;
  try {
    cached = await readCachedModel(userId);
  } catch {
    cached = null;
  }

  // Cache hit: the corpus hasn't changed since the last train. Return the
  // stored profile without spending an Anthropic call.
  if (!forceRetrain && cached && cached.signature === signature && cached.profile) {
    res.status(200).json({
      trained: true,
      fresh: true,
      essayCount: cached.essayCount || essayCount,
      wordCount: cached.wordCount || wordCount,
      trainedAt: cached.trainedAt,
      profile: cached.profile,
    });
    return;
  }

  // Train (or retrain): analyse the corpus into a fresh voice profile.
  let profile;
  try {
    const result = await callAnthropic({
      system: ANALYST_SYSTEM,
      message: buildAnalysisMessage(pieces),
    });
    profile = parseVoiceProfile(result.text);
  } catch (err) {
    // If the analyser is unreachable but we have a prior profile, serve the
    // stale one rather than nothing — the founder keeps their voice.
    if (cached && cached.profile) {
      res.status(200).json({
        trained: true,
        fresh: false,
        stale: true,
        essayCount: cached.essayCount || essayCount,
        wordCount: cached.wordCount || wordCount,
        trainedAt: cached.trainedAt,
        profile: cached.profile,
      });
      return;
    }
    res.status(err.status || 502).json({ error: err.message || "Voice analysis failed" });
    return;
  }

  if (!profile) {
    if (cached && cached.profile) {
      res.status(200).json({
        trained: true,
        fresh: false,
        stale: true,
        essayCount: cached.essayCount || essayCount,
        wordCount: cached.wordCount || wordCount,
        trainedAt: cached.trainedAt,
        profile: cached.profile,
      });
      return;
    }
    res.status(502).json({ error: "Voice analysis returned no usable profile" });
    return;
  }

  const trainedAt = Date.now();
  // Stamp the analyser model so a one-time upgrade backfill
  // (scripts/retrain-voice-models.js) can tell which profiles predate it.
  const data = { signature, essayCount, wordCount, trainedAt, profile, model: MODEL };
  try {
    await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: VOICE_KIND } },
      create: { userId, kind: VOICE_KIND, data },
      update: { data },
    });
  } catch {
    // Persisting the cache is best-effort; still return the freshly trained
    // profile so the writing flow can use it this session.
  }

  res.status(200).json({
    trained: true,
    fresh: false,
    essayCount,
    wordCount,
    trainedAt,
    profile,
  });
}

module.exports = withResponseLogging(handler);
// Exported for unit tests that don't want the logging wrapper.
module.exports._raw = handler;
// Shared with scripts/retrain-voice-models.js (the one-time model-upgrade
// backfill) so it trains against the same model, corpus, and signature as the
// live route — single source of truth for "how a voice is modelled."
module.exports.MODEL = MODEL;
module.exports.VOICE_KIND = VOICE_KIND;
module.exports.ESSAYS_KIND = ESSAYS_KIND;
module.exports.trainFromEssays = trainFromEssays;
module.exports.__test__ = {
  MIN_WORDS,
  MAX_CORPUS_CHARS,
  MODEL,
  ANALYST_SYSTEM,
  essayText,
  buildCorpus,
  corpusSignature,
  corpusWordCount,
  clampCorpus,
  buildAnalysisMessage,
  parseVoiceProfile,
  trainFromEssays,
};
