/* beginner Web Browser — renderer
 *
 * Tab + navigation logic. Each tab is either:
 *   - the welcome page (a <section> already in the DOM), or
 *   - a webview that we mount lazily inside the .stage element.
 *
 * State lives in a plain `tabs` array. The DOM is rebuilt from state
 * via `render()`; webviews persist between renders so navigation
 * history isn't lost when tabs are reordered or selection changes.
 */

(() => {
  "use strict";

  const HOME_URL = "beginner://home";
  const SEARCH_URL = (q) =>
    `https://www.google.com/search?q=${encodeURIComponent(q)}`;

  /** @type {Array<{id: string, url: string, title: string, loading: boolean, view: HTMLElement | null}>} */
  let tabs = [];
  let activeId = null;

  // ── DOM refs ─────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const stage = $("#stage");
  const welcome = $("#welcome");
  const tabsEl = $("#tabs");
  const newTabBtn = $("#new-tab");
  const navBack = $("#nav-back");
  const navForward = $("#nav-forward");
  const navReload = $("#nav-reload");
  const navHome = $("#nav-home");
  const addressForm = $("#address-form");
  const addressInput = $("#address");
  const addressIcon = $("#address-icon");
  const addressClear = $("#address-clear");
  const loadbar = $("#loadbar");
  const welcomeForm = $("#welcome-form");
  const welcomeInput = $("#welcome-input");

  // ── Helpers ──────────────────────────────────────────────────────────

  function uid() {
    return "t_" + Math.random().toString(36).slice(2, 9);
  }

  function getActive() {
    return tabs.find((t) => t.id === activeId) || null;
  }

  /** Decide if a string is a navigable URL or should be searched. */
  function resolveQuery(raw) {
    const text = raw.trim();
    if (!text) return null;
    if (text === "home" || text === "beginner://home") return HOME_URL;
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(text)) return text;
    if (/^[a-z]+:/i.test(text)) return text;
    // Looks like a hostname (has a dot, no spaces, valid chars)
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

  // ── Tab CRUD ────────────────────────────────────────────────────────

  function newTab(url = HOME_URL, { activate = true } = {}) {
    const tab = {
      id: uid(),
      url,
      title: url === HOME_URL ? "New tab" : hostnameOf(url) || url,
      loading: false,
      view: null,
    };
    tabs.push(tab);
    if (activate) activeId = tab.id;
    render();
    if (url !== HOME_URL) {
      ensureWebview(tab);
    }
    return tab;
  }

  function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [removed] = tabs.splice(idx, 1);
    if (removed.view && removed.view.parentNode) {
      removed.view.parentNode.removeChild(removed.view);
    }
    if (activeId === id) {
      const next = tabs[idx] || tabs[idx - 1];
      activeId = next ? next.id : null;
    }
    if (tabs.length === 0) newTab(HOME_URL);
    else render();
  }

  function selectTab(id) {
    if (activeId === id) return;
    activeId = id;
    render();
  }

  // ── Webview management ──────────────────────────────────────────────

  function ensureWebview(tab) {
    if (tab.view) return tab.view;
    const wv = document.createElement("webview");
    wv.setAttribute("src", tab.url);
    wv.setAttribute("allowpopups", "true");
    wv.dataset.tabId = tab.id;
    wireWebviewEvents(tab, wv);
    stage.appendChild(wv);
    tab.view = wv;
    return wv;
  }

  function wireWebviewEvents(tab, wv) {
    wv.addEventListener("did-start-loading", () => {
      tab.loading = true;
      if (tab.id === activeId) setLoading(true);
      renderTabs();
    });
    wv.addEventListener("did-stop-loading", () => {
      tab.loading = false;
      if (tab.id === activeId) setLoading(false);
      renderTabs();
      renderNavState();
    });
    wv.addEventListener("did-navigate", (e) => {
      tab.url = e.url;
      if (tab.id === activeId) setAddress(e.url);
      renderNavState();
    });
    wv.addEventListener("did-navigate-in-page", (e) => {
      tab.url = e.url;
      if (tab.id === activeId) setAddress(e.url);
      renderNavState();
    });
    wv.addEventListener("page-title-updated", (e) => {
      tab.title = e.title || hostnameOf(tab.url) || "Untitled";
      renderTabs();
    });
    wv.addEventListener("did-fail-load", (e) => {
      // -3 == ABORTED (navigation cancelled, ignore)
      if (e.errorCode === -3) return;
      tab.loading = false;
      if (tab.id === activeId) setLoading(false);
    });
  }

  function navigate(rawUrl) {
    const url = resolveQuery(rawUrl);
    if (!url) return;
    const tab = getActive();
    if (!tab) return;

    if (url === HOME_URL) {
      tab.url = HOME_URL;
      tab.title = "New tab";
      if (tab.view && tab.view.parentNode) {
        tab.view.parentNode.removeChild(tab.view);
        tab.view = null;
      }
      render();
      return;
    }

    tab.url = url;
    if (!tab.title || tab.title === "New tab") tab.title = hostnameOf(url) || url;
    const wv = ensureWebview(tab);
    if (wv.src !== url) {
      try { wv.loadURL(url); } catch { wv.src = url; }
    }
    render();
  }

  // ── Rendering ───────────────────────────────────────────────────────

  function render() {
    renderTabs();
    renderStage();
    renderNavState();
    const active = getActive();
    setAddress(active ? active.url : "");
    setLoading(active ? active.loading : false);
  }

  function renderTabs() {
    tabsEl.innerHTML = "";
    for (const tab of tabs) {
      const el = document.createElement("button");
      el.className = "tab";
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(tab.id === activeId));
      el.dataset.id = tab.id;

      const fav = document.createElement("span");
      fav.className = "tab__favicon";
      if (tab.loading) {
        const sp = document.createElement("span");
        sp.className = "tab__spinner";
        fav.appendChild(sp);
      } else if (tab.url === HOME_URL) {
        fav.innerHTML =
          '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
          '<rect width="16" height="16" rx="3.5" fill="#2d5a3d"/>' +
          '<path d="M6 3.5 L6 12.2" stroke="#f5f3ef" stroke-width="1.4" stroke-linecap="round"/>' +
          '<path d="M6 7 C6 5.7 7 5 8.6 5 C10.5 5 11.4 6 11.4 7.6 C11.4 9.2 10.5 10.4 8.6 10.4 C7.2 10.4 6 9.6 6 8.6Z" stroke="#f5f3ef" stroke-width="1.4" fill="none"/>' +
          "</svg>";
      } else {
        fav.textContent = "•";
      }

      const title = document.createElement("span");
      title.className = "tab__title";
      title.textContent = tab.title || hostnameOf(tab.url) || "Untitled";

      const close = document.createElement("span");
      close.className = "tab__close";
      close.setAttribute("role", "button");
      close.setAttribute("aria-label", "Close tab");
      close.innerHTML =
        '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
        '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });

      el.append(fav, title, close);
      el.addEventListener("click", () => selectTab(tab.id));
      el.addEventListener("auxclick", (e) => {
        if (e.button === 1) closeTab(tab.id); // middle-click closes
      });
      tabsEl.appendChild(el);
    }
  }

  function renderStage() {
    const active = getActive();
    // Toggle visibility of welcome and any webviews
    welcome.toggleAttribute("data-active", !!active && active.url === HOME_URL);
    for (const tab of tabs) {
      if (!tab.view) continue;
      const isActive = tab.id === activeId && tab.url !== HOME_URL;
      tab.view.toggleAttribute("data-active", isActive);
    }
  }

  function renderNavState() {
    const tab = getActive();
    const wv = tab && tab.view;
    const onHome = !tab || tab.url === HOME_URL;
    navBack.disabled = onHome || !wv || !wv.canGoBack || !wv.canGoBack();
    navForward.disabled = onHome || !wv || !wv.canGoForward || !wv.canGoForward();
    navReload.disabled = onHome;
    // Address bar lock icon when secure
    const url = tab ? tab.url : "";
    if (url && url.startsWith("https://")) {
      addressIcon.classList.add("address__icon--secure");
      addressIcon.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
        '<rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>' +
        '<path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
    } else {
      addressIcon.classList.remove("address__icon--secure");
      addressIcon.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    }
  }

  function setAddress(url) {
    if (document.activeElement === addressInput) return;
    const display = url === HOME_URL ? "" : url;
    addressInput.value = display;
    addressClear.hidden = !display;
  }

  function setLoading(active) {
    if (active) loadbar.setAttribute("data-active", "");
    else loadbar.removeAttribute("data-active");
  }

  // ── Event wiring ────────────────────────────────────────────────────

  newTabBtn.addEventListener("click", () => newTab(HOME_URL));

  navBack.addEventListener("click", () => {
    const t = getActive();
    if (t && t.view && t.view.canGoBack()) t.view.goBack();
  });
  navForward.addEventListener("click", () => {
    const t = getActive();
    if (t && t.view && t.view.canGoForward()) t.view.goForward();
  });
  navReload.addEventListener("click", () => {
    const t = getActive();
    if (t && t.view) t.view.reload();
  });
  navHome.addEventListener("click", () => navigate(HOME_URL));

  addressForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = addressInput.value;
    addressInput.blur();
    navigate(v);
  });

  addressInput.addEventListener("focus", () => addressInput.select());
  addressInput.addEventListener("input", () => {
    addressClear.hidden = !addressInput.value;
  });
  addressInput.addEventListener("blur", () => {
    const t = getActive();
    setAddress(t ? t.url : "");
  });

  addressClear.addEventListener("click", () => {
    addressInput.value = "";
    addressInput.focus();
    addressClear.hidden = true;
  });

  welcomeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = welcomeInput.value;
    welcomeInput.value = "";
    navigate(v);
  });

  // Quick-link tiles + bookmark pills share data-url
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-url]");
    if (!target) return;
    e.preventDefault();
    navigate(target.dataset.url);
  });

  // Keyboard shortcuts: ⌘T / Ctrl+T new tab, ⌘W / Ctrl+W close tab,
  // ⌘L / Ctrl+L focus address bar, ⌘R / Ctrl+R reload.
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      newTab(HOME_URL);
      addressInput.focus();
    } else if (e.key === "w" || e.key === "W") {
      e.preventDefault();
      if (activeId) closeTab(activeId);
    } else if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      addressInput.focus();
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      const t = getActive();
      if (t && t.view) t.view.reload();
    }
  });

  // ── Boot ────────────────────────────────────────────────────────────

  newTab(HOME_URL);
})();
