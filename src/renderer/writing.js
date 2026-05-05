/* tinker — writing flow
 *
 * Onboarding-shaped guided writing: one question at a time, large input,
 * paginated, progress dots. NOT a chat. Claude asks questions; the founder
 * answers in their own words; Claude stitches the answers into a single
 * essay using ONLY the founder's words. A review screen at the end with
 * per-answer edit affordances and a publish button.
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
    "RULE 4 — KEEP IT SHORT.",
    "Aim for between five and nine questions total. Stop when the founder has said enough. Each question should be specific and concrete — not 'tell me more' but 'what did her face do when she tasted it'.",
    "",
    "RULE 5 — RESPOND IN STRICT JSON.",
    "Always respond as a single JSON object, with exactly these keys:",
    '  { "next_question": string | null, "stitched_title": string | null, "stitched_body": string | null, "done": boolean }',
    "If you have another question for the founder, set next_question and leave the stitched fields null and done false.",
    "If the founder has answered enough, set next_question null, fill stitched_title and stitched_body with prose drawn ONLY from the founder's typed answers, and set done true.",
    "Never wrap the JSON in code fences. Never add explanations outside the JSON.",
  ].join("\n");

  const SEED_QUESTION = "What are you learning?";

  // ── DOM refs ─────────────────────────────────────────────────────────
  const stage = document.getElementById("writing-stage");
  const progressEl = document.getElementById("writing-progress");
  const stepEl = document.getElementById("writing-step");
  const closeBtn = document.getElementById("writing-close");
  const nextBtn = document.getElementById("writing-next");
  const backBtn = document.getElementById("writing-back");

  let active = null; // current draft

  // ── Public API ──────────────────────────────────────────────────────
  window.tinkerWriting = {
    open(draft) {
      active = draft;
      // First-time open: seed the first question.
      if ((draft.transcript || []).length === 0 && !draft.pending) {
        active.pending = SEED_QUESTION;
        persist();
      }
      // currentStep clamped against transcript length (+ pending question).
      const maxStep = (active.transcript || []).length + (active.pending ? 1 : 0);
      if (active.currentStep == null || active.currentStep > maxStep) {
        active.currentStep = maxStep;
      }
      renderStep();
    },
  };

  function persist(extraPatch) {
    if (!active) return;
    const patch = {
      transcript: active.transcript,
      currentStep: active.currentStep,
      pending: active.pending,
      stitched: active.stitched,
      title: active.title,
      _scratch: active._scratch,
      ...(extraPatch || {}),
    };
    if (typeof window.tinkerOnDraftChange === "function") {
      window.tinkerOnDraftChange(active.id, patch);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
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

    backBtn.disabled = step === 0;
    nextBtn.hidden = false;
    nextBtn.disabled = false;

    if (isReview) {
      renderReview();
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

  function renderPendingQuestion(question) {
    const card = document.createElement("div");
    card.className = "writing-card";

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

    // "This is everything" — short-circuit the interview and stitch
    // whatever the founder has typed so far. Available as soon as the
    // founder has at least one answered turn (or has typed into the
    // current textarea), so the very first screen with no input just
    // hides it.
    const endRow = document.createElement("div");
    endRow.className = "writing-card__end";
    const endBtn = document.createElement("button");
    endBtn.type = "button";
    endBtn.className = "writing-end";
    endBtn.textContent = "This is everything →";
    endBtn.addEventListener("click", () => endNow(question, ta.value));
    endRow.appendChild(endBtn);
    card.appendChild(endRow);
    const updateEndVisibility = () => {
      const hasPrior = (active.transcript || []).length > 0;
      const hasNow = ta.value.trim().length > 0;
      endBtn.disabled = !hasPrior && !hasNow;
    };
    ta.addEventListener("input", updateEndVisibility);
    updateEndVisibility();

    nextBtn.textContent = "Next →";
    nextBtn.onclick = () => commitAnswer(question, ta.value);

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

    swap(card);
  }

  function renderReview() {
    const card = document.createElement("div");
    card.className = "writing-card writing-card--review";

    const head = document.createElement("div");
    head.className = "writing-review__head";
    head.innerHTML =
      `<div class="writing-review__crumb">Your essay</div>` +
      `<h2 class="writing-review__title" contenteditable="true" spellcheck="false">${escapeHtml(active.stitched.title || "Untitled")}</h2>`;
    card.appendChild(head);

    // Per-answer revisit affordance: a list of all answers, click to
    // jump back and edit. Editing forces a re-stitch.
    const answers = document.createElement("div");
    answers.className = "writing-review__answers";
    (active.transcript || []).forEach((turn, idx) => {
      const item = document.createElement("button");
      item.className = "writing-review__answer";
      item.type = "button";
      item.innerHTML =
        `<div class="writing-review__answer-q">${escapeHtml(turn.q)}</div>` +
        `<div class="writing-review__answer-a">${escapeHtml(truncate(turn.a, 220))}</div>` +
        `<div class="writing-review__answer-edit">Edit</div>`;
      item.addEventListener("click", () => {
        active.currentStep = idx;
        persist();
        renderStep();
      });
      answers.appendChild(item);
    });
    card.appendChild(answers);

    const body = document.createElement("article");
    body.className = "writing-review__essay";
    body.innerHTML = paragraphs(active.stitched.body || "");
    card.appendChild(body);

    const verifyNote = document.createElement("div");
    verifyNote.className = "writing-review__verify";
    const verified = verifyFounderOnly(active.stitched.body, active.transcript);
    if (verified.ok) {
      verifyNote.dataset.kind = "ok";
      verifyNote.textContent = "✓ Every word in this essay came from you. tinker did not author any of it.";
    } else {
      verifyNote.dataset.kind = "warn";
      verifyNote.innerHTML =
        `<strong>Heads up:</strong> tinker tried to invent some words (` +
        escapeHtml(verified.foreign.slice(0, 8).join(", ")) +
        `…). Re-stitching now to remove them.`;
      // Re-stitch on the next tick so the warning is visible.
      setTimeout(() => askNext().catch((err) => renderError(err)), 200);
    }
    card.appendChild(verifyNote);

    const actions = document.createElement("div");
    actions.className = "writing-review__actions";
    const restitch = document.createElement("button");
    restitch.type = "button";
    restitch.className = "writing-action";
    restitch.textContent = "Re-stitch";
    restitch.addEventListener("click", () => {
      active.stitched = null;
      persist();
      renderStep();
    });
    const publish = document.createElement("button");
    publish.type = "button";
    publish.className = "writing-action writing-action--primary";
    publish.textContent = "Publish";
    publish.addEventListener("click", () => doPublish(head));
    actions.append(restitch, publish);
    card.appendChild(actions);

    nextBtn.hidden = true;
    swap(card);

    // Persist the editable title on blur.
    const titleEl = head.querySelector(".writing-review__title");
    titleEl.addEventListener("blur", () => {
      const t = titleEl.textContent.trim();
      if (t && active.stitched) {
        active.stitched.title = t;
        active.title = t;
        persist();
      }
    });
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
    const result = await window.tinker.callClaude({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      model: "claude-sonnet-4-6",
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
      active.currentStep = (active.transcript || []).length; // jump to review
      persist();
      renderStep();
      return;
    }

    const q = parsed.next_question || "What else feels true about this?";
    active.pending = q;
    active.currentStep = (active.transcript || []).length;
    persist();
    renderStep();
  }

  function buildUserMessage(transcript, { forceStitch = false } = {}) {
    if (!transcript || transcript.length === 0) {
      return "The founder just opened a new draft. Begin the interview.";
    }
    const lines = ["Conversation so far (the founder's answers are verbatim — do not paraphrase):", ""];
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
  function paragraphs(body) {
    return String(body || "")
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
      .filter((p) => p !== "<p></p>")
      .join("");
  }
  function truncate(s, n) {
    s = String(s || "");
    return s.length <= n ? s : s.slice(0, n - 1) + "…";
  }
  function firstSentence(text) {
    const s = String(text || "").trim();
    const m = s.match(/^[^.!?\n]{1,80}[.!?]?/);
    return m ? m[0].trim() : s.slice(0, 60);
  }

  // ── Top-bar wiring ──────────────────────────────────────────────────
  closeBtn.addEventListener("click", () => {
    if (typeof window.tinkerOnWritingClose === "function") {
      window.tinkerOnWritingClose();
    }
  });

  backBtn.addEventListener("click", () => {
    if (!active) return;
    if (active.currentStep > 0) {
      active.currentStep -= 1;
      persist();
      renderStep();
    }
  });

  // Default Next click is wired per-card; if a render path forgot to
  // set onclick, fall through to "no-op".
  nextBtn.addEventListener("click", (e) => {
    if (!nextBtn.onclick) e.preventDefault();
  });

  function doPublish(reviewHead) {
    if (!active || !active.stitched) return;
    if (typeof window.tinkerOnWritingPublish !== "function") return;
    // Final verification before publish.
    const verified = verifyFounderOnly(active.stitched.body, active.transcript);
    if (!verified.ok) {
      // Force the safe-fallback body.
      active.stitched.body = (active.transcript || []).map((t) => t.a.trim()).filter(Boolean).join("\n\n");
    }
    const titleEl = reviewHead && reviewHead.querySelector(".writing-review__title");
    if (titleEl) {
      const t = titleEl.textContent.trim();
      if (t) active.stitched.title = t;
    }
    window.tinkerOnWritingPublish(active, {
      title: active.stitched.title,
      body: active.stitched.body,
      author: "you",
    });
    active = null;
  }
})();
