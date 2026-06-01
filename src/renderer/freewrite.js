/* freewrite.js — No AI mode.
 *
 * No AI mode turns on automatically the moment the device loses its
 * connection (navigator.onLine), and it's also available as a manual
 * choice — the floating bottom mode nav (#mode-nav) — so you can write
 * freely even with a connection. While it's on:
 *
 *   - Same-origin /api/* requests are gated at the `fetch` boundary, so
 *     one switch covers Claude calls (platform-mobile.js), sync
 *     (sync.js), the feed, publish, classify, and the update poll.
 *     Gated requests resolve to a synthetic 503 with a friendly message,
 *     so the existing !res.ok / try-catch paths treat it as a clean
 *     outage rather than throwing. (When genuinely offline this just
 *     turns a raw network failure into a friendlier one.)
 *   - The writing view drops the Claude interview for a single No AI
 *     composer that mirrors the interview's question card — see writing.js.
 *   - State is painted: the bottom mode nav highlights the active segment
 *     (sparkle = AI, writing hand = No AI) and a `freewrite-on` class
 *     lands on <html>.
 *   - A connection drop slides the "You're offline" sliver out of the
 *     bottom of the mode nav, and fires a toast through the notification
 *     component (notifications.js) so the founder knows. While offline
 *     the AI segment is disabled — there's nothing to talk to.
 *
 * State is derived live from connectivity plus an in-session manual
 * choice — nothing is persisted, so a reload always reflects the real
 * connection. The founder's words are safe regardless: the composer
 * autosaves into the draft (writing.js), and essays written offline are
 * flushed to the pitch automatically on reconnect (renderer.js).
 */

(function () {
  "use strict";

  const HTML = document.documentElement;

  // Manual choice. Lets the founder pick No AI mode while online;
  // connectivity forces it on regardless.
  let forced = false;

  function isOffline() { return navigator.onLine === false; }
  function active() { return forced || isOffline(); }

  /* ── Network gate ──────────────────────────────────────────────────*/
  const realFetch =
    typeof window.fetch === "function" ? window.fetch.bind(window) : null;

  function isApiRequest(input) {
    let href = "";
    if (typeof input === "string") href = input;
    else if (input instanceof URL) href = input.href;
    else if (input && typeof input.url === "string") href = input.url;
    if (!href) return false;
    let url;
    try { url = new URL(href, window.location.href); }
    catch { return false; }
    return url.origin === window.location.origin
      && url.pathname.startsWith("/api/");
  }

  function groundedResponse() {
    const body = JSON.stringify({
      error:
        "No AI mode is on — your writing is saved on this device and " +
        "syncs when you reconnect.",
      freewrite: true,
    });
    return new Response(body, {
      status: 503,
      statusText: "No AI mode",
      headers: { "Content-Type": "application/json" },
    });
  }

  if (realFetch) {
    window.fetch = function (input, init) {
      if (active() && isApiRequest(input)) {
        return Promise.resolve(groundedResponse());
      }
      return realFetch(input, init);
    };
  }

  /* ── State paint ───────────────────────────────────────────────────*/
  function reflect() {
    const on = active();
    const offline = isOffline();
    HTML.classList.toggle("freewrite-on", on);

    // Bottom mode nav: highlight the live segment. No AI is pressed when
    // the mode is on; AI is pressed otherwise. Offline forces No AI, so
    // the AI segment is disabled then (there's nothing to talk to).
    const aiBtn = document.getElementById("mode-ai");
    const noaiBtn = document.getElementById("mode-noai");
    if (aiBtn) {
      aiBtn.setAttribute("aria-pressed", on ? "false" : "true");
      aiBtn.disabled = offline;
      aiBtn.title = offline
        ? "You're offline — No AI mode is on automatically"
        : "Write with AI — the guided interview";
    }
    if (noaiBtn) {
      noaiBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }

    // The "You're offline" sliver hangs off the bottom of the nav while
    // genuinely offline. The toast (notifications.js) announces the drop
    // once; the sliver is the persistent marker.
    const sliver = document.querySelector("[data-offline-sliver]");
    if (sliver) sliver.hidden = !offline;
  }

  function emitChanged(on) {
    try {
      window.dispatchEvent(
        new CustomEvent("tinker:freewrite-changed", { detail: { on } }),
      );
    } catch { /* ignore */ }
  }

  // Reuse the notification component (notifications.js) to tell the
  // founder they've dropped offline. Prefer the direct call; fall back
  // to the tinker:notify event the same way renderer.js does, so this
  // works regardless of script load order.
  function notifyOffline() {
    const payload = {
      kind: "freewrite",
      title: "You're offline",
      body:
        "No AI mode is on. Your writing is saved on this device and " +
        "syncs when you reconnect.",
    };
    try {
      if (typeof window.tinkerNotify === "function") window.tinkerNotify(payload);
      else window.dispatchEvent(new CustomEvent("tinker:notify", { detail: payload }));
    } catch { /* ignore */ }
  }

  let lastActive = active();
  let lastOffline = isOffline();
  function settle() {
    const now = active();
    const offline = isOffline();
    reflect();
    // A connection drop flips free write on automatically — surface it
    // as a toast. Tracked separately from `active` so a manual override
    // that's already on still gets the offline notice.
    if (offline !== lastOffline) {
      lastOffline = offline;
      if (offline) notifyOffline();
    }
    if (now === lastActive) return;
    lastActive = now;
    emitChanged(now);
    // Reconnected (or manually switched off): push anything deferred and
    // pull the latest server state so the device catches up.
    if (!now && window.tinkerSync) {
      try { window.tinkerSync.flush(); } catch { /* ignore */ }
      try { window.tinkerSync.hydrate(); } catch { /* ignore */ }
    }
  }

  window.tinkerFreewrite = {
    isOn: () => active(),
    isOffline: () => isOffline(),
    setForced(v) { forced = !!v; settle(); },
    toggle() { forced = !active(); settle(); },
  };

  /* ── Wiring ────────────────────────────────────────────────────────*/
  window.addEventListener("online", settle);
  window.addEventListener("offline", settle);

  function wire() {
    // Bottom mode nav: the sparkle picks AI (mode off), the writing hand
    // picks No AI (mode on). Offline forces No AI, so the AI segment is
    // inert then — guarded by the disabled flag set in reflect().
    const aiBtn = document.getElementById("mode-ai");
    const noaiBtn = document.getElementById("mode-noai");
    if (aiBtn) {
      aiBtn.addEventListener("click", () => {
        if (aiBtn.disabled) return;
        forced = false; settle();
      });
    }
    if (noaiBtn) {
      noaiBtn.addEventListener("click", () => { forced = true; settle(); });
    }
    // Back-compat: any lingering "turn off" affordances still work.
    document.querySelectorAll("[data-freewrite-off]").forEach((el) => {
      el.addEventListener("click", () => { forced = false; settle(); });
    });
    reflect();
    lastActive = active();
    lastOffline = isOffline();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire, { once: true });
  } else {
    wire();
  }
})();
