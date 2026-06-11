/* tinker — writing flow
 *
 * Onboarding-shaped guided writing: one question at a time, large input,
 * paginated, progress dots. NOT a chat. Claude asks questions; the founder
 * answers in their own words; Claude stitches the answers into a single
 * essay using ONLY the founder's words. Once the essay is stitched it
 * publishes straight through — there is no separate review/Save step.
 *
 * Wire-up: renderer.js calls window.tinkerWriting.open(draft) when a
 * draft tab is selected. We render against a `state` object pulled from
 * the draft, and persist back via window.tinkerOnDraftChange(...).
 */

(() => {
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
    "END BEFORE THE LOOP: before asking another question, reread the whole transcript. If the question you are about to ask circles back to ground the founder has already covered — the same idea in new clothes — or their recent answers have started restating earlier ones, the interview is complete. Do not ask it. Stitch instead: set next_question null, fill the stitched fields, set done true. Ending one question early always beats one question late — the founder should close the session feeling 'yes, that was it', never that they were kept answering questions they didn't need to answer.",
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

  // The founder's learned writing-voice profile, folded into the prompts so
  // the interview is phrased in their own voice. Empty until enough essays
  // exist to train on (see voice-model.js / api/voice/model.js).
  function voiceBlock() {
    if (window.tinkerVoice && typeof window.tinkerVoice.interviewerBlock === "function") {
      try { return window.tinkerVoice.interviewerBlock() || ""; }
      catch { return ""; }
    }
    return "";
  }

  const SEED_QUESTION = "What are you learning?";

  // ── DOM refs ─────────────────────────────────────────────────────────
  const stage = document.getElementById("writing-stage");
  const progressEl = document.getElementById("writing-progress");
  const stepEl = document.getElementById("writing-step");
  const closeBtn = document.getElementById("writing-close");
  const nextBtn = document.getElementById("writing-next");
  const endBtn = document.getElementById("writing-end");

  let active = null; // current draft

  // ── Public API ──────────────────────────────────────────────────────
  window.tinkerWriting = {
    open(draft) {
      active = draft;
      // Warm the founder's writing-voice model so RULE 10 has a profile to
      // work from. Non-blocking: if it isn't ready for the first question,
      // later turns pick it up. No-op when offline or untrained.
      if (window.tinkerVoice && typeof window.tinkerVoice.ensure === "function") {
        try { window.tinkerVoice.ensure(); } catch { /* ignore */ }
      }
      // No AI mode (offline, or the manual choice): there's no Claude to
      // talk to, so drop the back-and-forth interview entirely. Show the
      // same "What are you learning?" question card as the AI interview —
      // identical chrome — with one "This is everything" save that writes
      // to local storage; the essay goes off to the pitch when we
      // reconnect. See renderer.js' publishDeferred / flushPendingPitches.
      if (isFreeWrite()) {
        renderFreewriteCompose();
        return;
      }
      // Pre-prompt: seed capture (Instagram tag-style) before the
      // question flow. `seed` is undefined on a fresh draft; once the
      // founder commits or skips it becomes a string or null and never
      // re-prompts. The seed is metadata, not part of the transcript,
      // so it doesn't affect stitching or founder-only verification.
      if (active.seed === undefined) {
        renderSeedPrompt();
        return;
      }
      seedAndRenderInterview();
    },
  };

  function isFreeWrite() {
    return !!(window.tinkerFreewrite && window.tinkerFreewrite.isOn());
  }

  function persist(extraPatch) {
    if (!active) return;
    const patch = {
      transcript: active.transcript,
      currentStep: active.currentStep,
      pending: active.pending,
      stitched: active.stitched,
      title: active.title,
      seed: active.seed,
      facing: active.facing,
      lastPurchased: active.lastPurchased,
      freeform: active.freeform,
      _scratch: active._scratch,
      ...(extraPatch || {}),
    };
    if (typeof window.tinkerOnDraftChange === "function") {
      window.tinkerOnDraftChange(active.id, patch);
    }
  }

  function seedAndRenderInterview() {
    // First-time seed with scene context (place and/or what they're
    // facing): ask Claude to mood the canonical "What are you
    // learning?" to fit. Failures and no-context cases fall through to
    // the canonical seed.
    if ((active.transcript || []).length === 0 && !active.pending && (active.seed || active.facing || active.lastPurchased)) {
      const draftId = active.id;
      renderLoading("Setting the scene…");
      moodSeedQuestion(active.seed, active.facing, active.lastPurchased)
        .then((q) => {
          if (!active || active.id !== draftId) return;
          applySeed(q);
        })
        .catch(() => {
          if (!active || active.id !== draftId) return;
          applySeed(SEED_QUESTION);
        });
      return;
    }
    if ((active.transcript || []).length === 0 && !active.pending) {
      active.pending = SEED_QUESTION;
      persist();
    }
    const maxStep = (active.transcript || []).length + (active.pending ? 1 : 0);
    if (active.currentStep == null || active.currentStep > maxStep) {
      active.currentStep = maxStep;
    }
    renderStep();
  }

  function applySeed(question) {
    active.pending = question;
    persist();
    const maxStep = (active.transcript || []).length + 1;
    if (active.currentStep == null || active.currentStep > maxStep) {
      active.currentStep = maxStep;
    }
    renderStep();
  }

  async function moodSeedQuestion(seed, facing, lastPurchased) {
    if (!window.tinker || typeof window.tinker.callClaude !== "function") {
      throw new Error("Anthropic client unavailable.");
    }
    const system = [
      "You design the opening question for tinker, a quiet writing tool for founders.",
      "The founder will write about what they are learning right now. Your job is to take",
      "the canonical opening — 'What are you learning?' — and tune its mood, cadence, and",
      "word choice to fit the scene the founder has set: where they are physically, what",
      "they're facing, the last thing they purchased, and any recent transactions they've connected.",
      "Keep the underlying intent intact: the founder is being asked what they are learning.",
      "Do not change that intent.",
      "",
      "Constraints:",
      "- 6 to 16 words.",
      "- Single open-ended question, ending with a question mark.",
      "- MUST contain the word 'learning' or one close synonym (discovering, noticing, figuring out, realising, understanding, picking up, working out, coming to see, finding out, recognising). Pick the form that fits the mood of the scene.",
      "- Do NOT assume what the founder is learning. Do NOT lead.",
      "- Match the texture of the place AND the weight of what they're facing AND the residue of what they just bought. If transactions overlap with any of those (e.g. grocery store + grocery rows, or a recent purchase that connects), you may ground the question in that overlap — but stay open, not advisory.",
      "- Output ONLY the question. No quotes, no preamble, no trailing notes.",
    ].join("\n");
    // Phrase the opening in the founder's own learned writing voice, when
    // we have one. Appended to the system prompt; intent is unchanged.
    const voice = voiceBlock();
    const systemWithVoice = voice ? `${system}\n\n${voice}` : system;
    const ctxLines = [];
    if (seed) ctxLines.push(`Where the founder is right now: ${seed}`);
    if (facing) ctxLines.push(`What the founder is facing: ${facing}`);
    if (lastPurchased) ctxLines.push(`What the founder last purchased: ${lastPurchased}`);
    const txLines = buildTransactionsContext();
    if (txLines.length) {
      if (ctxLines.length) ctxLines.push("");
      ctxLines.push("Recent transactions:");
      ctxLines.push(...txLines);
    }
    const result = await window.tinker.callClaude({
      system: systemWithVoice,
      messages: [{ role: "user", content: ctxLines.join("\n") }],
      model: "claude-opus-4-8",
      maxTokens: 80,
    });
    let text = (result.text || "").trim();
    // Strip wrapping quotes Claude sometimes adds.
    text = text.replace(/^["'“‘]+|["'”’]+$/g, "").trim();
    if (!text) throw new Error("Empty mood question.");
    if (text.length > 200) text = text.slice(0, 200);
    return text;
  }

  // ── Render ──────────────────────────────────────────────────────────
  function renderSeedPrompt() {
    const card = document.createElement("div");
    card.className = "writing-card writing-card--seed";

    const head = document.createElement("h2");
    head.className = "writing-question writing-seed__title";
    head.textContent = "Where have you been and where are you going?";
    card.appendChild(head);

    const whereLabel = document.createElement("label");
    whereLabel.className = "writing-seed__label";
    whereLabel.innerHTML =
      `<img class="writing-seed__pin" src="./icons/tinker-mark.svg" alt="" aria-hidden="true" />` +
      `<span>Where are you, physically?</span>`;
    card.appendChild(whereLabel);

    const whereInput = document.createElement("input");
    whereInput.type = "text";
    whereInput.className = "writing-input writing-seed__input";
    whereInput.placeholder = "A coffee shop, your kitchen, the back porch…";
    whereInput.autocomplete = "off";
    whereInput.spellcheck = false;
    card.appendChild(whereInput);

    const facingLabel = document.createElement("label");
    facingLabel.className = "writing-seed__label";
    facingLabel.textContent = "What are you facing?";
    card.appendChild(facingLabel);

    const facingInput = document.createElement("input");
    facingInput.type = "text";
    facingInput.className = "writing-input writing-seed__input";
    facingInput.placeholder = "A delayed launch. A hard call coming. Just the morning…";
    facingInput.autocomplete = "off";
    facingInput.spellcheck = false;
    card.appendChild(facingInput);

    const lastLabel = document.createElement("label");
    lastLabel.className = "writing-seed__label";
    lastLabel.textContent = "Can you recall the last thing you purchased?";
    card.appendChild(lastLabel);

    const lastInput = document.createElement("input");
    lastInput.type = "text";
    lastInput.className = "writing-input writing-seed__input";
    lastInput.placeholder = "A coffee, a book, an Uber, a subscription renewal…";
    lastInput.autocomplete = "off";
    lastInput.spellcheck = false;
    card.appendChild(lastInput);

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "writing-seed__skip";
    skip.textContent = "Skip for now";
    skip.addEventListener("click", () => {
      active.seed = null;
      active.facing = null;
      active.lastPurchased = null;
      persist();
      seedAndRenderInterview();
    });
    card.appendChild(skip);

    // The seed pre-prompt sits outside the question flow, so progress
    // dots and the step counter aren't meaningful here.
    progressEl.innerHTML = "";
    stepEl.textContent = "Set the scene";

    endBtn.hidden = true;
    nextBtn.hidden = false;
    nextBtn.disabled = false;
    nextBtn.textContent = "Continue →";
    nextBtn.onclick = () => {
      const wv = whereInput.value.trim();
      const fv = facingInput.value.trim();
      const lv = lastInput.value.trim();
      active.seed = wv || null;
      active.facing = fv || null;
      active.lastPurchased = lv || null;
      persist();
      seedAndRenderInterview();
    };

    [whereInput, facingInput, lastInput].forEach((inputEl) => {
      inputEl.addEventListener("keydown", (e) => {
        // Single-line inputs: Enter advances.
        if (e.key === "Enter") {
          e.preventDefault();
          nextBtn.click();
        }
      });
    });

    swap(card);
    setTimeout(() => whereInput.focus(), 30);
  }

  // ── No AI mode ─────────────────────────────────────────────────────
  // No interview, no Claude — but the founder sees the exact same
  // "What are you learning?" question card as the AI flow. One answer,
  // and the footer "This is everything →" hands the raw text to
  // renderer.js to save locally and queue for the pitch.
  const CHECK_GLYPH =
    '<path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';

  function renderFreewriteCompose() {
    if (!active) return;
    const card = document.createElement("div");
    card.className = "writing-card";

    // Same question heading and input as the AI interview's pending
    // question — No AI is indistinguishable from AI here.
    const q = document.createElement("h2");
    q.className = "writing-question";
    q.textContent = SEED_QUESTION;
    card.appendChild(q);

    const ta = document.createElement("textarea");
    ta.className = "writing-input";
    ta.placeholder = "Type your answer in your own words…";
    ta.rows = 8;
    // Restore an in-progress draft; if none, fall back to any answers
    // already given in an interview so dropping into No AI mode mid-draft
    // never loses words.
    ta.value =
      active.freeform ||
      (active.transcript || []).map((t) => t.a).filter(Boolean).join("\n\n") ||
      "";
    card.appendChild(ta);

    function save() {
      const body = ta.value.trim();
      if (!body) return;
      active.freeform = body;
      persist();
      saveFreewriteEssay(body);
    }

    let saveTimer;
    ta.addEventListener("input", () => {
      active.freeform = ta.value;
      endBtn.disabled = ta.value.trim().length === 0;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => persist(), 350);
    });
    ta.addEventListener("keydown", (e) => {
      // Cmd/Ctrl+Enter saves, mirroring the interview's commit shortcut.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        save();
      }
    });

    // Reuse the AI interview's chrome: the footer "This is everything →"
    // saves. There's no follow-up question in No AI, so Next stays hidden
    // and the progress dots/step counter don't apply.
    progressEl.innerHTML = "";
    stepEl.textContent = "";
    nextBtn.hidden = true;
    endBtn.hidden = false;
    endBtn.disabled = ta.value.trim().length === 0;
    endBtn.onclick = save;

    swap(card);
    setTimeout(() => ta.focus(), 30);
  }

  function saveFreewriteEssay(body) {
    const draftRef = active;
    if (draftRef && typeof window.tinkerOnFreewriteSave === "function") {
      window.tinkerOnFreewriteSave(draftRef, { body });
    }
    // The draft has been folded into a pending essay; stop rendering
    // against it and show the confirmation.
    active = null;
    renderFreewriteSaved();
  }

  function renderFreewriteSaved() {
    const card = document.createElement("div");
    card.className = "writing-card writing-card--freewrite-saved";
    card.innerHTML =
      `<div class="writing-freewrite__badge" aria-hidden="true">` +
      `<svg viewBox="0 0 24 24" width="26" height="26">${CHECK_GLYPH}</svg>` +
      `</div>` +
      `<h2 class="writing-question">Saved on this device.</h2>` +
      `<p class="writing-freewrite__sub">When you reconnect, this goes to your pitch like any other essay.</p>`;
    const done = document.createElement("button");
    done.type = "button";
    done.className = "writing-action writing-action--primary";
    done.textContent = "Done";
    done.addEventListener("click", () => {
      if (typeof window.tinkerOnWritingClose === "function") window.tinkerOnWritingClose();
    });
    card.appendChild(done);

    progressEl.innerHTML = "";
    stepEl.textContent = "";
    nextBtn.hidden = true;
    endBtn.hidden = true;
    swap(card);
  }

  function renderStep() {
    if (!active) return;
    const transcript = active.transcript || [];
    const totalAsked = transcript.length + (active.pending ? 1 : 0);
    const step = active.currentStep || 0;
    const isReview = active.stitched && step >= totalAsked;

    // Progress dots: one per asked-or-answered slot, plus a "review"
    // pip when a stitched essay exists.
    progressEl.innerHTML = "";
    const slots = totalAsked + (active.stitched ? 1 : 0);
    for (let i = 0; i < slots; i++) {
      const d = document.createElement("span");
      d.className = "progress-dot";
      if (i === step) d.dataset.active = "";
      if (i < step) d.dataset.done = "";
      progressEl.appendChild(d);
    }

    stepEl.textContent = isReview
      ? "Review"
      : `Question ${Math.min(step + 1, Math.max(totalAsked, 1))}`;

    nextBtn.hidden = false;
    nextBtn.disabled = false;
    endBtn.hidden = false;
    refreshEndButton();

    if (isReview) {
      // A stitched essay is ready (e.g. a draft reopened after stitching).
      // The Save step is gone, so it publishes straight through.
      doPublish();
    } else if (step < transcript.length) {
      renderAnsweredCard(transcript[step], step);
    } else if (active.pending) {
      renderPendingQuestion(active.pending);
    } else {
      // No pending and no answered card at this step → ask Claude for one.
      renderLoading("Asking the next question…");
      askNext().catch((err) => renderError(err));
    }
  }

  function refreshEndButton() {
    if (!active) return;
    const ta = stage.querySelector(".writing-input");
    const hasPrior = (active.transcript || []).length > 0;
    const hasNow = ta && ta.value.trim().length > 0;
    endBtn.disabled = !hasPrior && !hasNow;
  }

  function renderPendingQuestion(question) {
    const card = document.createElement("div");
    card.className = "writing-card";

    if (active.seed || active.facing || active.lastPurchased) {
      const recall = document.createElement("div");
      recall.className = "writing-recall";
      const parts = [];
      if (active.seed) {
        parts.push(
          `<div class="writing-recall__line"><img class="writing-recall__pin" src="./icons/tinker-mark.svg" alt="" aria-hidden="true" /><span class="writing-recall__text">${escapeHtml(active.seed)}</span></div>`
        );
      }
      if (active.facing) {
        parts.push(
          `<div class="writing-recall__line"><span class="writing-recall__label">facing</span><span class="writing-recall__text">${escapeHtml(active.facing)}</span></div>`
        );
      }
      if (active.lastPurchased) {
        parts.push(
          `<div class="writing-recall__line"><span class="writing-recall__label">purchased</span><span class="writing-recall__text">${escapeHtml(active.lastPurchased)}</span></div>`
        );
      }
      recall.innerHTML = parts.join("");
      card.appendChild(recall);
    }

    const q = document.createElement("h2");
    q.className = "writing-question";
    q.textContent = question;
    card.appendChild(q);

    const ta = document.createElement("textarea");
    ta.className = "writing-input";
    ta.placeholder = "Type your answer in your own words…";
    ta.rows = 8;
    ta.autofocus = true;
    // Restore in-progress draft answer for this slot if one exists.
    ta.value = (active._scratch && active._scratch[question]) || "";
    let scratchTimer;
    ta.addEventListener("input", () => {
      active._scratch = active._scratch || {};
      active._scratch[question] = ta.value;
      refreshEndButton();
      // Debounce persistence so we don't write to localStorage on every keystroke.
      clearTimeout(scratchTimer);
      scratchTimer = setTimeout(() => persist(), 350);
    });
    ta.addEventListener("keydown", (e) => {
      // Cmd/Ctrl+Enter advances. Plain Enter creates a new line.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        commitAnswer(question, ta.value);
      }
    });
    card.appendChild(ta);

    nextBtn.textContent = "Next →";
    nextBtn.onclick = () => commitAnswer(question, ta.value);
    endBtn.onclick = () => endNow(question, ta.value);

    swap(card);
    setTimeout(() => ta.focus(), 30);
  }

  function renderAnsweredCard(turn, idx) {
    const card = document.createElement("div");
    card.className = "writing-card";

    const q = document.createElement("h2");
    q.className = "writing-question";
    q.textContent = turn.q;
    card.appendChild(q);

    const ta = document.createElement("textarea");
    ta.className = "writing-input";
    ta.rows = 8;
    ta.value = turn.a;
    card.appendChild(ta);

    const note = document.createElement("div");
    note.className = "writing-note";
    note.textContent = "Editing this answer will rebuild the essay below from your latest words.";
    card.appendChild(note);

    nextBtn.textContent = "Next →";
    nextBtn.onclick = () => {
      const next = ta.value;
      if (next !== turn.a) {
        turn.a = next;
        // Edits invalidate downstream stitched output so the engine
        // re-stitches from the new corpus.
        active.stitched = null;
        persist();
      }
      active.currentStep = idx + 1;
      persist();
      renderStep();
    };
    endBtn.onclick = () => {
      // Capture the (possibly edited) text for this turn before stitching.
      const next = ta.value.trim();
      if (next && next !== turn.a) {
        turn.a = next;
        active.stitched = null;
        persist();
      }
      endNow(null, "");
    };

    swap(card);
  }

  function renderLoading(text) {
    const card = document.createElement("div");
    card.className = "writing-card writing-card--loading";
    card.innerHTML =
      `<div class="thinking-dots" aria-hidden="true">` +
      `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>` +
      `</div>` +
      `<div class="writing-loading__text">${escapeHtml(text)}</div>`;
    nextBtn.disabled = true;
    endBtn.disabled = true;
    swap(card);
  }

  function renderError(err) {
    const card = document.createElement("div");
    card.className = "writing-card writing-card--error";
    const msg = (err && err.message) || "Something went wrong.";
    card.innerHTML =
      `<h2 class="writing-question">Couldn't reach Claude.</h2>` +
      `<pre class="writing-error">${escapeHtml(msg)}</pre>` +
      (err && err.code === "MISSING_API_KEY"
        ? `<div class="writing-note">Open the browser inspector and run:<br/>` +
          `<code>localStorage.setItem('ANTHROPIC_API_KEY', 'sk-ant-…')</code>` +
          `<br/>then reload this draft.</div>`
        : `<div class="writing-note">Try again, or close this draft to come back later.</div>`);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "writing-action writing-action--primary";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => renderStep());
    card.appendChild(retry);
    nextBtn.hidden = true;
    endBtn.hidden = true;
    swap(card);
  }

  function swap(node) {
    stage.innerHTML = "";
    stage.appendChild(node);
  }

  // ── Engine ──────────────────────────────────────────────────────────
  function commitAnswer(question, answer) {
    const a = (answer || "").trim();
    if (!a) {
      // Allow skipping with empty text? Not for v1 — the essay must be
      // built from real answers.
      return;
    }
    active.transcript = active.transcript || [];
    active.transcript.push({ q: question, a });
    active.pending = null;
    active.currentStep = active.transcript.length;
    if (active._scratch) delete active._scratch[question];
    if (active.transcript.length === 1) {
      active.title = firstSentence(a) || active.title;
    }
    persist();
    renderLoading("Thinking through what to ask next…");
    askNext().catch((err) => renderError(err));
  }

  /** Founder pressed "This is everything" — capture any half-typed answer
   *  and force the engine straight into stitch mode. */
  function endNow(question, answer) {
    if (!active) return;
    const a = (answer || "").trim();
    if (a) {
      active.transcript = active.transcript || [];
      active.transcript.push({ q: question, a });
      if (active._scratch) delete active._scratch[question];
      if (active.transcript.length === 1) {
        active.title = firstSentence(a) || active.title;
      }
    }
    if (!active.transcript || active.transcript.length === 0) {
      // Nothing to stitch from — keep the question on screen.
      return;
    }
    active.pending = null;
    active.stitched = null;
    active.currentStep = active.transcript.length;
    persist();
    renderLoading("Stitching your essay…");
    askNext({ forceStitch: true }).catch((err) => renderError(err));
  }

  async function askNext({ forceStitch = false } = {}) {
    if (!active) return;
    if (!window.tinker || typeof window.tinker.callClaude !== "function") {
      throw new Error("Anthropic client unavailable. Reload the page.");
    }
    const userMessage = buildUserMessage(active.transcript || [], { forceStitch });
    // Fold the founder's learned writing voice into the system prompt so
    // the questions are phrased in their own voice (RULE 10). No voice yet
    // → the canonical system prompt, unchanged.
    const voice = voiceBlock();
    const system = voice ? `${SYSTEM_PROMPT}\n\n${voice}` : SYSTEM_PROMPT;
    const result = await window.tinker.callClaude({
      system,
      messages: [{ role: "user", content: userMessage }],
      model: "claude-opus-4-8",
      maxTokens: 2048,
    });
    const parsed = parseClaude(result.text);
    const stitchNow = (parsed.done && parsed.stitched_body) || forceStitch;

    if (stitchNow) {
      // Hard verify: stitched body must use only words the founder typed.
      const corpus = (active.transcript || []).map((t) => t.a).join("\n\n");
      let body = parsed.stitched_body || "";
      let title = parsed.stitched_title || active.title || "Untitled";
      const verified = body ? verifyFounderOnly(body, active.transcript) : { ok: false };
      if (!body || !verified.ok) {
        // Strict fallback: build the essay from the founder's raw answers
        // joined by paragraph breaks. Boring, but provably founder-only.
        body = (active.transcript || []).map((t) => t.a.trim()).filter(Boolean).join("\n\n");
        const titleVerified = phraseAppearsIn(title, corpus);
        if (!titleVerified) title = firstSentence(body) || "Untitled";
      }
      active.stitched = { title, body };
      active.title = title;
      active.pending = null;
      active.currentStep = (active.transcript || []).length;
      persist();
      // No "review + Save" step: once the essay is stitched it publishes
      // straight away. The founder already wrote every word in the
      // interview; the post-publish "being assessed" screen is the next
      // surface they see (and they can still open the essay to read it).
      doPublish();
      return;
    }

    const q = parsed.next_question || "What else feels true about this?";
    active.pending = q;
    active.currentStep = (active.transcript || []).length;
    persist();
    renderStep();
  }

  function buildTransactionsContext() {
    const api = window.tinkerTransactions;
    if (!api || typeof api.list !== "function") return [];
    const all = api.list();
    if (!all.length) return [];
    // Cap at the 25 most recent so we don't blow context budget. Render
    // oldest-first so Claude sees a chronological run.
    const recent = all.slice(0, 25).reverse();
    return recent.map((t) => {
      const v = Number(t.amount);
      const amt = Number.isFinite(v) ? `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}` : "";
      const cat = t.category ? ` [${t.category}]` : "";
      return `- ${t.date} ${t.merchant} ${amt}${cat}`;
    });
  }

  function buildUncoveredPitchLines() {
    const tree = window.tinkerTree;
    if (!tree || typeof tree.uncoveredHeadings !== "function") return [];
    let uncovered;
    try { uncovered = tree.uncoveredHeadings(); }
    catch { return []; }
    if (!Array.isArray(uncovered) || uncovered.length === 0) return [];
    return [
      `Starter-pitch slides the founder hasn't written into yet: ${uncovered.join(", ")}.`,
    ];
  }

  function buildUserMessage(transcript, { forceStitch = false } = {}) {
    const lines = [];
    if (active && active.seed) {
      lines.push(`Where the founder is right now: ${active.seed}`);
    }
    if (active && active.facing) {
      lines.push(`What the founder is facing: ${active.facing}`);
    }
    if (active && active.lastPurchased) {
      lines.push(`What the founder last purchased: ${active.lastPurchased}`);
    }
    const txLines = buildTransactionsContext();
    if (txLines.length) {
      if (lines.length) lines.push("");
      lines.push("Recent transactions:");
      lines.push(...txLines);
    }
    const uncoveredLines = buildUncoveredPitchLines();
    if (uncoveredLines.length) {
      if (lines.length) lines.push("");
      lines.push(...uncoveredLines);
    }
    if (lines.length) lines.push("");
    if (!transcript || transcript.length === 0) {
      lines.push("The founder just opened a new draft. Begin the interview.");
      return lines.join("\n");
    }
    lines.push("Conversation so far (the founder's answers are verbatim — do not paraphrase):", "");
    transcript.forEach((t, i) => {
      lines.push(`Q${i + 1}: ${t.q}`);
      lines.push(`A${i + 1}: ${t.a}`);
      lines.push("");
    });
    if (forceStitch) {
      lines.push(
        "The founder has signaled they are done — they pressed \"This is everything\". Skip any further questions and produce the stitched essay now. Set next_question to null, fill stitched_title and stitched_body using only the founder's typed words, and set done to true."
      );
    } else {
      lines.push("Decide whether to ask another question or to stitch. Respond with the JSON object only.");
    }
    return lines.join("\n");
  }

  function parseClaude(text) {
    const trimmed = (text || "").trim();
    // Tolerate accidental fencing.
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
      return { next_question: stripped.slice(0, 240), stitched_title: null, stitched_body: null, done: false };
    }
  }

  // ── Founder-only verification ─────────────────────────────────────────
  //
  // The strongest constraint in tinker: the published essay uses only
  // words the founder has typed. We check this by tokenising both the
  // stitched body and the founder's combined answers, then asserting
  // every token in the body appears in the founder's corpus. We allow a
  // tiny stop-list of pure punctuation/whitespace and the words
  // "i" / "a" / "the" because the model often capitalises differently.
  //
  // This is intentionally strict and could false-positive on very
  // short answers. The fallback path (when verification fails) just
  // joins the founder's raw answers with paragraph breaks.

  function tokens(s) {
    return String(s || "")
      .toLowerCase()
      .match(/[a-z0-9'']+/g) || [];
  }
  function verifyFounderOnly(stitched, transcript) {
    const corpus = (transcript || []).map((t) => t.a).join(" ");
    const have = new Set(tokens(corpus));
    const need = tokens(stitched);
    const foreign = [];
    for (const w of need) {
      if (!have.has(w)) foreign.push(w);
    }
    return { ok: foreign.length === 0, foreign };
  }
  function phraseAppearsIn(phrase, corpus) {
    const c = corpus.toLowerCase().replace(/\s+/g, " ");
    const p = (phrase || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!p) return false;
    return c.includes(p);
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function firstSentence(text) {
    const s = String(text || "").trim();
    const m = s.match(/^[^.!?\n]{1,80}[.!?]?/);
    return m ? m[0].trim() : s.slice(0, 60);
  }

  // ── Top-bar wiring ──────────────────────────────────────────────────
  closeBtn.addEventListener("click", () => {
    // Snapshot the active draft id before we hand off — the renderer
    // clears `active` synchronously. The classifier runs in the
    // background; the sidebar tree picks up the result on next paint.
    const closingId = active && active.id;
    if (typeof window.tinkerOnWritingClose === "function") {
      window.tinkerOnWritingClose();
    }
    if (closingId) {
      try {
        window.dispatchEvent(new CustomEvent("tinker:writing-saved", {
          detail: { writingId: closingId },
        }));
      } catch { /* ignore */ }
    }
  });

  // Default Next click is wired per-card; if a render path forgot to
  // set onclick, fall through to "no-op".
  nextBtn.addEventListener("click", (e) => {
    if (!nextBtn.onclick) e.preventDefault();
  });
  endBtn.addEventListener("click", (e) => {
    if (!endBtn.onclick) e.preventDefault();
  });

  function doPublish() {
    if (!active || !active.stitched) return;
    if (typeof window.tinkerOnWritingPublish !== "function") return;
    window.tinkerOnWritingPublish(active, {
      title: active.stitched.title,
      body: active.stitched.body,
      author: "you",
    });
    active = null;
  }
})();
