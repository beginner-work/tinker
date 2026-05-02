// Onboarding feed screen — replaces the previous chat-thread implementation.
//
// Renders Claude's onboarding interview as a stack of cards: each card holds
// one question, and once answered, the card locks and a new card streams in
// below it. The composer is embedded in the active card so focus + scroll
// position stays anchored where the user is acting.
//
// History is sent on every /claude/chat call (the backend is stateless). The
// first user message is a hidden primer that orients Claude — it's part of the
// API payload but never rendered as a card.
//
// TODO: persist history + cards across launches via main process.

import { startChat, streamSse } from "./api.js";

const ONBOARDING_PRIMER = `You are tinker's onboarding interviewer. The user just opened tinker for the first time and you're getting to know them — what they're working on, what brought them here, what would make this app feel like theirs. Ask one warm, open question at a time. Acknowledge their previous answer briefly (one short sentence) before posing the next, but skip the acknowledgement on your very first question. Keep each turn short and unhurried — three sentences max, often one. After six to ten questions, when you have a sense of them, ask if they'd like to keep going or wrap up here. Don't introduce yourself in detail; let the questions do the work.

Begin with your first question now — a single, open prompt that invites them in.`;

export function mountChat({ token, user, onLogout, on401 }) {
  // Conversation history sent verbatim to /claude/chat. The first user
  // message is the hidden primer; everything after is real Q/A turns.
  const history = [{ role: "user", content: ONBOARDING_PRIMER }];
  let abortController = null;

  const cardsEl = document.getElementById("feed-cards");
  const bannerEl = document.getElementById("feed-banner");
  const userEl = document.getElementById("feed-user");
  const logoutBtn = document.getElementById("feed-logout");
  const feedEl = document.querySelector(".feed");

  userEl.textContent = user?.email || "";

  logoutBtn.addEventListener("click", () => {
    abortController?.abort();
    onLogout();
  });

  function setBanner(text, kind) {
    if (!text) {
      bannerEl.hidden = true;
      bannerEl.textContent = "";
      bannerEl.className = "feed-banner";
      return;
    }
    bannerEl.textContent = text;
    bannerEl.className = `feed-banner${kind ? ` feed-banner--${kind}` : ""}`;
    bannerEl.hidden = false;
  }

  function scrollToBottom() {
    if (feedEl) feedEl.scrollTop = feedEl.scrollHeight;
  }

  function createCard(index) {
    const card = document.createElement("article");
    card.className = "feed-card";
    card.dataset.state = "streaming";
    card.dataset.index = String(index);

    const num = document.createElement("div");
    num.className = "feed-card__num";
    num.textContent = String(index);

    const q = document.createElement("div");
    q.className = "feed-card__q";

    // Streaming cursor — replaced with the final question text after the
    // stream ends. Sits as the only child so we can prepend a text node.
    const cursor = document.createElement("span");
    cursor.className = "feed-card__cursor";
    q.appendChild(cursor);

    card.appendChild(num);
    card.appendChild(q);
    cardsEl.appendChild(card);

    return { card, q };
  }

  function attachComposer(card) {
    const form = document.createElement("form");
    form.className = "feed-card__composer";

    const textarea = document.createElement("textarea");
    textarea.rows = 1;
    textarea.placeholder = "Your answer…";
    textarea.setAttribute("aria-label", "Your answer");

    const button = document.createElement("button");
    button.type = "submit";
    button.className = "feed-card__send";
    button.setAttribute("aria-label", "Send");
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M3 12l18-9-7 18-3-8-8-1z" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round" fill="none" /></svg>';

    form.appendChild(textarea);
    form.appendChild(button);
    card.appendChild(form);

    function autoResize() {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
    textarea.addEventListener("input", autoResize);
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;
      submitAnswer(card, form, text);
    });

    // Defer focus so the new card has settled into layout before the
    // textarea pulls focus (otherwise the scroll-into-view fights with it).
    requestAnimationFrame(() => textarea.focus());
  }

  function lockCard(card, answerText) {
    const composer = card.querySelector(".feed-card__composer");
    composer?.remove();
    const a = document.createElement("div");
    a.className = "feed-card__a";
    a.textContent = answerText;
    card.appendChild(a);
    card.dataset.state = "done";
  }

  function submitAnswer(card, form, text) {
    const textarea = form.querySelector("textarea");
    const button = form.querySelector("button");
    textarea.disabled = true;
    button.disabled = true;
    lockCard(card, text);
    history.push({ role: "user", content: text });
    askNext();
  }

  // Question count = number of assistant turns we've recorded so far + 1
  // for the one we're about to fetch. The hidden primer doesn't count.
  function nextIndex() {
    return history.filter((m) => m.role === "assistant").length + 1;
  }

  async function askNext() {
    const { card, q } = createCard(nextIndex());
    setBanner(null);
    scrollToBottom();

    let qText = "";
    abortController = new AbortController();

    let res;
    try {
      res = await startChat({
        token,
        messages: history,
        signal: abortController.signal,
      });
    } catch (err) {
      card.remove();
      setBanner(`Network error: ${err.message}`);
      return;
    }

    if (res.status === 200) {
      try {
        await streamSse(res, {
          onText: (delta) => {
            qText += delta;
            // Keep the cursor at the end while streaming. We mutate a
            // single text node sitting before the cursor span instead of
            // re-rendering the whole question on every delta.
            let textNode = q.firstChild;
            if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
              textNode = document.createTextNode("");
              q.insertBefore(textNode, q.firstChild);
            }
            textNode.nodeValue = qText;
            scrollToBottom();
          },
          onError: (err) => {
            setBanner(`Stream error: ${err.message}`);
          },
          onDone: () => {
            const cursor = q.querySelector(".feed-card__cursor");
            cursor?.remove();
            history.push({ role: "assistant", content: qText });
            attachComposer(card);
            scrollToBottom();
          },
        });
      } catch (err) {
        setBanner(`Stream interrupted: ${err.message}`);
      }
      return;
    }

    // Non-200: JSON error envelope. Pull the in-flight card so the feed
    // doesn't end on a blank question.
    let body = {};
    try { body = await res.json(); } catch {}
    card.remove();

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
      return;
    }
    if (res.status === 503) {
      setBanner("Server misconfigured — contact admin.", "server");
      return;
    }
    setBanner(`Error ${res.status}: ${body.error || "unknown"}`);
  }

  // Kick off the first question on mount.
  askNext();
}
