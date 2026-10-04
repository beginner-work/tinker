/* tinker — first-party analytics + editor keystroke buffer.
 *
 * Batches events to POST /api/analytics via sendBeacon or fetch keepalive.
 * Respects DNT / Global Privacy Control. Never records draft text, titles,
 * or key values — only categories, counts, and lengths.
 *
 * Vercel Web Analytics (page views) lives in vercel-analytics.js and never
 * receives custom events or keystrokes.
 */
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  var core = window.tinkerAnalyticsCore;
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
    var headers = { "Content-Type": "application/json", type: "application/json" };
    var auth = token();
    // sendBeacon cannot set Authorization; include a short-lived sibling
    // fetch keepalive when signed in so the server can link user id.
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

  function track(name, props) {
    try { return client.track(name, props, context()); }
    catch (e) { return null; }
  }

  function flush() {
    try { return client.flush(); }
    catch (e) { return Promise.resolve({ sent: false }); }
  }

  // page_view on boot
  track("page_view");

  // Auth gate hooks
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
      // Sign-in completed; signup vs signin distinguished by a one-shot flag
      // auth.js sets on window when verify returns.
      var isNew = false;
      try { isNew = !!window.__tinkerAuthIsNew; } catch (e) { /* ignore */ }
      track("signin_completed", { is_new: isNew });
      if (isNew) track("signup_completed", { is_new: true });
      flush();
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

  var editorWired = false;
  function wireEditor(root) {
    if (!root || editorWired && root.__tinkerKs) return;
    root.__tinkerKs = true;
    editorWired = true;
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
        // First printable / space in the session → first_words_typed (no content).
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
        // Count only — drop the text immediately.
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
      try { client.onSelectionOrFocus("focus"); } catch (e) { /* ignore */ }
    });
    root.addEventListener("focusout", function () {
      try { client.onSelectionOrFocus("blur"); } catch (e) { /* ignore */ }
    });
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

  // Public API for feature modules
  window.tinkerAnalytics = {
    track: track,
    flush: flush,
    client: client,
    wireEditor: wireEditor,
    wordCountBucket: core.wordCountBucket,
    context: context,
    keepCrafting: function () { track("keep_crafting_tapped"); },
    thisIsEverything: function () { track("this_is_everything_tapped"); },
    saveSucceeded: function () { track("save_succeeded"); },
    saveFailed: function (kind) {
      track("save_failed", { error_kind: String(kind || "unknown").slice(0, 64) });
    },
    writingSessionEnded: function (durationMs, wordCount) {
      track("writing_session_ended", {
        duration_ms: Math.round(Number(durationMs) || 0),
        word_count_bucket: core.wordCountBucket(wordCount),
      });
    },
  };

  function boot() {
    wireAuth();
    wireNav();
    observeEditors();
    wireLifecycle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
