// Onboarding flow for founders prepping a seed-investor pitch.
//
// Single focal question card (TikTok-ish — one at a time, no scrollback)
// alongside a persistent "Your offering" pane (Instagram-ish — always
// visible, refines as answers come in). Claude streams a structured
// response per turn; we parse out <offering>...</offering> and
// <question>...</question> tags live and route them to the right pane.
// When Claude emits <done/>, the question card flips to a completion
// state with a copy button for the final offering.
//
// History is sent on every /claude/chat call (backend is stateless).
// The first user message is a hidden primer that sets the format and
// the interviewer's brief — never rendered.
//
// State persists across launches as an encrypted JSON blob in userData
// (via safeStorage IPC). Restoration is gated on the JWT's claudeUserId
// so a different user signing in on the same machine starts fresh.

import { startChat, streamSse } from "./api.js";

const PRIMER = `You are tinker's onboarding interviewer for founders preparing to describe their offering to potential seed investors. Your job is to extract, through warm one-question-at-a-time conversation, enough material to write a single clear paragraph that captures: what they're building, who it's for, the problem it solves, why now, why them, traction so far, and what they're seeking from a seeder.

Respond in this exact format on every turn:

<offering>
[A current best one-paragraph description of their offering, in third person, suitable to show a seed investor. Refine and rewrite this every turn as you learn more. On the first turn you know nothing — write a brief placeholder noting you're getting to know them. Never invent facts; if you don't know something, leave it out or say so plainly.]
</offering>

<question>
[Your next question. One warm, open prompt. Pick the gap most worth filling next from: what they're building, who it's for, the problem, why now, why them, traction, what they need. Three sentences max, often one.]
</question>

When the offering paragraph feels complete and specific (typically after six to ten questions, when you have enough material that a seeder could understand the bet), end your turn with this instead of <question>:

<offering>
[Final, polished paragraph]
</offering>
<done/>

If the user signals they want to wrap up early (anything like "I'm done", "that's all", "finalize"), produce one last polished <offering> and <done/> immediately, drawing on whatever you have.

Begin now — the user hasn't said anything yet. Your first <offering> is a brief placeholder; your first <question> is an open invitation to describe what they're building or what they want to share with seeders.`;

// User-side trigger when the "I'm done" button is pressed. Plain English so
// even if the model drifts from the format, it understands the intent.
const FINISH_REQUEST = "I'm done — please finalize my offering now and emit <done/>.";

const SAVE_VERSION = 1;

// Parse Claude's tagged output. Lenient about closing tags so partial
// streams (e.g., <offering>blah blah, no </offering> yet) still surface
// the visible content as it arrives.
const TAG_OFFER = /<offering>([\s\S]*?)(?:<\/offering>|$)/;
const TAG_QUESTION = /<question>([\s\S]*?)(?:<\/question>|$)/;
const TAG_DONE = /<done\s*\/?>/;

function parse(raw) {
  const offer = (raw.match(TAG_OFFER) || [])[1] || "";
  const question = (raw.match(TAG_QUESTION) || [])[1] || "";
  return {
    offering: offer.trim(),
    question: question.trim(),
    done: TAG_DONE.test(raw),
  };
}

export function mountChat({ token, user, onLogout, on401 }) {
  const myUserId = user?.id || null;
  const history = [{ role: "user", content: PRIMER }];
  let offering = "";
  let abortController = null;
  let turnCount = 0;
  let isDone = false;

  // DOM
  const screenEl = document.getElementById("screen-chat");
  const numEl = document.getElementById("work-num");
  const qEl = document.getElementById("work-q");
  const composerEl = document.getElementById("work-composer");
  const inputEl = document.getElementById("work-input");
  const sendBtn = document.getElementById("work-send");
  const finishBtn = document.getElementById("work-finish");
  const offeringEl = document.getElementById("work-offering");
  const userEl = document.getElementById("work-user");
  const logoutBtn = document.getElementById("work-logout");
  const bannerEl = document.getElementById("work-banner");
  const cardEl = document.querySelector(".work-question");

  userEl.textContent = user?.email || "";

  logoutBtn.addEventListener("click", () => {
    abortController?.abort();
    onLogout();
  });

  composerEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    submitAnswer(text);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composerEl.requestSubmit();
    }
  });
  inputEl.addEventListener("input", autoResize);
  function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
  }

  if (finishBtn) {
    finishBtn.addEventListener("click", () => {
      if (finishBtn.disabled || isDone) return;
      // Sends a synthetic answer that asks Claude to wrap up. Claude's
      // primer already handles this case → expect <done/> in the response.
      submitAnswer(FINISH_REQUEST, { hidden: true });
    });
  }

  function persist() {
    if (!myUserId) return;
    window.api
      .setOnboarding({
        version: SAVE_VERSION,
        userId: myUserId,
        history,
        offering,
        done: isDone,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});
  }

  function setBanner(text, kind) {
    if (!text) {
      bannerEl.hidden = true;
      bannerEl.textContent = "";
      bannerEl.className = "work-question__hint";
      return;
    }
    bannerEl.textContent = text;
    bannerEl.className = `work-question__hint${kind ? ` work-question__hint--${kind}` : ""}`;
    bannerEl.hidden = false;
  }

  function setQuestion(text, { streaming } = {}) {
    qEl.textContent = "";
    if (text) qEl.appendChild(document.createTextNode(text));
    if (streaming) {
      const cursor = document.createElement("span");
      cursor.className = "work-question__cursor";
      qEl.appendChild(cursor);
    }
  }

  function setOffering(text) {
    if (!text) return;
    offering = text;
    offeringEl.classList.remove("work-offer__placeholder");
    offeringEl.textContent = text;
  }

  function setComposerEnabled(enabled) {
    inputEl.disabled = !enabled;
    sendBtn.disabled = !enabled;
    if (finishBtn) finishBtn.disabled = !enabled;
  }

  function showDone(finalOffering) {
    isDone = true;
    if (finalOffering) setOffering(finalOffering);

    // Replace the question card body with a completion state. Keeps the
    // offering pane intact next to it.
    cardEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "work-done";
    wrap.innerHTML =
      '<div class="work-done__check" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12l5 5 9-11" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
      'stroke-linejoin="round" fill="none"/></svg></div>' +
      '<h2 class="work-done__title">Your offering is ready.</h2>' +
      '<p class="work-done__sub">Copy it out and share it with seeders.</p>' +
      '<div class="work-done__actions">' +
      '<button class="work-done__copy" id="work-done-copy" type="button">Copy offering</button>' +
      '<button class="work-done__restart" id="work-done-restart" type="button">Start over</button>' +
      "</div>";
    cardEl.appendChild(wrap);

    document.getElementById("work-done-copy").addEventListener("click", async (e) => {
      const text = offering || offeringEl.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        e.target.textContent = "Copied";
        setTimeout(() => { e.target.textContent = "Copy offering"; }, 1500);
      } catch {
        e.target.textContent = "Copy failed";
      }
    });

    document.getElementById("work-done-restart").addEventListener("click", async () => {
      await window.api.clearOnboarding().catch(() => {});
      location.reload();
    });

    persist();
  }

  function submitAnswer(text, { hidden = false } = {}) {
    history.push({ role: "user", content: text });
    if (!hidden) inputEl.value = "";
    autoResize();
    setComposerEnabled(false);
    setBanner(null);

    // Animate the current card out, swap to streaming state, fetch next.
    screenEl.dataset.phase = "advance";
    setTimeout(() => {
      screenEl.dataset.phase = "loading";
      askNext();
    }, 220);
  }

  async function askNext() {
    setQuestion("", { streaming: true });
    numEl.textContent = String(turnCount + 1);

    let raw = "";
    abortController = new AbortController();

    let res;
    try {
      res = await startChat({
        token,
        messages: history,
        signal: abortController.signal,
      });
    } catch (err) {
      setBanner(`Network error: ${err.message}`);
      setComposerEnabled(true);
      screenEl.dataset.phase = "idle";
      return;
    }

    if (res.status === 200) {
      try {
        await streamSse(res, {
          onText: (delta) => {
            raw += delta;
            const parsed = parse(raw);
            if (parsed.offering) setOffering(parsed.offering);
            if (parsed.question) setQuestion(parsed.question, { streaming: true });
          },
          onError: (err) => setBanner(`Stream error: ${err.message}`),
          onDone: () => {
            turnCount++;
            history.push({ role: "assistant", content: raw });
            const parsed = parse(raw);
            if (parsed.offering) setOffering(parsed.offering);

            if (parsed.done) {
              screenEl.dataset.phase = "done";
              showDone(parsed.offering);
              return;
            }

            setQuestion(parsed.question || "", { streaming: false });
            setComposerEnabled(true);
            screenEl.dataset.phase = "idle";
            persist();
            requestAnimationFrame(() => inputEl.focus());
          },
        });
      } catch (err) {
        setBanner(`Stream interrupted: ${err.message}`);
        setComposerEnabled(true);
        screenEl.dataset.phase = "idle";
      }
      return;
    }

    // Non-200 — JSON envelope per spec.
    let body = {};
    try { body = await res.json(); } catch {}
    screenEl.dataset.phase = "idle";

    if (res.status === 401) {
      on401();
      return;
    }
    if (res.status === 429) {
      const when = body.retry_at ? new Date(body.retry_at) : null;
      const localTime = when && !isNaN(when.getTime())
        ? when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "later";
      setBanner(`Daily limit reached, resets at ${localTime}.`);
      setComposerEnabled(true);
      return;
    }
    if (res.status === 503) {
      setBanner("Server misconfigured — contact admin.", "server");
      setComposerEnabled(true);
      return;
    }
    setBanner(`Error ${res.status}: ${body.error || "unknown"}`);
    setComposerEnabled(true);
  }

  // ── Boot: try to restore a saved session ─────────────────────────────
  //
  // If the saved session belongs to this user and isn't done, we replay
  // history into memory, paint the last assistant turn (offering +
  // question) and let the user pick up where they left off — no
  // duplicate /claude/chat call.
  async function boot() {
    let saved = null;
    try {
      saved = await window.api.getOnboarding();
    } catch {}

    if (saved && saved.userId === myUserId && Array.isArray(saved.history) && saved.history.length > 1) {
      history.length = 0;
      history.push(...saved.history);
      turnCount = saved.history.filter((m) => m.role === "assistant").length;
      if (saved.offering) setOffering(saved.offering);

      if (saved.done) {
        screenEl.dataset.phase = "done";
        showDone(saved.offering || "");
        return;
      }

      // Render the most recent assistant question and re-enable composer.
      const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) {
        const parsed = parse(lastAssistant.content);
        setQuestion(parsed.question || "");
        numEl.textContent = String(turnCount);
        setComposerEnabled(true);
        screenEl.dataset.phase = "idle";
        requestAnimationFrame(() => inputEl.focus());
        return;
      }
    } else if (saved && saved.userId && saved.userId !== myUserId) {
      // Different user on the same machine — clear stale state.
      window.api.clearOnboarding().catch(() => {});
    }

    // No usable saved session → kick off the first question.
    screenEl.dataset.phase = "loading";
    askNext();
  }

  boot();
}
