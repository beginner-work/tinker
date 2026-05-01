/* tinker Web Browser — renderer
 *
 * Session + navigation logic. Each session is either:
 *   - the welcome page (a <section> already in the DOM), or
 *   - a webview that we mount lazily inside the .stage element.
 *
 * State lives in a plain `sessions` array. The DOM is rebuilt from
 * state via `render()`; webviews persist between renders so navigation
 * history isn't lost when sessions are reordered or selection changes.
 */

(() => {
  "use strict";

  const HOME_URL = "tinker://home";
  const SEARCH_PREFIX = "tinker://search?q=";
  const PITCH_URL = "tinker://pitch-deck";

  // First message we seed into the conversation so the model opens with
  // Phase 1 question 1 instead of waiting for the founder to introduce
  // themselves. Treated as a synthetic user turn — never shown.
  const PITCH_KICKOFF =
    "Start the pitch-deck onboarding. Greet me warmly in one short sentence, then ask Phase 1 question 1.";

  /** @type {Array<{id: string, url: string, title: string, loading: boolean, view: HTMLElement | null}>} */
  let sessions = [];
  let activeId = null;

  // ── DOM refs ─────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const stage = $("#stage");
  const welcome = $("#welcome");
  const sessionsEl = $("#sessions");
  const newSessionBtn = $("#new-session");
  const navBack = $("#nav-back");
  const navForward = $("#nav-forward");
  const navReload = $("#nav-reload");
  const navHome = $("#nav-home");
  const loadbar = $("#loadbar");
  const welcomeForm = $("#welcome-form");
  const welcomeInput = $("#welcome-input");

  // ── Helpers ──────────────────────────────────────────────────────────

  const uid = () => "s_" + Math.random().toString(36).slice(2, 9);

  const getActive = () => sessions.find((s) => s.id === activeId) || null;

  /** Decide if a string is a navigable URL or should be searched. */
  function resolveQuery(raw) {
    const text = raw.trim();
    if (!text) return null;
    if (text === "home" || text === "tinker://home") return HOME_URL;
    if (text === "pitch deck" || text === "pitch" || text === PITCH_URL) {
      return PITCH_URL;
    }
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(text)) return text;
    if (/^[a-z]+:/i.test(text)) return text;
    const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(text);
    if (looksLikeHost) return "https://" + text;
    if (text.startsWith("localhost") || /^localhost(:\d+)/.test(text)) {
      return "http://" + text;
    }
    return SEARCH_PREFIX + encodeURIComponent(text);
  }

  // ── Markdown rendering for search results ───────────────────────────
  //
  // Tiny renderer just for what Claude Haiku emits: paragraphs separated
  // by blank lines, [label](url) links, **bold** and *italic*. We escape
  // HTML first and only re-inject the tags we generate, so nothing in
  // the model output reaches the DOM as raw HTML.

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function renderEssayHtml(markdown) {
    const escaped = escapeHtml(markdown);
    const linked = escaped.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_m, label, url) =>
        `<a href="${url}" data-search-link="${url}">${label}</a>`
    );
    const bolded = linked.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const italicised = bolded.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    return italicised
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, "<br>").trim()}</p>`)
      .filter((p) => p !== "<p></p>")
      .join("");
  }

  function hostnameOf(url) {
    if (!url || url === HOME_URL) return "";
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  // ── Session CRUD ────────────────────────────────────────────────────

  function newSession(url = HOME_URL, { activate = true } = {}) {
    const session = {
      id: uid(),
      url,
      title: url === HOME_URL ? "New session" : hostnameOf(url) || url,
      loading: false,
      view: null,
    };
    sessions.push(session);
    if (activate) activeId = session.id;
    render();
    if (url !== HOME_URL) ensureWebview(session);
    return session;
  }

  function closeSession(id) {
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const [removed] = sessions.splice(idx, 1);
    if (removed.view && removed.view.parentNode) {
      removed.view.parentNode.removeChild(removed.view);
    }
    if (activeId === id) {
      const next = sessions[idx] || sessions[idx - 1];
      activeId = next ? next.id : null;
    }
    if (sessions.length === 0) newSession(HOME_URL);
    else render();
  }

  function selectSession(id) {
    if (activeId === id) return;
    activeId = id;
    render();
  }

  // ── Webview management ──────────────────────────────────────────────

  function ensureWebview(session) {
    if (session.view) return session.view;
    const wv = document.createElement("webview");
    wv.setAttribute("src", session.url);
    wv.setAttribute("allowpopups", "true");
    wv.dataset.sessionId = session.id;
    wireWebviewEvents(session, wv);
    stage.appendChild(wv);
    session.view = wv;
    return wv;
  }

  function wireWebviewEvents(session, wv) {
    wv.addEventListener("did-start-loading", () => {
      session.loading = true;
      if (session.id === activeId) setLoading(true);
      renderSessions();
    });
    wv.addEventListener("did-stop-loading", () => {
      session.loading = false;
      if (session.id === activeId) setLoading(false);
      renderSessions();
      renderNavState();
    });
    wv.addEventListener("did-navigate", (e) => {
      session.url = e.url;
      renderNavState();
    });
    wv.addEventListener("did-navigate-in-page", (e) => {
      session.url = e.url;
      renderNavState();
    });
    wv.addEventListener("page-title-updated", (e) => {
      session.title = e.title || hostnameOf(session.url) || "Untitled";
      renderSessions();
    });
    wv.addEventListener("did-fail-load", (e) => {
      // -3 == ABORTED (navigation cancelled, ignore)
      if (e.errorCode === -3) return;
      session.loading = false;
      if (session.id === activeId) setLoading(false);
    });
  }

  function navigate(rawUrl) {
    const url = resolveQuery(rawUrl);
    if (!url) return;
    const session = getActive();
    if (!session) return;

    if (url === HOME_URL) {
      session.url = HOME_URL;
      session.title = "New session";
      removeSessionView(session);
      render();
      return;
    }

    if (url.startsWith(SEARCH_PREFIX)) {
      const query = decodeURIComponent(url.substring(SEARCH_PREFIX.length));
      showSearch(session, url, query);
      return;
    }

    if (url === PITCH_URL) {
      showPitchDeck(session);
      return;
    }

    // On Capacitor / plain web there's no <webview> tag — open the URL
    // in the system browser overlay (or a new tab) and leave the
    // current session on its previous view.
    if (window.tinker && window.tinker.supportsWebview === false) {
      if (typeof window.tinker.openExternal === "function") {
        window.tinker.openExternal(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return;
    }

    session.url = url;
    if (!session.title || session.title === "New session") {
      session.title = hostnameOf(url) || url;
    }
    // Switching to a webview from a non-webview view means the old pane
    // (e.g. a search-pane) needs to come down before we mount the webview.
    if (session.view && session.view.tagName.toLowerCase() !== "webview") {
      removeSessionView(session);
    }
    const wv = ensureWebview(session);
    if (wv.src !== url) {
      try { wv.loadURL(url); } catch { wv.src = url; }
    }
    render();
  }

  function removeSessionView(session) {
    if (session.view && session.view.parentNode) {
      session.view.parentNode.removeChild(session.view);
    }
    session.view = null;
  }

  // ── Search pane ─────────────────────────────────────────────────────

  function showSearch(session, url, query) {
    session.url = url;
    session.title = query;
    if (session.view && session.view.tagName.toLowerCase() !== "section") {
      removeSessionView(session);
    }
    const pane = session.view || createSearchPane(session);
    session.view = pane;
    pane.dataset.query = query;
    setSearchPaneState(pane, "loading", { query });
    session.loading = true;
    render();
    setLoading(true);

    window.tinker
      .searchQuery(query)
      .then((result) => {
        session.loading = false;
        if (session.id === activeId) setLoading(false);
        const text = (result && result.text) || "";
        setSearchPaneState(pane, "ready", { query, text });
        renderSessions();
      })
      .catch((err) => {
        session.loading = false;
        if (session.id === activeId) setLoading(false);
        setSearchPaneState(pane, "error", {
          query,
          message: err && err.message ? err.message : String(err),
        });
        renderSessions();
      });
  }

  function createSearchPane(session) {
    const pane = document.createElement("section");
    pane.className = "search-pane";
    pane.dataset.sessionId = session.id;
    pane.innerHTML =
      '<div class="search-pane__inner">' +
      '<div class="search-pane__header">' +
      '<span class="search-pane__crumb">Search</span>' +
      '<h2 class="search-pane__query"></h2>' +
      "</div>" +
      '<div class="search-pane__body"></div>' +
      "</div>";
    pane.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-search-link]");
      if (!a) return;
      e.preventDefault();
      const target = a.getAttribute("data-search-link");
      if (target) newSession(target);
    });
    stage.appendChild(pane);
    return pane;
  }

  function setSearchPaneState(pane, state, { query, text, message } = {}) {
    pane.dataset.state = state;
    const queryEl = pane.querySelector(".search-pane__query");
    const body = pane.querySelector(".search-pane__body");
    if (query !== undefined) queryEl.textContent = query;
    if (state === "loading") {
      body.innerHTML =
        '<div class="search-pane__loading">' +
        '<span class="thinking-dots" aria-hidden="true">' +
        '<span class="thinking-dot"></span>' +
        '<span class="thinking-dot"></span>' +
        '<span class="thinking-dot"></span>' +
        "</span>" +
        '<span class="search-pane__loading-text">Reading the room…</span>' +
        "</div>";
    } else if (state === "ready") {
      body.innerHTML =
        '<article class="search-pane__essay">' +
        renderEssayHtml(text || "") +
        "</article>";
    } else if (state === "error") {
      body.innerHTML =
        '<div class="search-pane__error">' +
        '<p><strong>The search couldn\'t finish.</strong></p>' +
        "<p>" +
        escapeHtml(message || "Unknown error") +
        "</p>" +
        '<p class="search-pane__error-hint">Make sure <code>ANTHROPIC_API_KEY</code> is set in your environment, then restart tinker.</p>' +
        "</div>";
    }
  }

  // ── Pitch-deck pane ─────────────────────────────────────────────────
  //
  // Multi-turn chat UI for the pitch-deck onboarding skill. Each session
  // owns its own messages array (Anthropic content-block shape), its DOM
  // pane, and its in-flight state. The model can call save_pitch_deck;
  // when it does, we render an inline deck card and feed back a tool
  // result so the conversation can continue with iteration prompts.

  function showPitchDeck(session) {
    session.url = PITCH_URL;
    session.title = "Pitch deck";
    if (session.view && !session.view.classList.contains("pitch-pane")) {
      removeSessionView(session);
    }
    if (!session.view) {
      const pane = createPitchPane(session);
      session.view = pane;
      stage.appendChild(pane);
    }
    render();
    pitchTextarea(session.view).focus();

    // Kick off the first turn if this is a fresh session.
    if (!session.pitch || session.pitch.messages.length === 0) {
      session.pitch = {
        messages: [],
        sending: false,
        deck: null,
      };
      sendPitchTurn(session, PITCH_KICKOFF, { hidden: true });
    }
  }

  function createPitchPane(session) {
    const pane = document.createElement("section");
    pane.className = "pitch-pane";
    pane.dataset.sessionId = session.id;
    pane.innerHTML =
      '<div class="pitch-pane__head">' +
      '<span class="pitch-pane__crumb">Onboarding</span>' +
      '<h2 class="pitch-pane__title">Build a pitch deck</h2>' +
      '<p class="pitch-pane__sub">A guided interview. Talk about your idea like you would to a friend.</p>' +
      "</div>" +
      '<div class="pitch-pane__scroll" data-role="scroll">' +
      '<div class="pitch-pane__messages" data-role="messages"></div>' +
      "</div>" +
      '<form class="pitch-pane__compose" data-role="compose">' +
      '<div class="pitch-pane__compose-inner">' +
      '<textarea class="pitch-pane__textarea" data-role="textarea" rows="1" ' +
      'placeholder="Reply…" aria-label="Reply"></textarea>' +
      '<button type="submit" class="pitch-pane__send" data-role="send" disabled>Send</button>' +
      "</div>" +
      "</form>";

    const textarea = pane.querySelector('[data-role="textarea"]');
    const send = pane.querySelector('[data-role="send"]');
    const compose = pane.querySelector('[data-role="compose"]');

    const sync = () => {
      const v = textarea.value.trim();
      send.disabled = !v || (session.pitch && session.pitch.sending);
      // Auto-grow up to the CSS max-height.
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
    };
    textarea.addEventListener("input", sync);
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        compose.requestSubmit();
      }
    });

    compose.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = textarea.value.trim();
      if (!v || session.pitch.sending) return;
      textarea.value = "";
      sync();
      sendPitchTurn(session, v);
    });

    return pane;
  }

  function pitchTextarea(pane) { return pane.querySelector('[data-role="textarea"]'); }
  function pitchSend(pane) { return pane.querySelector('[data-role="send"]'); }
  function pitchMessages(pane) { return pane.querySelector('[data-role="messages"]'); }
  function pitchScroll(pane) { return pane.querySelector('[data-role="scroll"]'); }

  function pitchAppend(pane, el) {
    pitchMessages(pane).appendChild(el);
    const scroll = pitchScroll(pane);
    scroll.scrollTop = scroll.scrollHeight;
  }

  function pitchBubble(role, text) {
    const div = document.createElement("div");
    div.className = "pitch-msg pitch-msg--" + role;
    div.textContent = text;
    return div;
  }

  function pitchLoading() {
    const div = document.createElement("div");
    div.className = "pitch-msg pitch-msg--assistant";
    div.innerHTML =
      '<span class="pitch-msg__loading">' +
      '<span class="thinking-dots" aria-hidden="true">' +
      '<span class="thinking-dot"></span>' +
      '<span class="thinking-dot"></span>' +
      '<span class="thinking-dot"></span>' +
      "</span>" +
      "<span>Thinking…</span>" +
      "</span>";
    return div;
  }

  function pitchError(message) {
    const div = document.createElement("div");
    div.className = "pitch-pane__error";
    div.innerHTML =
      "<strong>Couldn't reach Claude.</strong> " +
      escapeHtml(message || "Unknown error");
    return div;
  }

  function setPitchSending(session, sending) {
    session.pitch.sending = sending;
    if (session.id === activeId) setLoading(sending);
    session.loading = sending;
    renderSessions();
    if (session.view) {
      pitchSend(session.view).disabled =
        sending || !pitchTextarea(session.view).value.trim();
      pitchTextarea(session.view).disabled = sending;
    }
  }

  // Send a turn: append the user message (visible unless hidden), call
  // the API, render the assistant's text and any tool-use cards, then
  // — if a tool was used — feed the tool_result back as a follow-up
  // call so the model can give its closing line.
  async function sendPitchTurn(session, userText, opts = {}) {
    const { hidden = false } = opts;
    const pane = session.view;
    if (!pane) return;

    // Append the user turn to the conversation. Hidden turns (the
    // kickoff) still go into messages but skip the bubble.
    session.pitch.messages.push({
      role: "user",
      content: [{ type: "text", text: userText }],
    });
    if (!hidden) pitchAppend(pane, pitchBubble("user", userText));

    setPitchSending(session, true);
    const loadingEl = pitchLoading();
    pitchAppend(pane, loadingEl);

    try {
      const response = await window.tinker.pitchDeckTurn(session.pitch.messages);
      loadingEl.remove();

      const assistantBlocks = response.content || [];
      session.pitch.messages.push({ role: "assistant", content: assistantBlocks });

      const toolUses = [];
      for (const block of assistantBlocks) {
        if (block.type === "text" && block.text.trim()) {
          pitchAppend(pane, pitchBubble("assistant", block.text));
        } else if (block.type === "tool_use" && block.name === "save_pitch_deck") {
          toolUses.push(block);
          renderDeckCard(session, block);
        }
      }

      // If the model called a tool, send tool_result(s) back in one user
      // turn and ask Claude to wrap up. Without this the conversation
      // stalls in tool_use mid-turn.
      if (toolUses.length > 0) {
        setPitchSending(session, false);
        const results = toolUses.map((t) => ({
          type: "tool_result",
          tool_use_id: t.id,
          content: "Deck saved. Show the spoken summary in chat now.",
        }));
        session.pitch.messages.push({ role: "user", content: results });

        setPitchSending(session, true);
        const followUpLoading = pitchLoading();
        pitchAppend(pane, followUpLoading);
        const followUp = await window.tinker.pitchDeckTurn(session.pitch.messages);
        followUpLoading.remove();
        session.pitch.messages.push({ role: "assistant", content: followUp.content || [] });
        for (const block of followUp.content || []) {
          if (block.type === "text" && block.text.trim()) {
            pitchAppend(pane, pitchBubble("assistant", block.text));
          }
        }
      }
    } catch (err) {
      loadingEl.remove();
      pitchAppend(pane, pitchError(err && err.message ? err.message : String(err)));
      // Roll back the user turn we optimistically appended so the
      // founder can resend without duplicating it in the history.
      session.pitch.messages.pop();
    } finally {
      setPitchSending(session, false);
    }
  }

  function renderDeckCard(session, toolUseBlock) {
    const input = toolUseBlock.input || {};
    const markdown = typeof input.markdown === "string" ? input.markdown : "";
    const summary = typeof input.summary === "string" ? input.summary : "";
    session.pitch.deck = { markdown, summary };

    const card = document.createElement("div");
    card.className = "pitch-deck-card";
    card.innerHTML =
      '<div class="pitch-deck-card__crumb">Pitch deck ready</div>' +
      '<div class="pitch-deck-card__title">Your deck — review and save</div>' +
      '<div class="pitch-deck-card__summary"></div>' +
      '<div class="pitch-deck-card__actions">' +
      '<button type="button" class="pitch-deck-card__btn pitch-deck-card__btn--primary" data-act="copy">Copy markdown</button>' +
      '<button type="button" class="pitch-deck-card__btn" data-act="download">Download .md</button>' +
      '<button type="button" class="pitch-deck-card__btn" data-act="toggle">Show full deck</button>' +
      "</div>" +
      '<pre class="pitch-deck-card__preview" hidden></pre>';
    card.querySelector(".pitch-deck-card__summary").textContent = summary;
    card.querySelector(".pitch-deck-card__preview").textContent = markdown;

    card.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      const preview = card.querySelector(".pitch-deck-card__preview");
      if (act === "copy") {
        navigator.clipboard.writeText(markdown).then(
          () => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy markdown"; }, 1400); },
          () => { btn.textContent = "Copy failed"; }
        );
      } else if (act === "download") {
        const blob = new Blob([markdown], { type: "text/markdown" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "pitch-deck.md";
        a.click();
        URL.revokeObjectURL(a.href);
      } else if (act === "toggle") {
        preview.hidden = !preview.hidden;
        btn.textContent = preview.hidden ? "Show full deck" : "Hide full deck";
      }
    });

    pitchAppend(session.view, card);
  }

  // ── Rendering ───────────────────────────────────────────────────────

  function render() {
    renderSessions();
    renderStage();
    renderNavState();
    const active = getActive();
    setLoading(active ? active.loading : false);
  }

  function renderSessions() {
    sessionsEl.innerHTML = "";
    for (const session of sessions) {
      const el = document.createElement("button");
      el.className = "session";
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(session.id === activeId));
      el.dataset.id = session.id;
      el.title = session.url === HOME_URL ? "New session" : session.url;

      const icon = document.createElement("span");
      icon.className = "session__icon";
      if (session.loading) {
        const sp = document.createElement("span");
        sp.className = "session__spinner";
        icon.appendChild(sp);
      } else if (session.url === HOME_URL) {
        icon.innerHTML =
          '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none">' +
          '<circle cx="8" cy="8" r="6" stroke="#c8b6e2" stroke-width="1.6"/>' +
          '<line x1="2" y1="8" x2="14" y2="8" stroke="#fdba74" stroke-width="1.6" stroke-linecap="round"/>' +
          '<line x1="8" y1="2" x2="8" y2="14" stroke="#6ee7b7" stroke-width="1.6" stroke-linecap="round"/>' +
          '<ellipse cx="8" cy="8" rx="3" ry="6" stroke="#7dd3fc" stroke-width="1.6"/>' +
          "</svg>";
      } else if (session.url.startsWith(SEARCH_PREFIX)) {
        icon.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
          '<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" fill="none"/>' +
          '<path d="M20 20l-4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      } else if (session.url === PITCH_URL) {
        icon.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none">' +
          '<rect x="4" y="5" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/>' +
          '<path d="M9 21h6M12 17v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
          '<path d="M8 10l2.5 2.5L14 9l2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      } else {
        icon.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" fill="none"/>' +
          '<path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>';
      }

      const title = document.createElement("span");
      title.className = "session__title";
      title.textContent = session.title || hostnameOf(session.url) || "Untitled";

      const close = document.createElement("span");
      close.className = "session__close";
      close.setAttribute("role", "button");
      close.setAttribute("aria-label", "Close session");
      close.innerHTML =
        '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
        '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeSession(session.id);
      });

      el.append(icon, title, close);
      el.addEventListener("click", () => selectSession(session.id));
      el.addEventListener("auxclick", (e) => {
        if (e.button === 1) closeSession(session.id);
      });
      sessionsEl.appendChild(el);
    }
  }

  function renderStage() {
    const active = getActive();
    welcome.toggleAttribute("data-active", !!active && active.url === HOME_URL);
    for (const session of sessions) {
      if (!session.view) continue;
      const isActive = session.id === activeId && session.url !== HOME_URL;
      session.view.toggleAttribute("data-active", isActive);
    }
  }

  function renderNavState() {
    const session = getActive();
    const view = session && session.view;
    const isWebview = view && view.tagName.toLowerCase() === "webview";
    const onHome = !session || session.url === HOME_URL;
    const onPitch = session && session.url === PITCH_URL;
    navBack.disabled = onHome || !isWebview || !view.canGoBack || !view.canGoBack();
    navForward.disabled = onHome || !isWebview || !view.canGoForward || !view.canGoForward();
    // Reload is meaningful for webviews and the search pane (re-runs the
    // query). The pitch pane has no reload behaviour — closing the
    // session is the way to start a new interview.
    navReload.disabled = onHome || onPitch;
  }

  function setLoading(active) {
    if (active) loadbar.setAttribute("data-active", "");
    else loadbar.removeAttribute("data-active");
  }

  // ── Event wiring ────────────────────────────────────────────────────

  newSessionBtn.addEventListener("click", () => {
    newSession(HOME_URL);
    welcomeInput.focus();
  });

  navBack.addEventListener("click", () => {
    const s = getActive();
    if (s && s.view && s.view.canGoBack()) s.view.goBack();
  });
  navForward.addEventListener("click", () => {
    const s = getActive();
    if (s && s.view && s.view.canGoForward()) s.view.goForward();
  });
  navReload.addEventListener("click", () => {
    const s = getActive();
    if (!s || !s.view) return;
    if (s.view.tagName.toLowerCase() === "webview") {
      s.view.reload();
    } else if (s.url.startsWith(SEARCH_PREFIX)) {
      const query = decodeURIComponent(s.url.substring(SEARCH_PREFIX.length));
      showSearch(s, s.url, query);
    }
  });
  navHome.addEventListener("click", () => navigate(HOME_URL));

  welcomeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = welcomeInput.value.trim();
    if (!v) return;
    welcomeInput.value = "";
    navigate(v);
  });

  // Anything with [data-url] navigates the active session.
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-url]");
    if (!target) return;
    e.preventDefault();
    navigate(target.dataset.url);
  });

  // Keyboard shortcuts: ⌘T / Ctrl+T new session, ⌘W / Ctrl+W close,
  // ⌘L / Ctrl+L focus the welcome search, ⌘R / Ctrl+R reload,
  // ⌘[ / ⌘] for back/forward.
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      newSession(HOME_URL);
      welcomeInput.focus();
    } else if (e.key === "w" || e.key === "W") {
      e.preventDefault();
      if (activeId) closeSession(activeId);
    } else if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      navigate(HOME_URL);
      welcomeInput.focus();
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      const s = getActive();
      if (!s || !s.view) return;
      if (s.view.tagName.toLowerCase() === "webview") {
        s.view.reload();
      } else if (s.url.startsWith(SEARCH_PREFIX)) {
        const query = decodeURIComponent(s.url.substring(SEARCH_PREFIX.length));
        showSearch(s, s.url, query);
      }
    } else if (e.key === "[") {
      const s = getActive();
      if (s && s.view && s.view.canGoBack()) {
        e.preventDefault();
        s.view.goBack();
      }
    } else if (e.key === "]") {
      const s = getActive();
      if (s && s.view && s.view.canGoForward()) {
        e.preventDefault();
        s.view.goForward();
      }
    }
  });

  // ── Boot ────────────────────────────────────────────────────────────

  newSession(HOME_URL);
  welcomeInput.focus();
})();
