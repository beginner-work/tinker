/* freewrite.js — free write mode.
 *
 * Free write mode turns on automatically the moment the device loses
 * its connection (navigator.onLine), and it's also available as a
 * manual override so you can write freely even with a connection. While
 * it's on:
 *
 *   - Same-origin /api/* requests are gated at the `fetch` boundary, so
 *     one switch covers Claude calls (platform-mobile.js), sync
 *     (sync.js), the feed, publish, classify, and the update poll.
 *     Gated requests resolve to a synthetic 503 with a friendly message,
 *     so the existing !res.ok / try-catch paths treat it as a clean
 *     outage rather than throwing. (When genuinely offline this just
 *     turns a raw network failure into a friendlier one.)
 *   - The writing view drops the Claude interview for a single
 *     free-write composer — see writing.js.
 *   - State is painted: a status pill, a pressed sidebar toggle, and a
 *     `freewrite-on` class on <html>.
 *
 * State is derived live from connectivity plus an in-session manual
 * override — nothing is persisted, so a reload always reflects the real
 * connection. The founder's words are safe regardless: the composer
 * autosaves into the draft (writing.js), and essays written offline are
 * flushed to the pitch automatically on reconnect (renderer.js).
 */

(function () {
  "use strict";

  const HTML = document.documentElement;

  // Manual override. Lets the founder choose free write while online;
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
        "Free write mode is on — your writing is saved on this device and " +
        "syncs when you reconnect.",
      freewrite: true,
    });
    return new Response(body, {
      status: 503,
      statusText: "Free write mode",
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

    const toggle = document.getElementById("nav-freewrite");
    if (toggle) {
      toggle.setAttribute("aria-pressed", on ? "true" : "false");
      // Can't switch off the offline-driven state, so disable the manual
      // toggle while genuinely offline.
      toggle.disabled = offline;
      const state = toggle.querySelector("[data-freewrite-state]");
      if (state) state.textContent = offline ? "Offline" : on ? "On" : "Off";
      toggle.title = offline
        ? "On automatically — you're offline"
        : "Write freely — no questions, no waiting";
    }

    const banner = document.getElementById("freewrite-banner");
    if (banner) banner.hidden = !on;
    const text = banner && banner.querySelector("[data-freewrite-text]");
    if (text) {
      text.textContent = offline
        ? "Free write — you're offline. Saved here; syncs when you reconnect."
        : "Free write — just write. Saved here, off to your pitch when you stop.";
    }
    // No "Turn off" while offline — there's nothing to turn off.
    const off = banner && banner.querySelector("[data-freewrite-off]");
    if (off) off.hidden = offline;
  }

  function emitChanged(on) {
    try {
      window.dispatchEvent(
        new CustomEvent("tinker:freewrite-changed", { detail: { on } }),
      );
    } catch { /* ignore */ }
  }

  let lastActive = active();
  function settle() {
    const now = active();
    reflect();
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
    const toggle = document.getElementById("nav-freewrite");
    if (toggle) {
      toggle.addEventListener("click", () => window.tinkerFreewrite.toggle());
    }
    document.querySelectorAll("[data-freewrite-off]").forEach((el) => {
      el.addEventListener("click", () => { forced = false; settle(); });
    });
    reflect();
    lastActive = active();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire, { once: true });
  } else {
    wire();
  }
})();
