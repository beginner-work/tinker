/* tinker writing flow — the interview engine, ported from
 * src/renderer/writing.js. Same strict-JSON protocol, same founder-only
 * stitch guarantee. RULES 1–7 are copied verbatim from the web renderer;
 * RULES 8–10 (transactions mirror, pitch-territory steering, writing
 * voice) are omitted until their data sources exist on mobile. Keep the
 * shared prompt text in sync with the web renderer; it is the product.
 *
 * The one architectural difference from web: turns go through the
 * assistant abstraction (src/lib/assistant.ts), so a supported Android
 * device can run the interview against Gemini Nano on-device and
 * everything else uses the Claude proxy.
 */

import { generate } from "./assistant";
import type { Draft, TranscriptEntry } from "../api/userData";

export const SYSTEM_PROMPT = [
  "You are an interviewer for tinker, a writing tool for founders.",
  "",
  "RULE 1 — INTERVIEW, DO NOT WRITE.",
  "You ask one question at a time. You never invent prose for the founder. You never paraphrase, smooth, or improve their words. The essay is built from their typed answers, exactly as typed (you may join with paragraph breaks and trim leading/trailing whitespace, nothing else).",
  "",
  "RULE 2 — STITCH, DO NOT AUTHOR.",
  "When you produce the stitched essay, every sentence must be a direct copy of words the founder has typed. You may concatenate the founder's answers in any order, drop redundant repetition, and break long answers into paragraphs. You may NOT add transition phrases, summary sentences, framing language, or any words the founder has not already typed. If you find yourself wanting to add a word, do not.",
  "",
  "RULE 3 — TITLE FROM THEIR WORDS.",
  "If you provide a title, it must be a contiguous phrase the founder has typed. Pick the most evocative one. Do not invent a title.",
  "",
  "RULE 4 — KEEP IT SHORT, AND PURSUE LEARNINGS.",
  "Aim for between five and nine questions total. Stop when the founder has said enough. Every question must pursue what the founder is learning — patterns they're noticing, ideas that are clicking or breaking, things they didn't expect, what's getting clearer or murkier, what's contradicting prior thinking. Be specific and concrete: not 'tell me more', not 'how did that make you feel', but questions that probe at what the founder is figuring out.",
  "Every question MUST contain the word 'learning' or one close synonym from this list: discovering, noticing, figuring out, realising, understanding, picking up, working out, coming to see, finding out, recognising. Vary the synonym across questions — don't repeat the same one verbatim. Pick the form that best fits the mood of the place.",
  "Do NOT ask about feelings, emotions, or moods. Do NOT ask 'how did that make you feel'. Do NOT psychoanalyse. Stay on the learning — what they are coming to understand. The founder's emotional state is not the subject.",
  "",
  "RULE 5 — RESPOND IN STRICT JSON.",
  "Always respond as a single JSON object, with exactly these keys:",
  '  { "next_question": string | null, "stitched_title": string | null, "stitched_body": string | null, "done": boolean }',
  "If you have another question for the founder, set next_question and leave the stitched fields null and done false.",
  "If the founder has answered enough, set next_question null, fill stitched_title and stitched_body with prose drawn ONLY from the founder's typed answers, and set done true.",
  "Never wrap the JSON in code fences. Never add explanations outside the JSON.",
  "",
  "RULE 6 — LET PLACE, CIRCUMSTANCE, AND RECENT PURCHASE SET THE MOOD.",
  "If the user message provides a seed ('Where the founder is right now: ...'), what they are facing ('What the founder is facing: ...'), and/or what they last purchased ('What the founder last purchased: ...'), let those shape the mood, cadence, and word choice of your questions. Match the texture of where they are, the weight of what's in front of them, and the residue of what they just bought. A recent purchase is a small window into how the founder lives and works — use it as one. Do NOT assume what they are learning from any of these — never lead, never name their facing or their last purchase back to them as a fact.",
  "",
  "RULE 7 — RE-ANCHOR ON LEARNING WHEN THE FOUNDER PULLS AWAY.",
  "Watch the founder's recent answers. If they go terse (one-line, fragmented, monosyllabic), stressed (frustrated, scattered, deflective, 'I don't know', cursing), or otherwise drift from the question, your next question should bring them back to the underlying intent: what they are learning. Phrase it gently — either restate 'What are you learning?' in mood-matched words, or ask it more plainly (e.g. 'What is it you're learning, really?') if a softer touch isn't landing. Stay open and uncritical. Don't comment on their tone; just re-anchor.",
].join("\n");

export type EngineReply = {
  next_question: string | null;
  stitched_title: string | null;
  stitched_body: string | null;
  done: boolean;
};

export function parseReply(text: string): EngineReply {
  const trimmed = (text || "").trim();
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const obj = JSON.parse(stripped);
    return {
      next_question: obj.next_question || null,
      stitched_title: obj.stitched_title || null,
      stitched_body: obj.stitched_body || null,
      done: !!obj.done,
    };
  } catch {
    // Fallback: treat the whole response as a question.
    return {
      next_question: stripped.slice(0, 240),
      stitched_title: null,
      stitched_body: null,
      done: false,
    };
  }
}

// ── Founder-only verification (RULE 1/2 enforced in code) ─────────────

function tokens(s: string): string[] {
  return (s || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

export function verifyFounderOnly(stitched: string, transcript: TranscriptEntry[]) {
  const corpus = (transcript || []).map((t) => t.a).join(" ");
  const have = new Set(tokens(corpus));
  const foreign = tokens(stitched).filter((w) => !have.has(w));
  return { ok: foreign.length === 0, foreign };
}

export function phraseAppearsIn(phrase: string, corpus: string): boolean {
  const c = corpus.toLowerCase().replace(/\s+/g, " ");
  const p = (phrase || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!p) return false;
  return c.includes(p);
}

export function firstSentence(text: string): string {
  const s = String(text || "").trim();
  const m = s.match(/^[^.!?\n]{1,80}[.!?]?/);
  return m ? m[0].trim() : s.slice(0, 60);
}

export function slugify(s: string): string {
  return (
    (s || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 48) || "untitled"
  );
}

// ── Turns ─────────────────────────────────────────────────────────────

function buildUserMessage(draft: Draft, { forceStitch = false } = {}): string {
  const lines: string[] = [];
  if (draft.seed) lines.push(`Where the founder is right now: ${draft.seed}`);
  if (draft.facing) lines.push(`What the founder is facing: ${draft.facing}`);
  if (lines.length) lines.push("");
  const transcript = draft.transcript || [];
  if (transcript.length === 0) {
    lines.push("The founder just opened a new draft. Begin the interview.");
    return lines.join("\n");
  }
  lines.push(
    "Conversation so far (the founder's answers are verbatim — do not paraphrase):",
    "",
  );
  transcript.forEach((t, i) => {
    lines.push(`Q${i + 1}: ${t.q}`);
    lines.push(`A${i + 1}: ${t.a}`);
    lines.push("");
  });
  if (forceStitch) {
    lines.push(
      'The founder has signaled they are done — they pressed "This is everything". Skip any further questions and produce the stitched essay now. Set next_question to null, fill stitched_title and stitched_body using only the founder\'s typed words, and set done to true.',
    );
  } else {
    lines.push(
      "Decide whether to ask another question or to stitch. Respond with the JSON object only.",
    );
  }
  return lines.join("\n");
}

export type TurnResult =
  | { kind: "question"; question: string }
  | { kind: "stitched"; title: string; body: string };

export async function askNext(
  draft: Draft,
  { forceStitch = false } = {},
): Promise<TurnResult> {
  const reply = await generate({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(draft, { forceStitch }) }],
    maxTokens: 2048,
  });
  const parsed = parseReply(reply.text);
  const stitchNow = (parsed.done && parsed.stitched_body) || forceStitch;

  if (stitchNow) {
    // Hard verify: stitched body must use only words the founder typed.
    // On failure, fall back to the founder's raw answers joined by
    // paragraph breaks — boring, but provably founder-only.
    const transcript = draft.transcript || [];
    const corpus = transcript.map((t) => t.a).join("\n\n");
    let body = parsed.stitched_body || "";
    let title = parsed.stitched_title || draft.title || "Untitled";
    const verified = body ? verifyFounderOnly(body, transcript) : { ok: false };
    if (!body || !verified.ok) {
      body = transcript.map((t) => t.a.trim()).filter(Boolean).join("\n\n");
      if (!phraseAppearsIn(title, corpus)) title = firstSentence(body) || "Untitled";
    }
    return { kind: "stitched", title, body };
  }

  return {
    kind: "question",
    question: parsed.next_question || "What else feels true about this?",
  };
}

/* The canonical opening, mood-tuned when the founder set a scene.
 * Mirrors the opening-question call in writing.js. */
export async function openingQuestion(seed?: string | null, facing?: string | null): Promise<string> {
  if (!seed && !facing) return "What are you learning?";
  const system = [
    "You design the opening question for tinker, a quiet writing tool for founders.",
    "The founder will write about what they are learning right now. Your job is to take",
    "the canonical opening — 'What are you learning?' — and tune its mood, cadence, and",
    "word choice to fit the scene the founder has set: where they are physically and what",
    "they're facing. Keep the underlying intent intact: the founder is being asked what",
    "they are learning. Do not change that intent.",
    "",
    "Constraints:",
    "- 6 to 16 words.",
    "- Single open-ended question, ending with a question mark.",
    "- MUST contain the word 'learning' or one close synonym (discovering, noticing, figuring out, realising, understanding, picking up, working out, coming to see, finding out, recognising). Pick the form that fits the mood of the scene.",
    "- Do NOT assume what the founder is learning. Do NOT lead.",
    "- Output ONLY the question. No quotes, no preamble, no trailing notes.",
  ].join("\n");
  const ctx: string[] = [];
  if (seed) ctx.push(`Where the founder is right now: ${seed}`);
  if (facing) ctx.push(`What the founder is facing: ${facing}`);
  try {
    const reply = await generate({
      system,
      messages: [{ role: "user", content: ctx.join("\n") }],
      maxTokens: 80,
    });
    let text = reply.text.replace(/^["'“‘]+|["'”’]+$/g, "").trim();
    if (text.length > 200) text = text.slice(0, 200);
    return text || "What are you learning?";
  } catch {
    return "What are you learning?";
  }
}
