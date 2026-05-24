/* POST /api/feed/adjacent
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { pitchText: string, pitchTitle?: string }
 * Reply:
 *   {
 *     coldStart: boolean,
 *     results: [
 *       {
 *         userId: string,
 *         pitchTitle: string,
 *         pitchSlug: string,
 *         oneLineSummary: string,    // verbatim line lifted from the founder's pitch
 *         viewUrl: string,           // absolute URL to the daily-beginner reader
 *       },
 *       ...
 *     ]
 *   }
 *
 * The adjacency engine for the "founders" surface. The client passes
 * the founder's current pitch text (stitched from their active pitch's
 * deck phrases). The server:
 *
 *   1. Queries every opted-in user (kind="discoverable" with a non-null
 *      timestamp) except the requester.
 *   2. For each, reads their most-recently-updated published pitch row
 *      (kind="published:<slug>"). Users opted in but with no published
 *      pitch are silently dropped — the v1 list-only surface needs a
 *      title and a one-line summary to render a card, both of which
 *      come from the published pitch.
 *   3. If fewer than 3 candidates exist, returns coldStart:true with
 *      whatever it has (including an empty list).
 *   4. Otherwise asks Claude to pick the 3–7 candidates whose pitches
 *      sit most adjacent to the requester's, and to lift one verbatim
 *      sentence from each chosen pitch as the card's one-line summary.
 *
 * Adjacency is the only sort. No engagement signal, no recency boost.
 * Every visible string the client renders for a card comes back from
 * this endpoint — title and slug from the published row, summary
 * verbatim from the candidate's own pitch markdown.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

const MODEL = "claude-haiku-4-5-20251001";
const MIN_CANDIDATES_FOR_RANK = 3;
const MAX_RESULTS = 7;
const MAX_PITCH_CHARS = 6000;
const MAX_BYTES = 32 * 1024;
const DISCOVERABLE_KIND = "discoverable";

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function readJsonBody(req) {
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

// Mirror of api/publish/pitch.js readerHost — preview tinker should
// point at the matching beginner preview. Documented in that file.
function readerHost() {
  if (process.env.VERCEL_ENV === "preview") {
    const branchUrl = process.env.VERCEL_BRANCH_URL || "";
    if (branchUrl.startsWith("tinker-git-")) {
      return `https://beginner-git-${branchUrl.slice("tinker-git-".length)}`;
    }
  }
  return "https://beginner.work";
}

function viewUrlFor(userId, slug) {
  return `${readerHost()}/daily/?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(slug)}`;
}

// Pull a clean, short verbatim sentence out of a candidate's pitch
// markdown so we always have a summary to show even if Claude returns
// nothing usable.
function fallbackSummary(markdown) {
  if (typeof markdown !== "string") return "";
  const cleaned = markdown
    .replace(/^---[\s\S]*?---/m, "")
    .replace(/^#+\s+.*$/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const m = cleaned.match(/[^.!?]{20,240}[.!?]/);
  const sentence = (m ? m[0] : cleaned.slice(0, 220)).trim();
  return sentence.length > 240 ? `${sentence.slice(0, 237)}…` : sentence;
}

function truncatePitch(markdown) {
  if (typeof markdown !== "string") return "";
  if (markdown.length <= MAX_PITCH_CHARS) return markdown;
  return `${markdown.slice(0, MAX_PITCH_CHARS)}\n…`;
}

async function loadCandidates(requesterUserId) {
  const optedIn = await prisma.tinkerUserData.findMany({
    where: { kind: DISCOVERABLE_KIND },
  });
  const userIds = [];
  for (const row of optedIn) {
    if (row.userId === requesterUserId) continue;
    if (!row.data || typeof row.data !== "object") continue;
    if (!row.data.discoverableAt) continue;
    userIds.push(row.userId);
  }
  if (!userIds.length) return [];

  const publishedRows = await prisma.tinkerUserData.findMany({
    where: {
      userId: { in: userIds },
      kind: { startsWith: "published:" },
    },
    orderBy: { updatedAt: "desc" },
  });

  const byUser = new Map();
  for (const row of publishedRows) {
    if (byUser.has(row.userId)) continue;
    const d = row.data || {};
    if (typeof d.markdown !== "string" || !d.markdown.trim()) continue;
    const title = typeof d.title === "string" && d.title.trim() ? d.title.trim() : "Untitled";
    const slug = typeof d.slug === "string" && d.slug.trim() ? d.slug.trim() : row.kind.slice("published:".length);
    byUser.set(row.userId, { userId: row.userId, title, slug, markdown: d.markdown });
  }
  return Array.from(byUser.values());
}

function buildSystemPrompt() {
  return [
    "You are the adjacency engine for a private founder-to-founder discovery surface. You receive one founder's pitch (the requester) and a list of other founders' pitches (the candidates). Your job is to return the candidates whose pitches sit closest to the requester's — adjacent enough that the requester would genuinely benefit from reading them.",
    "",
    "Rules:",
    "- Adjacency is similarity of substance, beat, audience, or problem. Not surface keywords. Two founders who both wrote about 'AI' are not adjacent unless their actual concerns overlap.",
    "- Return between 0 and 7 candidates. Prefer 3–7. If fewer than 3 candidates are genuinely adjacent, return only those that are. Do NOT pad with weak matches.",
    "- For every chosen candidate, copy ONE short sentence (20–240 chars) directly from that candidate's pitch markdown to use as the card's one-line summary. The sentence must appear VERBATIM in the candidate's pitch text — do not paraphrase, do not summarise, do not invent.",
    "- Never rank by engagement, recency, length, or popularity. The only signal you have is the pitch text.",
    "",
    "Respond as a single JSON object with exactly this shape:",
    '  { "results": [ { "userId": "<candidate userId>", "oneLineSummary": "<verbatim sentence from that candidate\'s pitch>" }, ... ] }',
    "",
    "Order results from most adjacent to least adjacent. Return an empty results array if nothing qualifies. Never wrap the JSON in code fences. Never add explanation outside the JSON.",
  ].join("\n");
}

function buildUserMessage(requesterPitch, candidates) {
  const lines = [];
  lines.push("REQUESTER PITCH:");
  lines.push("---");
  lines.push(requesterPitch);
  lines.push("---");
  lines.push("");
  lines.push(`CANDIDATE PITCHES (${candidates.length}):`);
  for (const c of candidates) {
    lines.push("");
    lines.push(`>>> userId: ${c.userId}`);
    lines.push(`>>> title: ${c.title}`);
    lines.push("---");
    lines.push(truncatePitch(c.markdown));
    lines.push("---");
  }
  return lines.join("\n");
}

function parseJson(text) {
  const trimmed = (text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try { return JSON.parse(stripped); }
  catch { return null; }
}

async function callClaude({ system, userMessage }) {
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
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
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
  const block = (data.content || []).find((b) => b.type === "text");
  return block ? block.text : "";
}

// Find the model's chosen sentence inside the candidate's markdown so
// we don't hand back fabricated copy. Exact indexOf first; whitespace-
// normalised fallback for stray smart-quotes or collapsed newlines.
function verbatimIn(markdown, sentence) {
  if (typeof markdown !== "string" || typeof sentence !== "string") return null;
  const trimmed = sentence.trim();
  if (!trimmed) return null;
  if (markdown.includes(trimmed)) return trimmed;
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const haystack = norm(markdown);
  const needle = norm(trimmed);
  if (haystack.includes(needle)) return needle;
  return null;
}

async function rank(requesterPitch, candidates) {
  if (!candidates.length) return [];
  const system = buildSystemPrompt();
  const userMessage = buildUserMessage(requesterPitch, candidates);
  let text;
  try { text = await callClaude({ system, userMessage }); }
  catch { return null; }
  const parsed = parseJson(text);
  if (!parsed || !Array.isArray(parsed.results)) return null;

  const byUser = new Map(candidates.map((c) => [c.userId, c]));
  const out = [];
  for (const item of parsed.results) {
    if (!item || typeof item !== "object") continue;
    const candidate = byUser.get(item.userId);
    if (!candidate) continue;
    const verbatim = verbatimIn(candidate.markdown, item.oneLineSummary);
    const summary = verbatim || fallbackSummary(candidate.markdown);
    if (!summary) continue;
    out.push({
      userId: candidate.userId,
      pitchTitle: candidate.title,
      pitchSlug: candidate.slug,
      oneLineSummary: summary,
      viewUrl: viewUrlFor(candidate.userId, candidate.slug),
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    const token = extractBearer(req.headers && req.headers.authorization);
    const session = await authenticateSession(token);
    userId =
      (session && session.session && session.session.user_id) ||
      (session && session.user && session.user.user_id) ||
      "";
    if (!userId) {
      throw Object.assign(new Error("Session missing user id"), { status: 401 });
    }
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Bad request" });
    return;
  }
  const pitchText = typeof body.pitchText === "string" ? body.pitchText.trim() : "";
  if (!pitchText) {
    res.status(400).json({ error: "pitchText is required" });
    return;
  }

  let candidates;
  try { candidates = await loadCandidates(userId); }
  catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
    return;
  }

  if (candidates.length < MIN_CANDIDATES_FOR_RANK) {
    res.status(200).json({ coldStart: true, results: [] });
    return;
  }

  const ranked = await rank(truncatePitch(pitchText), candidates);
  if (ranked === null) {
    res.status(502).json({ error: "Adjacency engine unavailable" });
    return;
  }

  res.status(200).json({ coldStart: false, results: ranked });
}

module.exports = withResponseLogging(handler);
module.exports._raw = handler;
module.exports._test = {
  fallbackSummary,
  verbatimIn,
  truncatePitch,
  buildSystemPrompt,
  buildUserMessage,
  viewUrlFor,
};
