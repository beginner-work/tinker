/* airplane.js — a deliberate offline switch for tinker.
 *
 * tinker already survives a dropped connection: every blob round-trips
 * through localStorage first (see sync.js), and the network is only
 * ever a best-effort mirror. Airplane mode makes that resilience a
 * choice instead of an accident — flip it on before you board, keep
 * writing on the device, and let the world reconnect when you land.
 *
 * What it does while airborne:
 *   - Gates every same-origin /api/* request at the `fetch` boundary,
 *     so one switch covers Claude calls (platform-mobile.js),
 *     cross-device sync (sync.js), the feed, publish, classify, and
 *     the update poll — without each module having to know about it.
 *     Gated requests resolve to a synthetic 503 carrying a friendly
 *     message, so the existing `!res.ok` / try-catch paths treat it as
 *     a clean outage rather than throwing. A blocked Claude call
 *     surfaces that message verbatim in the writing view.
 *   - Paints the state: a sky-tinted status pill, a pressed sidebar
 *     toggle, and an `airplane-on` class on <html> for any CSS that
 *     wants to react.
 *
 * On landing (toggled off) it flushes anything queued during the
 * flight and re-hydrates from the server so the device catches up.
 *
 * State lives in localStorage under "tinker.airplaneMode.v1" and is
 * read synchronously at load, so a reload taken mid-flight stays
 * grounded instead of silently phoning home on boot.
 */

(function () {
  "use strict";

  const LS_KEY = "tinker.airplaneMode.v1";
  const STORE = window.localStorage;
  const HTML = document.documentElement;

  function readState() {
    try { return STORE.getItem(LS_KEY) === "1"; } catch { return false; }
  }
  function persist(on) {
    try {
      if (on) STORE.setItem(LS_KEY, "1");
      else STORE.removeItem(LS_KEY);
    } catch { /* ignore */ }
  }

  // Read once, synchronously, before any module gets a chance to fetch.
  let airborne = readState();

  /* ── Network gate ──────────────────────────────────────────────────
   * Wrap fetch so same-origin /api/* calls short-circuit while we're in
   * airplane mode. Everything else (already-cached assets, the odd
   * cross-origin link) passes straight through. */
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
        "Airplane mode is on. Turn it off in the sidebar to reconnect — " +
        "your writing is saved on this device.",
      airplaneMode: true,
    });
    return new Response(body, {
      status: 503,
      statusText: "Airplane mode",
      headers: { "Content-Type": "application/json" },
    });
  }

  if (realFetch) {
    window.fetch = function (input, init) {
      if (airborne && isApiRequest(input)) {
        return Promise.resolve(groundedResponse());
      }
      return realFetch(input, init);
    };
  }

  /* ── State paint ───────────────────────────────────────────────────*/
  function reflect() {
    HTML.classList.toggle("airplane-on", airborne);

    const toggle = document.getElementById("nav-airplane");
    if (toggle) {
      toggle.setAttribute("aria-pressed", airborne ? "true" : "false");
      const state = toggle.querySelector("[data-airplane-state]");
      if (state) state.textContent = airborne ? "On" : "Off";
    }

    const banner = document.getElementById("airplane-banner");
    if (banner) banner.hidden = !airborne;
  }

  function setState(next) {
    const was = airborne;
    airborne = !!next;
    if (was === airborne) { reflect(); return; }
    persist(airborne);
    reflect();
    try {
      window.dispatchEvent(
        new CustomEvent("tinker:airplane-changed", { detail: { on: airborne } }),
      );
    } catch { /* ignore */ }
    // Landing: push anything deferred during the flight, then pull the
    // latest server state so the device catches up on both directions.
    if (!airborne && window.tinkerSync) {
      try { window.tinkerSync.flush(); } catch { /* ignore */ }
      try { window.tinkerSync.hydrate(); } catch { /* ignore */ }
    }
  }

  window.tinkerAirplane = {
    isOn: () => airborne,
    enable: () => setState(true),
    disable: () => setState(false),
    toggle: () => setState(!airborne),
  };

  /* ── Wiring ────────────────────────────────────────────────────────*/
  function wire() {
    const toggle = document.getElementById("nav-airplane");
    if (toggle) {
      toggle.addEventListener("click", () => setState(!airborne));
    }
    // The status pill (and anywhere else) can offer a one-tap exit.
    document.querySelectorAll("[data-airplane-off]").forEach((el) => {
      el.addEventListener("click", () => setState(false));
    });
    reflect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire, { once: true });
  } else {
    wire();
  }
})();
