/* GET /api/team/suggest
 *
 * Authorization: Bearer <stytch session_token>
 * Reply: {
 *   questions: [ the founder's own open questions, verbatim ],
 *   suggestions: [
 *     {
 *       userId,     // the suggested founder
 *       name,       // from their profile row ("A founder" when unnamed)
 *       phone,      // their account phone (E.164) — how you reach them
 *       question,   // MY question, verbatim — the one they might be answering
 *       reason,     // the matcher's one-line why (its own words, no quotes)
 *     }, ...
 *   ]
 * }
 *
 * "Invite others onto your team": suggests people who might be
 * answering a question the founder leaves unanswered in their essays —
 * matched on what those people are writing in THEIR essays.
 *
 * Privacy model — nothing of theirs is shown, nothing of theirs needs
 * to be public:
 *   - MY questions are extracted mechanically from my own essays:
 *     sentences that end in "?" (newest writing first, capped). No AI.
 *   - Other founders' essays stay private. They are read server-side
 *     ONLY as matching input; the response never carries a word of
 *     them. The `question` field is validated to be an exact copy of
 *     one of MY questions and `userId`/`name` identify the person —
 *     structurally, the reply cannot disclose their writing.
 *   - The AI acts as a matcher: "might this person's writing be
 *     answering this question?" It returns the pairing plus a one-line
 *     reason in ITS OWN words — instructed never to quote the
 *     candidate's writing. Their sentences are never returned.
 *   - The phone number comes from the suggested founder's Stytch
 *     account (tinker is phone-first — the phone is how founders
 *     reach each other inside the same private beta).
 */

"use strict";

const { authenticateSession, getUser } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

const MAX_QUESTIONS = 5;
const MIN_QUESTION_LEN = 12;
const MAX_CANDIDATES = 12;
const MAX_CANDIDATE_CHARS = 4000;
const MAX_SUGGESTIONS = 4;
const MAX_REASON_LEN = 240;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

// The founder's open questions, mechanically: every sentence in their
// essays that ends in a question mark, newest essay first, deduped,
// capped. Verbatim — these are their words, not a summary of them.
function extractQuestions(essays) {
  const list = Array.isArray(essays) ? essays : [];
  const sorted = list
    .filter((e) => e && typeof e.body === "string" && !e.archived)
    .slice()
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  const seen = new Set();
  const out = [];
  for (const e of sorted) {
    const sentences = String(e.body).match(/[^.!?…\n]+\?+/g) || [];
    for (const raw of sentences) {
      const q = raw.trim();
      if (q.length < MIN_QUESTION_LEN) continue;
      const key = q.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
      if (out.length >= MAX_QUESTIONS) return out;
    }
  }
  return out;
}

// A candidate's matchable text: their essay bodies, newest first,
// joined and capped. Read server-side only — never returned.
function candidateText(essaysData) {
  const list = Array.isArray(essaysData) ? essaysData : [];
  const parts = list
    .filter((e) => e && typeof e.body === "string" && e.body.trim() && !e.archived)
    .slice()
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .map((e) => e.body.trim());
  return parts.join("\n\n").slice(0, MAX_CANDIDATE_CHARS);
}

function buildSystemPrompt() {
  return [
    "You match founders. You are given MY QUESTIONS (a founder's open questions, verbatim) and CANDIDATES (other founders' writing, each with a one-letter id).",
    "",
    "Find candidates whose writing suggests they MIGHT BE ANSWERING one of my questions — their experience, work, or hard-won knowledge speaks to what I'm asking. A genuine answer, not merely the same topic.",
    "",
    "Respond as a single JSON object, exactly:",
    '  { "matches": [ { "candidate": "<letter>", "question": "<EXACT copy of one of my questions>", "reason": "<one short sentence, in your own words, on why this person might be answering it>" } ] }',
    "",
    "Rules: at most one match per candidate. The question must be copied character-for-character from MY QUESTIONS. The reason must be YOUR OWN words — never quote, excerpt, or closely paraphrase a candidate's sentences; describe the connection at arm's length (e.g. 'they have been working through exactly this kind of pricing decision'). Only include real matches; an empty matches array is a fine response.",
    "Never wrap the JSON in code fences. Never add anything outside the JSON.",
  ].join("\n");
}

function buildUserMessage(questions, candidates) {
  const lines = ["MY QUESTIONS:"];
  for (const q of questions) lines.push(`- ${q}`);
  lines.push("", "CANDIDATES:");
  for (const c of candidates) {
    lines.push("", `[${c.code}]`, c.text);
  }
  return lines.join("\n");
}

// Keep only matches whose question is exactly one of mine and whose
// candidate is known. One match per candidate, capped overall. The
// question field carries my own words; the reason is the matcher's own
// one-liner — and as a hard backstop it's dropped whenever it lifts a
// run of the candidate's text verbatim (the no-quoting rule, enforced).
function validateMatches(value, questions, candidates) {
  const matches = (value && Array.isArray(value.matches)) ? value.matches : [];
  const byCode = new Map(candidates.map((c) => [c.code, c]));
  const squash = (t) => String(t).replace(/\s+/g, " ").trim();
  const questionSet = new Set(questions);
  const used = new Set();
  const out = [];
  for (const m of matches) {
    if (!m || typeof m !== "object") continue;
    const cand = byCode.get(m.candidate);
    if (!cand || used.has(cand.code)) continue;
    if (typeof m.question !== "string" || !questionSet.has(m.question)) continue;
    used.add(cand.code);
    let reason = typeof m.reason === "string" ? m.reason.trim().slice(0, MAX_REASON_LEN) : "";
    // Backstop: a "reason" that appears verbatim in the candidate's
    // writing is a quote, not a description — drop it.
    if (reason && squash(cand.text).includes(squash(reason))) reason = "";
    out.push({ userId: cand.userId, question: m.question, reason });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

function parseReply(text) {
  const trimmed = (text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

async function callModel({ system, userMessage }) {
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
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      temperature: 0,
      system: [
        { type: "text", text: String(system), cache_control: { type: "ephemeral" } },
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

const handler = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  let myUserId;
  try {
    const session = await authenticateSession(token);
    myUserId =
      (session && session.session && session.session.user_id) ||
      (session && session.user && session.user.user_id) ||
      "";
    if (!myUserId) throw Object.assign(new Error("Session missing user id"), { status: 401 });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  try {
    const myEssaysRow = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId: myUserId, kind: "essays" } },
    });
    const questions = extractQuestions(myEssaysRow ? myEssaysRow.data : []);
    if (!questions.length) {
      res.status(200).json({ questions: [], suggestions: [] });
      return;
    }

    const essayRows = await prisma.tinkerUserData.findMany({
      where: { kind: "essays" },
      take: 100,
    });
    const candidates = [];
    for (const row of essayRows) {
      if (!row || row.userId === myUserId) continue;
      const text = candidateText(row.data);
      if (!text) continue;
      candidates.push({
        code: String.fromCharCode(65 + candidates.length), // A, B, C…
        userId: row.userId,
        text,
      });
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    if (!candidates.length) {
      res.status(200).json({ questions, suggestions: [] });
      return;
    }

    let raw = "";
    try {
      raw = await callModel({
        system: buildSystemPrompt(),
        userMessage: buildUserMessage(questions, candidates),
      });
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message || "Upstream error" });
      return;
    }
    const matches = validateMatches(parseReply(raw), questions, candidates);

    // Names (profile rows) + phone numbers (Stytch accounts) for the
    // matched founders. Both best-effort — a missing name falls back to
    // "A founder", a failed phone lookup just omits the number.
    const ids = matches.map((m) => m.userId);
    const profiles = ids.length
      ? await prisma.tinkerUserData.findMany({
          where: { kind: "profile", userId: { in: ids } },
        })
      : [];
    const nameById = new Map();
    for (const p of profiles) {
      const name = p && p.data && typeof p.data.name === "string" ? p.data.name.trim() : "";
      if (name) nameById.set(p.userId, name);
    }
    const phoneById = new Map();
    await Promise.all(ids.map(async (id) => {
      try {
        const user = await getUser(id);
        const numbers = (user && Array.isArray(user.phone_numbers)) ? user.phone_numbers : [];
        const phone = numbers.length && typeof numbers[0].phone_number === "string"
          ? numbers[0].phone_number
          : "";
        if (phone) phoneById.set(id, phone);
      } catch { /* best-effort */ }
    }));

    res.status(200).json({
      questions,
      suggestions: matches.map((m) => ({
        userId: m.userId,
        name: nameById.get(m.userId) || "A founder",
        phone: phoneById.get(m.userId) || null,
        question: m.question,
        reason: m.reason || null,
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});

module.exports = handler;
module.exports.__test__ = {
  MAX_QUESTIONS,
  MAX_SUGGESTIONS,
  extractQuestions,
  candidateText,
  buildSystemPrompt,
  buildUserMessage,
  validateMatches,
  parseReply,
};
