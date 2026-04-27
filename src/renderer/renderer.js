/* beginner Web Browser — renderer
 *
 * Smart navigation: there are no search results. The reader describes a
 * starting point on the welcome page; we ask Claude for the closest
 * existing web page and land them on it. If it's not quite right they
 * add more description in the describe-bar above the page, and we jump
 * to a new page. The growing chain of descriptions is the session.
 *
 * Each session is either:
 *   - the welcome page (a <section> already in the DOM), or
 *   - a webview that we mount lazily inside the .stage element.
 *
 * State lives in a plain `sessions` array. The DOM is rebuilt from
 * state via `render()`; webviews persist between renders so navigation
 * history isn't lost when sessions are reordered or selection changes.
 */

(() => {
  "use strict";

  const HOME_URL = "beginner://home";

  /**
   * @type {Array<{
   *   id: string,
   *   url: string,
   *   title: string,
   *   loading: boolean,
   *   view: HTMLElement | null,
   *   descriptions: string[],
   *   note: string,
   *   resolving: boolean,
   *   resolveError: string,
   * }>}
   */
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
  const welcomeSubmit = $("#welcome-submit");
  const welcomeStatus = $("#welcome-status");
  const pluginTabs = $("#plugin-tabs");

  // ── Plugin system ────────────────────────────────────────────────────
  //
  // The welcome bar dispatches to the active plugin. Each plugin owns
  // its placeholder, button label, and onSubmit handler. Adding a new
  // mode (e.g. "Send to Mastodon") means adding one entry here and a
  // matching tab in index.html.

  const plugins = {
    search: {
      placeholder: "Where is your starting point today?",
      button: "Begin",
      onSubmit(text) {
        beginSmartNav(text);
      },
    },
    linkedin: {
      placeholder: "What's on your mind?",
      button: "Post",
      async onSubmit(text) {
        setStatus("loading", "Posting to LinkedIn…");
        welcomeSubmit.disabled = true;
        try {
          const result = await window.beginner.linkedinPost(text);
          welcomeInput.value = "";
          if (result && result.url) {
            setStatus(
              "ok",
              `Posted. <a href="#" data-url="${escapeHtml(result.url)}">Open on LinkedIn &rarr;</a>`
            );
          } else {
            setStatus("ok", "Posted to LinkedIn.");
          }
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          setStatus("error", escapeHtml(msg));
        } finally {
          welcomeSubmit.disabled = false;
        }
      },
    },
  };

  let activePlugin = "search";

  function setActivePlugin(name) {
    if (!plugins[name]) return;
    activePlugin = name;
    const p = plugins[name];
    welcomeInput.placeholder = p.placeholder;
    welcomeInput.setAttribute("aria-label", p.placeholder);
    welcomeSubmit.textContent = p.button;
    setStatus(null);
    for (const btn of pluginTabs.querySelectorAll(".welcome__tab")) {
      btn.setAttribute("aria-selected", String(btn.dataset.plugin === name));
    }
  }

  function setStatus(state, html) {
    if (!state) {
      welcomeStatus.hidden = true;
      welcomeStatus.innerHTML = "";
      welcomeStatus.removeAttribute("data-state");
      return;
    }
    welcomeStatus.hidden = false;
    welcomeStatus.dataset.state = state;
    welcomeStatus.innerHTML = html || "";
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  const uid = () => "s_" + Math.random().toString(36).slice(2, 9);

  const getActive = () => sessions.find((s) => s.id === activeId) || null;

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
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

  function makeSession(url = HOME_URL) {
    return {
      id: uid(),
      url,
      title: url === HOME_URL ? "New session" : hostnameOf(url) || url,
      loading: false,
      view: null,
      descriptions: [],
      note: "",
      resolving: false,
      resolveError: "",
    };
  }

  function newSession(url = HOME_URL, { activate = true } = {}) {
    const session = makeSession(url);
    sessions.push(session);
    if (activate) activeId = session.id;
    render();
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
    if (session.view && session.view.tagName.toLowerCase() === "webview") {
      return session.view;
    }
    if (session.view) removeSessionView(session);
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
      // Don't overwrite the smart-nav title with the live page title —
      // the breadcrumb in the describe-bar is what the reader described,
      // not what the page calls itself. Only fall through when there's
      // no smart-nav title yet (e.g. a directly-typed URL).
      if (session.descriptions.length === 0) {
        session.title = e.title || hostnameOf(session.url) || "Untitled";
        renderSessions();
      }
    });
    wv.addEventListener("did-fail-load", (e) => {
      // -3 == ABORTED (navigation cancelled, ignore)
      if (e.errorCode === -3) return;
      session.loading = false;
      if (session.id === activeId) setLoading(false);
    });
  }

  function loadInWebview(session, url) {
    if (window.beginner && window.beginner.supportsWebview === false) {
      // No <webview> on Capacitor / plain web. Hand the URL to the
      // system browser overlay; the describe-bar stays in the app so
      // the reader can keep refining without losing the chain.
      if (typeof window.beginner.openExternal === "function") {
        window.beginner.openExternal(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      session.url = url;
      render();
      return;
    }
    session.url = url;
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

  // ── Smart navigation ────────────────────────────────────────────────

  function beginSmartNav(description) {
    const text = description.trim();
    if (!text) return;
    let session = getActive();
    if (!session || session.descriptions.length > 0) {
      // Already on a smart-nav journey — start a fresh session so we
      // don't quietly fold this into the existing chain.
      session = newSession(HOME_URL);
    }
    session.descriptions = [text];
    session.title = text;
    setStatus("loading", "Reading the room…");
    welcomeSubmit.disabled = true;
    resolveAndJump(session)
      .catch(() => {})
      .finally(() => {
        welcomeSubmit.disabled = false;
      });
  }

  function refineSmartNav(session, description) {
    const text = description.trim();
    if (!text) return;
    session.descriptions = [...session.descriptions, text];
    session.title = text;
    resolveAndJump(session).catch(() => {});
  }

  async function resolveAndJump(session) {
    session.resolving = true;
    session.resolveError = "";
    session.loading = true;
    if (session.id === activeId) setLoading(true);
    render();

    try {
      const result = await window.beginner.navigateTo({
        descriptions: session.descriptions,
        currentUrl: /^https?:\/\//i.test(session.url) ? session.url : "",
      });
      session.resolving = false;
      session.note = result.note || "";
      if (result.title) session.title = result.title;
      setStatus(null);
      loadInWebview(session, result.url);
    } catch (err) {
      session.resolving = false;
      session.loading = false;
      if (session.id === activeId) setLoading(false);
      const msg = err && err.message ? err.message : String(err);
      session.resolveError = msg;
      // Show the error on the welcome page if we never left it; on the
      // describe-bar otherwise.
      if (session.url === HOME_URL) {
        setStatus("error", escapeHtml(msg));
      }
      render();
      throw err;
    }
  }

  // ── Describe-bar ────────────────────────────────────────────────────

  let describeBar = null;

  function ensureDescribeBar() {
    if (describeBar) return describeBar;
    const bar = document.createElement("div");
    bar.className = "describe-bar";
    bar.id = "describe-bar";
    bar.innerHTML =
      '<div class="describe-bar__chain" aria-label="Description chain"></div>' +
      '<form class="describe-bar__form">' +
      '<input class="describe-bar__input" type="text" autocomplete="off" ' +
      'spellcheck="false" placeholder="Describe further…" ' +
      'aria-label="Describe further" />' +
      '<button class="describe-bar__submit" type="submit" ' +
      'aria-label="Jump">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'fill="none"/></svg>' +
      "</button>" +
      "</form>" +
      '<p class="describe-bar__error" hidden></p>';
    bar.querySelector(".describe-bar__form").addEventListener("submit", (e) => {
      e.preventDefault();
      const session = getActive();
      if (!session || session.resolving) return;
      const input = bar.querySelector(".describe-bar__input");
      const v = input.value.trim();
      if (!v) return;
      input.value = "";
      refineSmartNav(session, v);
    });
    document.body.appendChild(bar);
    describeBar = bar;
    return bar;
  }

  function renderDescribeBar() {
    const session = getActive();
    // Only show once we've actually landed on a page. While the first
    // jump is still resolving the welcome page is still up and shows
    // its own "Reading the room…" status — two loaders would be busy.
    const showFor =
      session && session.descriptions.length > 0 && session.url !== HOME_URL;
    if (!showFor) {
      if (describeBar) describeBar.hidden = true;
      document.body.classList.remove("has-describe-bar");
      return;
    }
    const bar = ensureDescribeBar();
    bar.hidden = false;
    document.body.classList.add("has-describe-bar");
    bar.dataset.state = session.resolving
      ? "resolving"
      : session.resolveError
      ? "error"
      : "ready";

    const chain = bar.querySelector(".describe-bar__chain");
    chain.innerHTML = session.descriptions
      .map(
        (d, i) =>
          (i > 0
            ? '<span class="describe-bar__sep" aria-hidden="true">›</span>'
            : "") +
          `<span class="describe-bar__crumb">${escapeHtml(d)}</span>`
      )
      .join("");
    if (session.resolving) {
      chain.insertAdjacentHTML(
        "beforeend",
        '<span class="describe-bar__sep" aria-hidden="true">›</span>' +
          '<span class="describe-bar__crumb describe-bar__crumb--resolving">' +
          '<span class="thinking-dots" aria-hidden="true">' +
          '<span class="thinking-dot"></span>' +
          '<span class="thinking-dot"></span>' +
          '<span class="thinking-dot"></span>' +
          "</span>" +
          "</span>"
      );
    }

    const errEl = bar.querySelector(".describe-bar__error");
    if (session.resolveError) {
      errEl.hidden = false;
      errEl.textContent = session.resolveError;
    } else {
      errEl.hidden = true;
      errEl.textContent = "";
    }

    const input = bar.querySelector(".describe-bar__input");
    input.disabled = !!session.resolving;
  }

  // ── Rendering ───────────────────────────────────────────────────────

  function render() {
    renderSessions();
    renderStage();
    renderNavState();
    renderDescribeBar();
    const active = getActive();
    setLoading(active ? active.loading || active.resolving : false);
  }

  function renderSessions() {
    sessionsEl.innerHTML = "";
    for (const session of sessions) {
      const el = document.createElement("button");
      el.className = "session";
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(session.id === activeId));
      el.dataset.id = session.id;
      el.title =
        session.url === HOME_URL
          ? "New session"
          : session.descriptions.length > 0
          ? session.descriptions.join(" › ")
          : session.url;

      const icon = document.createElement("span");
      icon.className = "session__icon";
      if (session.loading || session.resolving) {
        const sp = document.createElement("span");
        sp.className = "session__spinner";
        icon.appendChild(sp);
      } else if (session.url === HOME_URL) {
        icon.innerHTML =
          '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
          '<rect width="16" height="16" rx="3.5" fill="#2d5a3d"/>' +
          '<path d="M6 3.5 L6 12.2" stroke="#f5f3ef" stroke-width="1.4" stroke-linecap="round"/>' +
          '<path d="M6 7 C6 5.7 7 5 8.6 5 C10.5 5 11.4 6 11.4 7.6 C11.4 9.2 10.5 10.4 8.6 10.4 C7.2 10.4 6 9.6 6 8.6Z" stroke="#f5f3ef" stroke-width="1.4" fill="none"/>' +
          "</svg>";
      } else if (session.descriptions.length > 0) {
        // Smart-nav crumb glyph — a small arrow, distinct from the
        // generic globe used for raw URL sessions.
        icon.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
          '<path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
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
    navBack.disabled = onHome || !isWebview || !view.canGoBack || !view.canGoBack();
    navForward.disabled = onHome || !isWebview || !view.canGoForward || !view.canGoForward();
    navReload.disabled = onHome;
  }

  function setLoading(active) {
    if (active) loadbar.setAttribute("data-active", "");
    else loadbar.removeAttribute("data-active");
  }

  function goHome() {
    const session = getActive();
    if (!session) {
      newSession(HOME_URL);
      return;
    }
    session.url = HOME_URL;
    session.title = "New session";
    session.descriptions = [];
    session.note = "";
    session.resolveError = "";
    removeSessionView(session);
    render();
    welcomeInput.focus();
  }

  // ── Event wiring ────────────────────────────────────────────────────

  newSessionBtn.addEventListener("click", () => {
    newSession(HOME_URL);
    welcomeInput.focus();
  });

  navBack.addEventListener("click", () => {
    const s = getActive();
    if (s && s.view && s.view.canGoBack && s.view.canGoBack()) s.view.goBack();
  });
  navForward.addEventListener("click", () => {
    const s = getActive();
    if (s && s.view && s.view.canGoForward && s.view.canGoForward()) s.view.goForward();
  });
  navReload.addEventListener("click", () => {
    const s = getActive();
    if (!s || !s.view) return;
    if (s.view.tagName.toLowerCase() === "webview") s.view.reload();
  });
  navHome.addEventListener("click", goHome);

  welcomeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = welcomeInput.value.trim();
    if (!v) return;
    const plugin = plugins[activePlugin] || plugins.search;
    if (activePlugin === "search") {
      welcomeInput.value = "";
      setStatus(null);
    }
    plugin.onSubmit(v);
  });

  pluginTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".welcome__tab");
    if (!btn) return;
    setActivePlugin(btn.dataset.plugin);
    welcomeInput.focus();
  });

  // Anything with [data-url] navigates the active session.
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-url]");
    if (!target) return;
    e.preventDefault();
    const url = target.dataset.url;
    if (!url) return;
    if (url === HOME_URL) {
      goHome();
      return;
    }
    const session = getActive() || newSession(HOME_URL);
    loadInWebview(session, url);
  });

  // Keyboard shortcuts: ⌘T / Ctrl+T new session, ⌘W / Ctrl+W close,
  // ⌘L / Ctrl+L focus the welcome / describe-bar input,
  // ⌘R / Ctrl+R reload, ⌘[ / ⌘] for back/forward.
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
      const s = getActive();
      if (s && s.url !== HOME_URL && s.descriptions.length > 0 && describeBar && !describeBar.hidden) {
        describeBar.querySelector(".describe-bar__input").focus();
      } else {
        goHome();
      }
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      const s = getActive();
      if (s && s.view && s.view.tagName.toLowerCase() === "webview") s.view.reload();
    } else if (e.key === "[") {
      const s = getActive();
      if (s && s.view && s.view.canGoBack && s.view.canGoBack()) {
        e.preventDefault();
        s.view.goBack();
      }
    } else if (e.key === "]") {
      const s = getActive();
      if (s && s.view && s.view.canGoForward && s.view.canGoForward()) {
        e.preventDefault();
        s.view.goForward();
      }
    }
  });

  // ── Boot ────────────────────────────────────────────────────────────

  newSession(HOME_URL);
  welcomeInput.focus();
})();
