/* POST /api/pitches/interpret
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { pitchId }
 * Reply: { ok: true, interpretation, basedOnSlides, generatedAt }
 *
 * The pamphlet's "How Claude reads this pitch" card. The founder
 * doesn't want an AI-generated deck — they want to see how the AI
 * perceives the deck they assembled themselves. So this endpoint reads
 * the pitch exactly as stored (verbatim phrases + the founder's essay
 * titles + essay excerpts), asks the model to reflect back what it
 * perceives the pitch to be, and returns that read. It never rewrites,
 * scores, or advises.
 *
 * Stateless on purpose: nothing is persisted server-side. The client
 * caches the reply keyed by a hash of the pitch's resolved content, so
 * reopening the pamphlet costs nothing until the pitch itself changes.
 *
 * Anthropic key held server-side. Mirrors /api/classify.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");
const { DECK_HEADINGS, callClusterer } = require("../_lib/pitches-clusterer.js");
const {
  normalizeBlob,
  bodyForWriting,
  titleForWriting,
} = require("../_lib/pitches-organizer.js");

const KIND_ESSAYS = "essays";
const KIND_DRAFTS = "drafts";
const KIND_PITCHES = "pitches";

// Excerpt budget per slide. Eleven slides at most, so the user message
// stays comfortably bounded.
const MAX_EXCERPT_CHARS = 600;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(typeof req.body === "string" ? req.body : "{}");
  } catch {
    return null;
  }
}

// Resolve a pitch into the material the model reads: per covered
// heading (deck order) the verbatim phrase, the founder's own title for
// the backing writing, and an excerpt of its body. Uncovered headings
// are listed too — "what I can't find yet" is half the read.
function resolveSlides(blob, pitchId, essays, drafts) {
  const pitch = blob.pitches.find((p) => p.id === pitchId) || null;
  if (!pitch) return null;
  const slides = [];
  const uncovered = [];
  for (const h of DECK_HEADINGS) {
    const recs = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
    let resolved = null;
    for (const rec of recs) {
      const body = bodyForWriting(rec.writingId, essays, drafts);
      if (!body) continue;
      if (rec.offset < 0 || rec.offset + rec.length > body.length) continue;
      const phrase = String(body.slice(rec.offset, rec.offset + rec.length))
        .replace(/\s+/g, " ")
        .trim();
      if (!phrase) continue;
      const record = drafts.find((d) => d && d.id === rec.writingId)
        || essays.find((e) => e && e.id === rec.writingId)
        || null;
      const excerptSource = body.trim();
      resolved = {
        heading: h,
        phrase,
        title: titleForWriting(record),
        excerpt: excerptSource.length > MAX_EXCERPT_CHARS
          ? excerptSource.slice(0, MAX_EXCERPT_CHARS) + "…"
          : excerptSource,
      };
      break;
    }
    if (resolved) slides.push(resolved);
    else uncovered.push(h);
  }
  const title = (pitch.personalTitle || pitch.aiTitle || "").trim();
  return { title, slides, uncovered };
}

function buildInterpretPrompt() {
  return [
    "You are reading a founder's pitch deck inside tinker, their private writing tool. The deck was assembled from the founder's own essays — every quote is verbatim from their writing, slotted under one of eleven standard slide titles. The founder did the arranging; you did none of it.",
    "",
    "Your job is to reflect back how you read this pitch — what you perceive it to be — so the founder can see their own deck from the outside. You are a mirror, not an editor and not a coach.",
    "",
    "Write three short paragraphs, at most 130 words in total, addressed to the founder as \"you\":",
    "1. What you understand this pitch to be — the business or idea you perceive, in one or two plain sentences.",
    "2. The strongest thread you can see: who it's for and what holds it together. Quote their own words sparingly and only verbatim.",
    "3. What you can't find yet — which parts of the story read thin or missing, named plainly, without telling them what to write.",
    "",
    "Never rewrite or improve their words. Never invent facts that aren't in the slides. No bullet points, no headings, no scores, no advice. Plain, warm, specific.",
  ].join("\n");
}

function buildInterpretUserMessage({ title, slides, uncovered }) {
  const lines = [];
  lines.push(`Pitch title: ${title || "(untitled)"}`);
  lines.push("");
  lines.push("The slides the founder has filled:");
  lines.push("");
  for (const s of slides) {
    lines.push(`Slide: ${s.heading}`);
    if (s.title) lines.push(`Essay title: ${s.title}`);
    lines.push(`Quote on the slide: "${s.phrase}"`);
    if (s.excerpt) lines.push(`From the essay behind it: ${s.excerpt}`);
    lines.push("");
  }
  if (uncovered && uncovered.length) {
    lines.push(`Slides with nothing on them yet: ${uncovered.join(", ")}`);
  }
  return lines.join("\n");
}

async function loadKind(userId, kind) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  return row ? row.data : null;
}

const handler = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  let userId;
  try {
    const session = await authenticateSession(token);
    userId =
      (session && session.session && session.session.user_id) ||
      (session && session.user && session.user.user_id) ||
      "";
    if (!userId) throw Object.assign(new Error("Session missing user id"), { status: 401 });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const pitchId = typeof body.pitchId === "string" && body.pitchId ? body.pitchId : null;
  if (!pitchId) {
    res.status(400).json({ error: "pitchId is required" });
    return;
  }

  let essays, drafts, storedBlob;
  try {
    [essays, drafts, storedBlob] = await Promise.all([
      loadKind(userId, KIND_ESSAYS),
      loadKind(userId, KIND_DRAFTS),
      loadKind(userId, KIND_PITCHES),
    ]);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load user data" });
    return;
  }

  const safeEssays = Array.isArray(essays) ? essays : [];
  const safeDrafts = Array.isArray(drafts) ? drafts : [];
  const blob = normalizeBlob(storedBlob);

  const resolved = resolveSlides(blob, pitchId, safeEssays, safeDrafts);
  if (!resolved) {
    res.status(404).json({ error: "Unknown pitch" });
    return;
  }
  if (!resolved.slides.length) {
    res.status(400).json({ error: "Pitch has no resolved slides to read yet" });
    return;
  }

  let interpretation = "";
  try {
    interpretation = await callClusterer({
      system: buildInterpretPrompt(),
      userMessage: buildInterpretUserMessage(resolved),
      model: "claude-haiku-4-5-20251001",
      maxTokens: 400,
      temperature: 0,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
    return;
  }
  interpretation = String(interpretation || "").trim();
  if (!interpretation) {
    res.status(502).json({ error: "Empty interpretation" });
    return;
  }

  res.status(200).json({
    ok: true,
    interpretation,
    basedOnSlides: resolved.slides.length,
    generatedAt: Date.now(),
  });
});

module.exports = handler;
module.exports.__test__ = {
  extractBearer,
  resolveSlides,
  buildInterpretPrompt,
  buildInterpretUserMessage,
};
