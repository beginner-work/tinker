/* beginner Web Browser — renderer
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

  const HOME_URL = "beginner://home";
  const SEARCH_URL = (q) =>
    `https://www.google.com/search?q=${encodeURIComponent(q)}`;

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
    if (text === "home" || text === "beginner://home") return HOME_URL;
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(text)) return text;
    if (/^[a-z]+:/i.test(text)) return text;
    const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(text);
    if (looksLikeHost) return "https://" + text;
    if (text.startsWith("localhost") || /^localhost(:\d+)/.test(text)) {
      return "http://" + text;
    }
    return SEARCH_URL(text);
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
      if (session.view && session.view.parentNode) {
        session.view.parentNode.removeChild(session.view);
        session.view = null;
      }
      render();
      return;
    }

    session.url = url;
    if (!session.title || session.title === "New session") {
      session.title = hostnameOf(url) || url;
    }
    const wv = ensureWebview(session);
    if (wv.src !== url) {
      try { wv.loadURL(url); } catch { wv.src = url; }
    }
    render();
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
          '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
          '<rect width="16" height="16" rx="3.5" fill="#2d5a3d"/>' +
          '<path d="M6 3.5 L6 12.2" stroke="#f5f3ef" stroke-width="1.4" stroke-linecap="round"/>' +
          '<path d="M6 7 C6 5.7 7 5 8.6 5 C10.5 5 11.4 6 11.4 7.6 C11.4 9.2 10.5 10.4 8.6 10.4 C7.2 10.4 6 9.6 6 8.6Z" stroke="#f5f3ef" stroke-width="1.4" fill="none"/>' +
          "</svg>";
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
    const wv = session && session.view;
    const onHome = !session || session.url === HOME_URL;
    navBack.disabled = onHome || !wv || !wv.canGoBack || !wv.canGoBack();
    navForward.disabled = onHome || !wv || !wv.canGoForward || !wv.canGoForward();
    navReload.disabled = onHome;
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
    if (s && s.view) s.view.reload();
  });
  navHome.addEventListener("click", () => navigate(HOME_URL));

  welcomeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = welcomeInput.value;
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
      if (s && s.view) s.view.reload();
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
