/* Interview + follow-up prompts shared by the writing UI and MCP.
 *
 * Loaded as a classic script before writing.js (window.tinkerInterview)
 * and required from api/_lib/followups.js. One prompt string, so the
 * browser interview and ask_followups cannot drift.
 *
 * The writing UI is otherwise unchanged: it still sends this prompt
 * through window.tinker.callClaude on each turn.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerInterview = api;
  } else if (root) {
    root.tinkerInterview = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SYSTEM_PROMPT = [
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
    "",
    "RULE 8 — TRANSACTIONS AS A MIRROR FOR FOUNDER IDENTITY.",
    "If the user message includes 'Recent transactions:', treat those rows as concrete moments the founder can reflect on. The goal is NOT bookkeeping, taxes, deductions, or 'ordinary and necessary' classification — those are not the subject. The goal is helping the founder see themselves as a founder, as a person, and as a highly skilled individual claiming an area as their business. When the seed, what they're facing, or the conversation so far overlaps with one or more rows (e.g. grocery store + grocery transactions), your question may ground in those specifics — surfacing what the founder is learning about how the way they spend connects to how they work, where the line between personal and business genuinely blurs (and what they're learning by noticing). Use the data as a mirror, not advice. Do NOT lecture about money or taxes. Do NOT moralise.",
    "",
    "RULE 9 — STEER TOWARD UNEXPLORED PITCH TERRITORY.",
    "If the user message lists 'Starter-pitch slides the founder hasn't written into yet: ...', those are eleven canonical territories the founder's pitch is still missing. When the conversation has settled or is about to drift, let one of those uncovered territories shape what you ask next — pointed at what the founder is learning about that territory, in the founder's own scene and vocabulary. Do NOT name a slide title back to the founder. Do NOT mention the pitch, the deck, the eleven slides, or any of the slide-title literals. Do NOT force the move if the current answer is still alive — finish that thread first. Do NOT cycle through the list mechanically; pick the one nearest to what they're already saying.",
    "",
    "RULE 10 — ASK IN THE FOUNDER'S OWN WRITING VOICE.",
    "If the user message includes a 'THE FOUNDER'S WRITING VOICE' block, it is a profile learned from the founder's own published essays — their tone, cadence, vocabulary, and the moves they reach for. Phrase your questions so they sound like they came from inside that same voice: match the cadence and lean on the words they actually use. This shapes HOW you ask, never WHAT they answer. It does NOT relax any rule above — every question still pursues what they are learning (RULE 4), and the stitched essay is still built only from words the founder typed (RULE 1, RULE 2). Never quote the profile back to the founder, never describe their voice to them.",
  ].join("\n");


  const FREEFORM_SYSTEM_PROMPT = [
    "You are a follow-up interviewer for tinker, a writing tool for founders.",
    "",
    "The writer has shared a draft or a fragment. You do not rewrite it, title it, or stitch an essay. You ask follow-up questions that pursue what they are learning: patterns they are noticing, ideas that are clicking or breaking, what is getting clearer or murkier, what contradicts prior thinking.",
    "",
    "Be specific and concrete. Not 'tell me more'. Not 'how did that make you feel'. Do not psychoanalyse. Do not comment on their tone.",
    "",
    "Return a single JSON object and nothing else:",
    '{ "questions": string[] }',
    "Provide three to five questions. Each question MUST contain the word 'learning' or one close synonym from this list: discovering, noticing, figuring out, realising, understanding, picking up, working out, coming to see, finding out, recognising. Vary the synonym. Do not repeat a question listed as already asked.",
    "Never wrap the JSON in code fences. Never add explanations outside the JSON.",
  ].join("\n");

  const MAX_DRAFT = 80000;
  const MAX_TURNS = 40;
  const MAX_TURN_CHARS = 20000;
  const MAX_VOICE = 20000;
  const MAX_SCENE = 2000;

  // Keep crafting must always yield a next_question. Last-resort prompts are
  // stage-keyed so retries stay deterministic when the model returns done/empty.
  // Never reuse a question already in the transcript (owner complaint: same prompt).
  const KEEP_CRAFTING_FALLBACKS = {
    early: [
      "What are you noticing that you did not expect?",
      "What are you figuring out about how this work actually moves?",
      "What are you discovering in the part you keep returning to?",
      "What are you picking up about the pace you keep choosing?",
    ],
    mid: [
      "What is getting clearer as you keep figuring this out?",
      "What contradiction are you coming to see in how this fits together?",
      "What are you understanding now that you would not have said an hour ago?",
      "What are you working out that still resists a clean sentence?",
    ],
    late: [
      "What are you recognising that you want to hold onto from this?",
      "What are you coming to see that still needs one more pass?",
      "What learning here feels solid enough to say out loud?",
      "What are you finding out that changes what you ask for next?",
    ],
  };

  const KEEP_CRAFTING_INSTRUCTION =
    'The founder pressed "Keep crafting" — they want another question, not a stitch. ' +
    "You MUST return a non-empty next_question that is visibly different from every question already asked. " +
    "Do not repeat or lightly rephrase a prior question. Set done to false. Set stitched_title and stitched_body to null. " +
    "Do not stitch. Do not set done true. Ask one concrete learning-focused follow-up that has not been asked yet. " +
    "Respond with the JSON object only.";

  const KEEP_CRAFTING_TIGHTER_INSTRUCTION =
    "REQUIRED: Return JSON with a non-empty next_question string that has NOT been asked yet. " +
    "It must be clearly different from every prior question. " +
    "Set done to false. Set stitched_title and stitched_body to null. " +
    "Do not stitch. Do not mark done. Ask one new learning-focused question. JSON object only.";

  function transcriptStage(turnCount) {
    const n = Math.max(0, Number(turnCount) || 0);
    if (n <= 2) return "early";
    if (n <= 5) return "mid";
    return "late";
  }

  function normalizeQuestionKey(q) {
    return String(q || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function askedQuestionKeys(questions) {
    const keys = new Set();
    if (!Array.isArray(questions)) return keys;
    for (const q of questions) {
      const key = normalizeQuestionKey(q);
      if (key) keys.add(key);
    }
    return keys;
  }

  function collectAskedQuestions(transcript, priorTurns, pending) {
    const out = [];
    if (Array.isArray(transcript)) {
      for (const t of transcript) {
        if (t && typeof t.q === "string" && t.q.trim()) out.push(t.q.trim());
      }
    }
    if (Array.isArray(priorTurns)) {
      for (const t of priorTurns) {
        if (typeof t === "string" && t.trim()) out.push(t.trim());
        else if (t && typeof t.q === "string" && t.q.trim()) out.push(t.q.trim());
      }
    }
    if (typeof pending === "string" && pending.trim()) out.push(pending.trim());
    return out;
  }

  function isRepeatQuestion(q, asked) {
    const key = normalizeQuestionKey(q);
    if (!key) return true;
    const askedKeys = asked instanceof Set ? asked : askedQuestionKeys(asked);
    if (askedKeys.has(key)) return true;
    // Near-duplicate: one key contains the other and they share enough length.
    for (const prev of askedKeys) {
      if (!prev) continue;
      if (key === prev) return true;
      const shorter = key.length <= prev.length ? key : prev;
      const longer = key.length <= prev.length ? prev : key;
      if (shorter.length >= 24 && longer.includes(shorter)) return true;
    }
    return false;
  }

  function fallbackKeepCraftingQuestion(turnCount, asked) {
    const n = Math.max(0, Number(turnCount) || 0);
    const askedKeys = asked instanceof Set ? asked : askedQuestionKeys(asked);
    const stage = transcriptStage(n);
    const stageOrder =
      stage === "late"
        ? ["late", "mid", "early"]
        : stage === "mid"
          ? ["mid", "late", "early"]
          : ["early", "mid", "late"];
    // Prefer the current stage's unused prompts (rotated for determinism),
    // then spill to later stages. Do not rotate across the full pool — that
    // skipped mid prompts and re-showed late ones the owner had already seen.
    for (const s of stageOrder) {
      const prompts = KEEP_CRAFTING_FALLBACKS[s] || [];
      if (!prompts.length) continue;
      const start = n % prompts.length;
      for (let i = 0; i < prompts.length; i++) {
        const q = prompts[(start + i) % prompts.length];
        if (!isRepeatQuestion(q, askedKeys)) return q;
      }
    }
    // All stock prompts used — mint a numbered learning probe that cannot collide.
    let suffix = n + 1;
    for (let i = 0; i < 20; i++) {
      const q = `What new learning are you coming to see in pass ${suffix}?`;
      if (!isRepeatQuestion(q, askedKeys)) return q;
      suffix += 1;
    }
    return `What else are you learning about this now (${Date.now()})?`;
  }

  // Keep crafting never accepts a stitch/done payload, empty string, or a repeat.
  function normalizeKeepCraftingQuestion(parsed, asked) {
    const q = parsed && typeof parsed.next_question === "string" ? parsed.next_question.trim() : "";
    if (!q) return null;
    if (asked != null && isRepeatQuestion(q, asked)) return null;
    return q;
  }

  function keepCraftingUserInstruction({ tighter = false } = {}) {
    return tighter ? KEEP_CRAFTING_TIGHTER_INSTRUCTION : KEEP_CRAFTING_INSTRUCTION;
  }

  function stripFences(text) {
    return String(text || "")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");
  }

  function parseInterviewResponse(text) {
    const stripped = stripFences(text);
    try {
      const obj = JSON.parse(stripped);
      return {
        next_question: obj.next_question || null,
        stitched_title: obj.stitched_title || null,
        stitched_body: obj.stitched_body || null,
        done: !!obj.done,
      };
    } catch {
      return {
        next_question: stripped.slice(0, 240),
        stitched_title: null,
        stitched_body: null,
        done: false,
      };
    }
  }

  function parseFreeformResponse(text) {
    const stripped = stripFences(text);
    try {
      const obj = JSON.parse(stripped);
      const questions = Array.isArray(obj.questions)
        ? obj.questions
            .filter((q) => typeof q === "string" && q.trim())
            .map((q) => q.trim())
            .slice(0, 5)
        : [];
      return { questions };
    } catch {
      return { questions: [] };
    }
  }

  function asTrimmedString(value, max) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
  }

  function splitPrior(priorTurns) {
    const questions = [];
    const turns = [];
    if (priorTurns == null) return { questions, turns };
    if (!Array.isArray(priorTurns)) {
      return { error: "priorTurns must be an array." };
    }
    if (priorTurns.length > MAX_TURNS) {
      return { error: `priorTurns is limited to ${MAX_TURNS} items.` };
    }
    for (const item of priorTurns) {
      if (typeof item === "string") {
        const q = item.trim();
        if (q) questions.push(q.slice(0, MAX_TURN_CHARS));
        continue;
      }
      if (item && typeof item === "object" && typeof item.q === "string") {
        const q = item.q.trim();
        const a = typeof item.a === "string" ? item.a.trim() : "";
        if (!q) continue;
        turns.push({
          q: q.slice(0, MAX_TURN_CHARS),
          a: a.slice(0, MAX_TURN_CHARS),
        });
        continue;
      }
      return { error: "priorTurns items must be strings or { q, a } objects." };
    }
    return { questions, turns };
  }

  function normalizeTranscript(transcript) {
    if (!Array.isArray(transcript)) {
      return { error: "transcript must be an array of { q, a }." };
    }
    if (transcript.length > MAX_TURNS) {
      return { error: `transcript is limited to ${MAX_TURNS} turns.` };
    }
    const turns = [];
    for (const item of transcript) {
      if (!item || typeof item !== "object" || typeof item.q !== "string" || typeof item.a !== "string") {
        return { error: "transcript items must be { q, a } strings." };
      }
      const q = item.q.trim();
      const a = item.a.trim();
      if (!q && !a) continue;
      turns.push({
        q: q.slice(0, MAX_TURN_CHARS),
        a: a.slice(0, MAX_TURN_CHARS),
      });
    }
    return { turns };
  }

  function transactionLine(entry) {
    if (typeof entry === "string") {
      const line = entry.trim();
      if (!line) return "";
      return (line.startsWith("- ") ? line : `- ${line}`).slice(0, 500);
    }
    if (!entry || typeof entry !== "object") return "";
    if (typeof entry.date !== "string" || typeof entry.merchant !== "string") return "";
    const v = Number(entry.amount);
    const amt = Number.isFinite(v) ? `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}` : "";
    const cat = entry.category ? ` [${String(entry.category).slice(0, 80)}]` : "";
    return `- ${entry.date} ${entry.merchant} ${amt}${cat}`.replace(/[ \t]+/g, " ").trim().slice(0, 500);
  }

  function sceneLines(args) {
    const lines = [];
    const seed = asTrimmedString(args.seed, MAX_SCENE);
    const facing = asTrimmedString(args.facing, MAX_SCENE);
    const lastPurchased = asTrimmedString(args.lastPurchased, MAX_SCENE);
    if (seed) lines.push(`Where the founder is right now: ${seed}`);
    if (facing) lines.push(`What the founder is facing: ${facing}`);
    if (lastPurchased) lines.push(`What the founder last purchased: ${lastPurchased}`);
    if (Array.isArray(args.transactions) && args.transactions.length) {
      const tx = args.transactions.slice(0, 25).map(transactionLine).filter(Boolean);
      if (tx.length) {
        if (lines.length) lines.push("");
        lines.push("Recent transactions:");
        lines.push(...tx);
      }
    }
    return lines;
  }

  function alreadyAskedBlock(questions) {
    if (!questions.length) return [];
    return [
      "Questions already asked (do not repeat):",
      ...questions.map((q) => `- ${q}`),
      "",
    ];
  }

  function buildInterviewUserMessage(args, prior, transcript) {
    const lines = sceneLines(args);
    if (lines.length) lines.push("");
    const seen = new Set();
    const turns = [];
    for (const t of [...prior.turns, ...transcript]) {
      const key = `${t.q}\n${t.a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      turns.push(t);
    }
    const asked = collectAskedQuestions(turns, prior.questions, args.pendingQuestion);
    lines.push(...alreadyAskedBlock(asked));
    if (turns.length === 0) {
      lines.push("The founder just opened a new draft. Begin the interview.");
      if (args.keepCrafting === true) {
        lines.push("");
        lines.push(keepCraftingUserInstruction({ tighter: args.keepCraftingTighter === true }));
      }
      return lines.join("\n");
    }
    lines.push("Conversation so far (the founder's answers are verbatim — do not paraphrase):", "");
    turns.forEach((t, i) => {
      lines.push(`Q${i + 1}: ${t.q}`);
      lines.push(`A${i + 1}: ${t.a}`);
      lines.push("");
    });
    if (args.forceStitch === true) {
      lines.push(
        "The founder has signaled they are done — they pressed \"This is everything\". Skip any further questions and produce the stitched essay now. Set next_question to null, fill stitched_title and stitched_body using only the founder's typed words, and set done to true."
      );
    } else if (args.keepCrafting === true) {
      lines.push(keepCraftingUserInstruction({ tighter: args.keepCraftingTighter === true }));
    } else {
      lines.push("Decide whether to ask another question or to stitch. Respond with the JSON object only.");
    }
    return lines.join("\n");
  }

  function buildFreeformUserMessage(args, prior) {
    const lines = [];
    const seed = asTrimmedString(args.seed, MAX_SCENE);
    const facing = asTrimmedString(args.facing, MAX_SCENE);
    if (seed) lines.push(`Where the writer is right now: ${seed}`);
    if (facing) lines.push(`What the writer is facing: ${facing}`);
    if (lines.length) lines.push("");
    const asked = prior.questions.concat(prior.turns.map((t) => t.q));
    lines.push(...alreadyAskedBlock(asked));
    lines.push("Draft (verbatim — do not rewrite it):", "", asTrimmedString(args.draft, MAX_DRAFT), "", "Respond with the JSON object only.");
    return lines.join("\n");
  }

  function composeSystem(base, voice) {
    const block = asTrimmedString(voice, MAX_VOICE);
    return block ? `${base}\n\n${block}` : base;
  }

  // Returns { mode, system, user } or { error }.
  // transcript present (even empty) runs the founder interview contract.
  // draft alone runs freeform follow-ups. A caller-supplied system prompt
  // is ignored — the prompt is owned here.
  function buildFollowupRequest(args) {
    const input = args && typeof args === "object" && !Array.isArray(args) ? args : null;
    if (!input) return { error: "arguments must be an object." };
    const hasTranscript = Object.prototype.hasOwnProperty.call(input, "transcript");
    const hasDraft = typeof input.draft === "string" && input.draft.trim().length > 0;
    if (!hasTranscript && !hasDraft) {
      return { error: "Pass a transcript (founder interview) or a draft (freeform follow-ups)." };
    }
    if (hasTranscript && hasDraft) {
      return { error: "Pass either a transcript or a draft, not both." };
    }
    const prior = splitPrior(input.priorTurns);
    if (prior.error) return { error: prior.error };
    if (hasTranscript) {
      const transcript = normalizeTranscript(input.transcript);
      if (transcript.error) return { error: transcript.error };
      if (input.forceStitch === true && input.keepCrafting === true) {
        return { error: "Pass either forceStitch or keepCrafting, not both." };
      }
      if (input.forceStitch === true && transcript.turns.length === 0 && prior.turns.length === 0) {
        return { error: "forceStitch needs at least one answered turn." };
      }
      return {
        mode: "interview",
        system: composeSystem(SYSTEM_PROMPT, input.voice),
        user: buildInterviewUserMessage(input, prior, transcript.turns),
      };
    }
    if (input.draft.length > MAX_DRAFT) {
      return { error: `draft is limited to ${MAX_DRAFT} characters.` };
    }
    return {
      mode: "freeform",
      system: composeSystem(FREEFORM_SYSTEM_PROMPT, input.voice),
      user: buildFreeformUserMessage(input, prior),
    };
  }

  return {
    SYSTEM_PROMPT,
    FREEFORM_SYSTEM_PROMPT,
    KEEP_CRAFTING_INSTRUCTION,
    KEEP_CRAFTING_TIGHTER_INSTRUCTION,
    KEEP_CRAFTING_FALLBACKS,
    parseInterviewResponse,
    parseFreeformResponse,
    buildFollowupRequest,
    transcriptStage,
    normalizeQuestionKey,
    askedQuestionKeys,
    collectAskedQuestions,
    isRepeatQuestion,
    fallbackKeepCraftingQuestion,
    normalizeKeepCraftingQuestion,
    keepCraftingUserInstruction,
  };
});
