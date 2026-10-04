/* tinker — first-party analytics + editor keystroke buffer + owner edit log.
 *
 * Batches events to POST /api/analytics via sendBeacon or fetch keepalive.
 * Respects DNT / Global Privacy Control.
 *
 * Content policy:
 *   - Everyone: categories, counts, lengths only (never draft text / key values)
 *   - Metrics owner only: full insert/delete edit log with text, for the
 *     "How I write" learning view. Gated by GET ?action=capabilities.
 *
 * Vercel Web Analytics (page views) lives in vercel-analytics.js and never
 * receives custom events, keystrokes, or owner edit text.
 */
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  var core = window.tinkerAnalyticsCore;
  var ownerEdit = window.tinkerAnalyticsOwnerEdit;
  if (!core || typeof core.createAnalyticsClient !== "function") return;

  function token() {
    try { return localStorage.getItem("tinker_jwt") || ""; }
    catch (e) { return ""; }
  }

  function appVersion() {
    try {
      var scripts = document.getElementsByTagName("script");
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].getAttribute("src") || "";
        var m = src.match(/[?&]v=(\d+)/);
        if (m) return m[1];
      }
    } catch (e) { /* ignore */ }
    return "";
  }

  function context() {
    var w = 0;
    var h = 0;
    try {
      w = window.innerWidth || 0;
      h = window.innerHeight || 0;
    } catch (e) { /* ignore */ }
    var path = "/";
    try { path = (window.location.pathname || "/") + (window.location.search || ""); }
    catch (e2) { /* ignore */ }
    return {
      viewportW: w,
      viewportH: h,
      path: path.slice(0, 256),
      appVersion: appVersion(),
    };
  }

  function sendBody(body) {
    var json = JSON.stringify(body);
    var auth = token();
    if (auth) {
      return fetch("/api/analytics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + auth,
        },
        body: json,
        keepalive: true,
        credentials: "same-origin",
      }).then(function () { /* ignore status */ }).catch(function () { /* silent */ });
    }
    // Strip ownerEdits when anonymous — server would reject anyway, and
    // we must never beacon text without auth.
    if (body && body.ownerEdits && body.ownerEdits.length) {
      body = {
        events: body.events || [],
        keystrokes: body.keystrokes || [],
        ownerEdits: [],
      };
      json = JSON.stringify(body);
    }
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([json], { type: "application/json" });
        var ok = navigator.sendBeacon("/api/analytics", blob);
        if (ok) return Promise.resolve();
      }
    } catch (e) { /* fall through */ }
    return fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: true,
      credentials: "same-origin",
    }).then(function () {}).catch(function () {});
  }

  var client = core.createAnalyticsClient({
    storage: window.localStorage,
    navigator: window.navigator,
    send: sendBody,
    flushMs: 5000,
  });

  try {
    client.captureFirstTouch(
      window.location.search || "",
      document.referrer || "",
      window.location.hostname || ""
    );
  } catch (e) { /* ignore */ }

  // Owner edit-log state (off until capabilities says otherwise).
  var ownerEditLog = false;
  var ownerOps = [];
  var ownerChunkIndex = 0;
  var ownerStartedAt = null;
  var ownerPendingChunks = [];
  var lastEditorValue = Object.create(null);

  function ownerMs() {
    if (!ownerStartedAt) ownerStartedAt = Date.now();
    return Math.max(0, Date.now() - ownerStartedAt);
  }

  function pushOwnerOps(ops) {
    if (!ownerEditLog || !ops || !ops.length) return;
    for (var i = 0; i < ops.length; i++) ownerOps.push(ops[i]);
    if (ownerOps.length >= 200) queueOwnerChunk();
    else client.scheduleFlush();
  }

  function queueOwnerChunk() {
    if (!ownerOps.length) return null;
    var ids = client.ensureIds();
    var chunk = {
      sessionId: ids.sessionId,
      anonymousId: ids.anonymousId,
      startedAt: ownerStartedAt || Date.now(),
      chunkIndex: ownerChunkIndex++,
      ops: ownerOps.slice(),
    };
    ownerOps = [];
    ownerPendingChunks.push(chunk);
    if (ownerPendingChunks.length > 20) {
      ownerPendingChunks = ownerPendingChunks.slice(-20);
    }
    return chunk;
  }

  function takeOwnerEdits() {
    if (ownerOps.length) queueOwnerChunk();
    var out = ownerPendingChunks.slice();
    ownerPendingChunks = [];
    return out;
  }

  // Surface / prompt attribution (ids only — no copy).
  var surfaceQueue = [];

  function trackSurface(name, fields) {
    if (client.isDisabled()) return null;
    try {
      var ids = client.ensureIds();
      var f = fields || {};
      var props = {};
      if (f.props && typeof f.props === "object") {
        props = client.sanitizeClientProps
          ? client.sanitizeClientProps(f.props)
          : f.props;
      }
      // Allow top-level numeric shorthand used by pad reveal.
      ["delay_ms", "median_gap_ms"].forEach(function (key) {
        if (typeof f[key] === "number" && Number.isFinite(f[key])) {
          props[key] = Math.round(f[key]);
        }
      });
      surfaceQueue.push({
        name: String(name || "").slice(0, 64),
        sessionId: ids.sessionId,
        anonymousId: ids.anonymousId,
        surfaceId: String(f.surfaceId || "").slice(0, 64),
        promptId: String(f.promptId || "").slice(0, 64),
        variantId: String(f.variantId || "").slice(0, 32),
        position: String(f.position || "").slice(0, 32),
        props: props,
        ts: Date.now(),
      });
      if (surfaceQueue.length > 40) surfaceQueue = surfaceQueue.slice(-40);
      client.scheduleFlush();
      return surfaceQueue[surfaceQueue.length - 1];
    } catch (e) {
      return null;
    }
  }

  function takeSurfaceEvents() {
    var out = surfaceQueue.slice();
    surfaceQueue = [];
    return out;
  }

  function track(name, props) {
    try { return client.track(name, props, context()); }
    catch (e) { return null; }
  }

  function flush() {
    try {
      var owner = takeOwnerEdits();
      var surfaces = takeSurfaceEvents();
      return client.flush({ ownerEdits: owner }).then(function (result) {
        if (!surfaces.length) return result;
        // Send surface events in a follow-up body (core flush doesn't know them yet).
        return sendBody({
          events: [],
          keystrokes: [],
          ownerEdits: [],
          surfaceEvents: surfaces,
        }).then(function () { return result; });
      });
    } catch (e) {
      return Promise.resolve({ sent: false });
    }
  }

  function refreshCapabilities() {
    var t = token();
    if (!t) {
      ownerEditLog = false;
      return Promise.resolve(false);
    }
    return fetch("/api/analytics?action=capabilities", {
      headers: { Authorization: "Bearer " + t, Accept: "application/json" },
    })
      .then(function (res) { return res.ok ? res.json() : { ownerEditLog: false }; })
      .then(function (json) {
        ownerEditLog = !!(json && json.ownerEditLog);
        return ownerEditLog;
      })
      .catch(function () {
        ownerEditLog = false;
        return false;
      });
  }

  track("page_view");

  function wireAuth() {
    var gate = document.getElementById("auth-gate");
    if (gate && !gate.hidden) track("signin_gate_shown");

    var phoneForm = document.getElementById("auth-phone-form");
    if (phoneForm && !phoneForm.__tinkerAnalytics) {
      phoneForm.__tinkerAnalytics = true;
      phoneForm.addEventListener("submit", function () {
        track("signin_started");
      });
    }

    window.addEventListener("tinker:auth-changed", function () {
      var isNew = false;
      try { isNew = !!window.__tinkerAuthIsNew; } catch (e) { /* ignore */ }
      track("signin_completed", { is_new: isNew });
      if (isNew) track("signup_completed", { is_new: true });
      refreshCapabilities().then(function () { flush(); });
    });
  }

  function wireNav() {
    document.addEventListener("click", function (ev) {
      var el = ev.target;
      if (!el || !el.closest) return;
      var a = el.closest("a[href]");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (href === "/repo" || href.indexOf("/repo") === 0) track("stories_nav_tapped");
      else if (href.indexOf("write=1") !== -1 || href === "/?write=1") track("write_nav_tapped");
      else if (href.indexOf("/settings") === 0) track("settings_nav_tapped");
      else if (href.indexOf("/feed") === 0) track("feed_nav_tapped");
      else if (href.indexOf("/metrics") === 0) track("metrics_nav_tapped");
      else if (href.indexOf("/leads") === 0) track("leads_nav_tapped");
      else if (href.indexOf("/career") === 0) track("career_nav_tapped");
      else if (href.indexOf("/autonomy") === 0) track("autonomy_nav_tapped");
    }, true);
  }

  function readEditorValue(root) {
    if (!root) return "";
    if (typeof root.value === "string") return root.value;
    try { return root.innerText || root.textContent || ""; }
    catch (e) { return ""; }
  }

  function wireOwnerText(root) {
    if (!ownerEdit || !root || root.__tinkerOwnerEdit) return;
    root.__tinkerOwnerEdit = true;
    var key = root.id || ("ed-" + Math.random().toString(36).slice(2));
    lastEditorValue[key] = readEditorValue(root);

    function onInput() {
      if (!ownerEditLog) return;
      try {
        var prev = lastEditorValue[key] || "";
        var next = readEditorValue(root);
        lastEditorValue[key] = next;
        var ops = ownerEdit.diffEdit(prev, next, ownerMs());
        pushOwnerOps(ops);
        if (next && /[A-Za-z0-9]/.test(next)) client.markFirstWords(context());
      } catch (e) { /* never block typing */ }
    }

    root.addEventListener("input", onInput);
  }

  function wireEditor(root) {
    if (!root || root.__tinkerKs) return;
    root.__tinkerKs = true;
    track("editor_opened");

    function onKeyDown(ev) {
      var t0 = typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
      try {
        client.onKeyEvent({
          key: ev.key,
          code: ev.code,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          shiftKey: ev.shiftKey,
        }, t0);
        if (ev.key && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
          client.markFirstWords(context());
        }
      } catch (e) { /* never block typing */ }
    }

    root.addEventListener("keydown", onKeyDown);

    root.addEventListener("paste", function (ev) {
      try {
        var text = "";
        try {
          text = (ev.clipboardData && ev.clipboardData.getData("text")) || "";
        } catch (e) { text = ""; }
        var n = text ? text.length : 0;
        text = "";
        client.onPasteOrCut("paste", n);
        if (n > 0) client.markFirstWords(context());
      } catch (e2) { /* ignore */ }
    });

    root.addEventListener("cut", function (ev) {
      try {
        var text = "";
        try {
          text = (ev.clipboardData && ev.clipboardData.getData("text")) || "";
        } catch (e) { text = ""; }
        var n = text ? text.length : 0;
        text = "";
        client.onPasteOrCut("cut", n);
      } catch (e2) { /* ignore */ }
    });

    root.addEventListener("compositionend", function (ev) {
      try {
        var data = (ev && ev.data) || "";
        var n = data ? data.length : 0;
        data = "";
        client.onIme(n);
        if (n > 0) client.markFirstWords(context());
      } catch (e) { /* ignore */ }
    });

    root.addEventListener("select", function () {
      try { client.onSelectionOrFocus("selection"); } catch (e) { /* ignore */ }
    });
    root.addEventListener("focusin", function () {
      try {
        client.onSelectionOrFocus("focus");
        trackSurface("editor_focus", { surfaceId: "editor.writing_input" });
      } catch (e) { /* ignore */ }
    });
    root.addEventListener("focusout", function () {
      try {
        client.onSelectionOrFocus("blur");
        trackSurface("editor_blur", { surfaceId: "editor.writing_input" });
      } catch (e) { /* ignore */ }
    });

    wireOwnerText(root);
  }

  function observeEditors() {
    function scan() {
      var nodes = document.querySelectorAll(
        "textarea.writing-input, #repo-editor, .repo-surface__editor, textarea.messages-notepad__input, .ProseMirror, [contenteditable='true']"
      );
      for (var i = 0; i < nodes.length; i++) wireEditor(nodes[i]);
    }
    scan();
    try {
      var mo = new MutationObserver(function () { scan(); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }
  }

  function wireLifecycle() {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", function () { flush(); });
  }

  function markOwner(mark) {
    if (!ownerEditLog || !ownerEdit) return;
    try {
      pushOwnerOps([ownerEdit.markerOp(ownerMs(), mark)]);
    } catch (e) { /* ignore */ }
  }

  window.tinkerAnalytics = {
    track: track,
    flush: flush,
    client: client,
    wireEditor: wireEditor,
    wordCountBucket: core.wordCountBucket,
    context: context,
    ownerEditLogEnabled: function () { return ownerEditLog; },
    trackSurface: trackSurface,
    promptShown: function (promptId, variantId, position) {
      return trackSurface("prompt_shown", {
        promptId: promptId,
        variantId: variantId || "A",
        position: position || "",
      });
    },
    surfaceTapped: function (surfaceId) {
      return trackSurface("surface_tapped", { surfaceId: surfaceId });
    },
    keepCrafting: function () {
      track("keep_crafting_tapped");
      trackSurface("surface_tapped", { surfaceId: "btn.keep_crafting" });
      markOwner("keep_crafting");
    },
    thisIsEverything: function () {
      track("this_is_everything_tapped");
      trackSurface("surface_tapped", { surfaceId: "btn.this_is_everything" });
      markOwner("this_is_everything");
    },
    padActionsRevealed: function (delayMs, medianGapMs) {
      var delay = Math.round(Number(delayMs) || 0);
      var median = Math.round(Number(medianGapMs) || 0);
      track("pad_actions_revealed", {
        delay_ms: delay,
        median_gap_ms: median,
      });
      return trackSurface("pad_actions_revealed", {
        surfaceId: "repo.pad_actions",
        delay_ms: delay,
        median_gap_ms: median,
      });
    },
    saveSucceeded: function () { track("save_succeeded"); },
    saveFailed: function (kind) {
      track("save_failed", { error_kind: String(kind || "unknown").slice(0, 64) });
    },
    writingSessionEnded: function (durationMs, wordCount) {
      track("writing_session_ended", {
        duration_ms: Math.round(Number(durationMs) || 0),
        word_count_bucket: core.wordCountBucket(wordCount),
      });
      trackSurface("session_end", {});
    },
  };

  function boot() {
    wireAuth();
    wireNav();
    observeEditors();
    wireLifecycle();
    refreshCapabilities();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
