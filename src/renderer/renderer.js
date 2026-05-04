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
  const TINKER_RECORD_URL = "tinker://record";
  const TINKER_TRAJECTORY_PREFIX = "tinker://trajectory/";

  // Fake placeholder share URL for v1. The real publishing slice (v1.1)
  // will swap this for a host that actually serves the trajectory page.
  const SHARE_URL_BASE = "https://beginner-work.github.io/beginner/";

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
  const welcomeTinkerBtn = $("#welcome-tinker");

  const tinkerSection = $("#tinker");
  const tinkerRecordBtn = $("#tinker-record");
  const tinkerRecorderEl = tinkerSection ? tinkerSection.querySelector(".tinker__recorder") : null;
  const tinkerStatusText = $("#tinker-status-text");
  const tinkerTimer = $("#tinker-timer");
  const tinkerTranscript = $("#tinker-transcript");
  const tinkerTranscriptBody = $("#tinker-transcript-body");
  const tinkerErrorEl = $("#tinker-error");
  const tinkerBackBtn = $("#tinker-back");
  const trajectoryHost = $("#trajectory-host");
  const trajectoryIframe = $("#trajectory-iframe");

  // ── Helpers ──────────────────────────────────────────────────────────

  const uid = () => "s_" + Math.random().toString(36).slice(2, 9);

  const getActive = () => sessions.find((s) => s.id === activeId) || null;

  /** Decide if a string is a navigable URL or should be searched. */
  function resolveQuery(raw) {
    const text = raw.trim();
    if (!text) return null;
    if (text === "home" || text === "tinker://home") return HOME_URL;
    if (text === "record" || text === TINKER_RECORD_URL) return TINKER_RECORD_URL;
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(text)) return text;
    if (/^[a-z]+:/i.test(text)) return text;
    const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(text);
    if (looksLikeHost) return "https://" + text;
    if (text.startsWith("localhost") || /^localhost(:\d+)/.test(text)) {
      return "http://" + text;
    }
    return SEARCH_PREFIX + encodeURIComponent(text);
  }

  /** Random base36 slug for trajectory URLs. */
  function newSlug() {
    return Math.random().toString(36).slice(2, 10);
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
      tinker.reset();
      render();
      return;
    }

    if (url === TINKER_RECORD_URL) {
      session.url = TINKER_RECORD_URL;
      session.title = "Talking…";
      removeSessionView(session);
      tinker.reset();
      render();
      return;
    }

    if (url.startsWith(TINKER_TRAJECTORY_PREFIX)) {
      const slug = url.substring(TINKER_TRAJECTORY_PREFIX.length).replace(/^\/+|\/+$/g, "");
      session.url = url;
      session.title = "Your trajectory";
      removeSessionView(session);
      mountedTrajectorySlug = slug;
      showTrajectory(slug);
      render();
      return;
    }

    if (url.startsWith(SEARCH_PREFIX)) {
      const query = decodeURIComponent(url.substring(SEARCH_PREFIX.length));
      showSearch(session, url, query);
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
      } else if (session.url === TINKER_RECORD_URL || session.url.startsWith(TINKER_TRAJECTORY_PREFIX)) {
        icon.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
          '<rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.6" fill="none"/>' +
          '<path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
          '<line x1="12" y1="18" x2="12" y2="21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
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

  // Slug currently mounted in the trajectory iframe, so switching
  // between trajectory sessions re-mounts only when the slug actually
  // changes (avoids a flash / re-fetch on every render).
  let mountedTrajectorySlug = null;

  function renderStage() {
    const active = getActive();
    const onHome = !!active && active.url === HOME_URL;
    const onTinkerRecord = !!active && active.url === TINKER_RECORD_URL;
    const onTrajectory = !!active && active.url.startsWith(TINKER_TRAJECTORY_PREFIX);

    welcome.toggleAttribute("data-active", onHome);
    if (tinkerSection) tinkerSection.toggleAttribute("data-active", onTinkerRecord);
    if (trajectoryHost) trajectoryHost.toggleAttribute("data-active", onTrajectory);

    if (onTrajectory) {
      const slug = active.url
        .substring(TINKER_TRAJECTORY_PREFIX.length)
        .replace(/^\/+|\/+$/g, "");
      if (slug && slug !== mountedTrajectorySlug) {
        mountedTrajectorySlug = slug;
        showTrajectory(slug);
      }
    }

    for (const session of sessions) {
      if (!session.view) continue;
      const isActive =
        session.id === activeId &&
        session.url !== HOME_URL &&
        session.url !== TINKER_RECORD_URL &&
        !session.url.startsWith(TINKER_TRAJECTORY_PREFIX);
      session.view.toggleAttribute("data-active", isActive);
    }
  }

  function renderNavState() {
    const session = getActive();
    const view = session && session.view;
    const isWebview = view && view.tagName.toLowerCase() === "webview";
    const onHome = !session || session.url === HOME_URL;
    const onTinker =
      session &&
      (session.url === TINKER_RECORD_URL || session.url.startsWith(TINKER_TRAJECTORY_PREFIX));
    navBack.disabled = onHome || onTinker || !isWebview || !view.canGoBack || !view.canGoBack();
    navForward.disabled = onHome || onTinker || !isWebview || !view.canGoForward || !view.canGoForward();
    navReload.disabled = onHome || onTinker;
  }

  function setLoading(active) {
    if (active) loadbar.setAttribute("data-active", "");
    else loadbar.removeAttribute("data-active");
  }

  // ── Tinker: voice capture → transcribe → organize → trajectory ──────
  //
  // State machine for the record screen. We record audio with
  // MediaRecorder, send the bytes to Whisper via the main process,
  // hand the transcript to Anthropic Haiku 4.5 (prompt-cached system
  // prompt) which returns a JSON payload of *verbatim* quotes, then
  // save the payload under a slug and navigate to the trajectory page.
  //
  // The hard line (product-spec §8): everything that lands on the
  // trajectory page is the founder's own words. The model rearranges,
  // never authors. This module never generates text on its own either.

  const tinker = (() => {
    let mediaStream = null;
    let mediaRecorder = null;
    let chunks = [];
    let timerHandle = null;
    let timerStart = 0;
    let state = "idle"; // idle | recording | working | done | error

    function setState(next) {
      state = next;
      if (tinkerRecorderEl) tinkerRecorderEl.dataset.state = next;
    }

    function setStatus(text) {
      if (tinkerStatusText) tinkerStatusText.textContent = text;
    }

    function setError(message) {
      if (!tinkerErrorEl) return;
      if (!message) {
        tinkerErrorEl.hidden = true;
        tinkerErrorEl.textContent = "";
        return;
      }
      tinkerErrorEl.hidden = false;
      tinkerErrorEl.innerHTML =
        '<strong>Something went wrong.</strong> ' +
        '<span></span>' +
        '<div style="margin-top:6px;color:var(--color-muted);font-size:13px;">Tap the record button to try again.</div>';
      tinkerErrorEl.querySelector("span").textContent = message;
    }

    function showTranscript(text) {
      if (!tinkerTranscript || !tinkerTranscriptBody) return;
      if (!text) {
        tinkerTranscript.hidden = true;
        tinkerTranscriptBody.textContent = "";
        return;
      }
      tinkerTranscript.hidden = false;
      tinkerTranscriptBody.textContent = text;
    }

    function startTimer() {
      timerStart = Date.now();
      if (tinkerTimer) tinkerTimer.textContent = "00:00";
      timerHandle = setInterval(() => {
        const sec = Math.floor((Date.now() - timerStart) / 1000);
        const m = String(Math.floor(sec / 60)).padStart(2, "0");
        const s = String(sec % 60).padStart(2, "0");
        if (tinkerTimer) tinkerTimer.textContent = `${m}:${s}`;
      }, 250);
    }

    function stopTimer() {
      if (timerHandle) clearInterval(timerHandle);
      timerHandle = null;
    }

    function teardownStream() {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try { mediaRecorder.stop(); } catch { /* noop */ }
      }
      if (mediaStream) {
        for (const track of mediaStream.getTracks()) track.stop();
      }
      mediaStream = null;
      mediaRecorder = null;
      chunks = [];
    }

    /** Reset to idle. Safe to call from anywhere. */
    function reset() {
      stopTimer();
      teardownStream();
      setState("idle");
      setStatus("Tap to start.");
      if (tinkerTimer) tinkerTimer.textContent = "00:00";
      showTranscript("");
      setError("");
    }

    async function start() {
      if (state === "recording" || state === "working") return;
      setError("");
      showTranscript("");
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        setState("error");
        setStatus("Microphone unavailable.");
        setError(
          (err && err.message) ||
            "Could not access the microphone. Check your system permissions and try again."
        );
        return;
      }

      const mimeType = pickMimeType();
      try {
        mediaRecorder = mimeType
          ? new MediaRecorder(mediaStream, { mimeType })
          : new MediaRecorder(mediaStream);
      } catch (err) {
        teardownStream();
        setState("error");
        setStatus("Recorder unavailable.");
        setError(
          (err && err.message) || "Could not start the recorder on this device."
        );
        return;
      }

      chunks = [];
      mediaRecorder.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      });
      mediaRecorder.addEventListener("stop", onRecordingStopped);
      mediaRecorder.start();

      setState("recording");
      setStatus("Listening… tap again to stop.");
      startTimer();
    }

    function stop() {
      if (state !== "recording") return;
      stopTimer();
      try {
        mediaRecorder && mediaRecorder.stop();
      } catch (err) {
        setState("error");
        setStatus("Couldn't stop cleanly.");
        setError((err && err.message) || String(err));
      }
    }

    async function onRecordingStopped() {
      const localChunks = chunks.slice();
      const recorderMime = (mediaRecorder && mediaRecorder.mimeType) || "audio/webm";
      // Stream tracks should be released as soon as recording is done so
      // the browser drops the mic indicator.
      if (mediaStream) {
        for (const track of mediaStream.getTracks()) track.stop();
        mediaStream = null;
      }

      if (localChunks.length === 0) {
        reset();
        setError("Nothing was recorded. Try again — speak for at least a few seconds.");
        return;
      }

      setState("working");
      setStatus("Transcribing your dump…");

      let transcript = "";
      try {
        const blob = new Blob(localChunks, { type: recorderMime });
        const audioBase64 = await blobToBase64(blob);
        const result = await window.tinker.transcribeAudio({
          audioBase64,
          mimeType: recorderMime,
        });
        transcript = (result && result.text) || "";
      } catch (err) {
        setState("error");
        setStatus("Transcription failed.");
        setError(
          (err && err.message) ||
            "The transcription service didn't respond. Check OPENAI_API_KEY and try again."
        );
        return;
      }

      if (!transcript.trim()) {
        setState("error");
        setStatus("Nothing came back from the transcript.");
        setError(
          "We couldn't hear words in that recording. Try again — a little louder, or in a quieter room."
        );
        return;
      }

      showTranscript(transcript);
      setStatus("Organizing your words…");

      let payload = null;
      try {
        const result = await window.tinker.organizeTranscript(transcript);
        payload = result && result.payload;
      } catch (err) {
        setState("error");
        setStatus("Organize step failed.");
        setError(
          (err && err.message) ||
            "Anthropic didn't respond. Check ANTHROPIC_API_KEY and try again."
        );
        return;
      }

      if (!payload || typeof payload !== "object") {
        setState("error");
        setStatus("The organizer returned nothing usable.");
        setError("The model returned an empty payload. Try again.");
        return;
      }

      const slug = newSlug();
      const fullPayload = {
        slug,
        created_at: new Date().toISOString(),
        transcript,
        ...payload,
      };
      try {
        await window.tinker.saveTrajectory(slug, fullPayload);
      } catch (err) {
        // Save failure shouldn't block rendering — the iframe payload
        // is injected from memory, not read from disk. Surface it as a
        // soft warning in the console.
        console.warn("[tinker] saveTrajectory failed:", err);
      }

      setState("done");
      setStatus("Here it is.");

      // Hand the payload to the trajectory iframe via the parent-window
      // bridge, then navigate the active session to its URL.
      window.__tinkerPayload = fullPayload;
      window.__tinkerShareUrl = SHARE_URL_BASE + slug;
      navigate(TINKER_TRAJECTORY_PREFIX + slug);
    }

    function pickMimeType() {
      if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      for (const c of candidates) {
        if (MediaRecorder.isTypeSupported(c)) return c;
      }
      return null;
    }

    function blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result || "";
          const idx = result.indexOf(",");
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
        reader.readAsDataURL(blob);
      });
    }

    function toggleRecord() {
      if (state === "idle" || state === "error") {
        start();
      } else if (state === "recording") {
        stop();
      }
      // working / done are pass-through.
    }

    return { reset, toggleRecord };
  })();

  // Mount the trajectory iframe with a stored or in-memory payload.
  // The iframe page (templates/trajectory.html) reads
  // window.parent.__tinkerPayload as soon as it loads, and also listens
  // for postMessage updates after that.
  function showTrajectory(slug) {
    if (!trajectoryIframe || !slug) return;
    const shareUrl = SHARE_URL_BASE + slug;
    window.__tinkerShareUrl = shareUrl;

    // If we have an in-memory payload from the just-completed dump, use it.
    // Otherwise fall back to loading from disk by slug.
    const inMemory =
      window.__tinkerPayload && window.__tinkerPayload.slug === slug
        ? window.__tinkerPayload
        : null;

    const post = (payload) => {
      window.__tinkerPayload = payload;
      try {
        trajectoryIframe.contentWindow &&
          trajectoryIframe.contentWindow.postMessage(
            { type: "trajectory:payload", payload, shareUrl },
            "*"
          );
      } catch { /* noop */ }
    };

    const onLoad = () => {
      const payload = window.__tinkerPayload;
      if (payload) post(payload);
    };

    // Reset src so navigating between trajectories actually re-renders.
    // The slug param is just a cache-buster — the iframe reads the
    // payload from window.parent.__tinkerPayload, not from the URL.
    trajectoryIframe.removeEventListener("load", onLoad);
    trajectoryIframe.addEventListener("load", onLoad);
    trajectoryIframe.src = "./templates/trajectory.html?slug=" + encodeURIComponent(slug);

    if (inMemory) {
      // Already in memory — onLoad above will hand it over.
      return;
    }
    // Pull from disk by slug. If absent, the empty state renders.
    if (window.tinker && typeof window.tinker.loadTrajectory === "function") {
      window.tinker
        .loadTrajectory(slug)
        .then((payload) => {
          if (payload) {
            window.__tinkerPayload = payload;
            post(payload);
          }
        })
        .catch((err) => {
          console.warn("[tinker] loadTrajectory failed:", err);
        });
    }
  }

  // Listen for the iframe's "ready" handshake so we can hand it the
  // payload even if it loads after we've set window.__tinkerPayload.
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "trajectory:ready") return;
    const payload = window.__tinkerPayload;
    const shareUrl = window.__tinkerShareUrl;
    if (!payload) return;
    try {
      e.source &&
        e.source.postMessage(
          { type: "trajectory:payload", payload, shareUrl },
          "*"
        );
    } catch { /* noop */ }
  });

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

  if (welcomeTinkerBtn) {
    welcomeTinkerBtn.addEventListener("click", () => navigate(TINKER_RECORD_URL));
  }

  if (tinkerRecordBtn) {
    tinkerRecordBtn.addEventListener("click", () => tinker.toggleRecord());
  }

  if (tinkerBackBtn) {
    tinkerBackBtn.addEventListener("click", () => {
      tinker.reset();
      navigate(HOME_URL);
    });
  }

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
