/* pwa-install-hint.js — iOS install banner + bottom-sheet,
 * re-implemented as a minimal show/hide via the `hidden` attribute.
 *
 * No transforms, no transitions, no theme-color juggling, no
 * compositing-layer hints. The browser toggles `display: none`
 * ↔ default for both elements; iOS renders them in its
 * normal document paint layer with no transit-shadow artifacts.
 *
 * Banner shows when all of: an iOS WebKit browser that exposes
 * Add to Home Screen (Safari or Chrome — every iOS browser is
 * WebKit-backed, but in-app webviews like DuckDuckGo / GSA hide
 * the share-sheet entry, so those stay excluded), not running
 * standalone, not inside Capacitor / Electron, not previously
 * dismissed. Tap Install → open the instructions sheet. Tap X →
 * dismiss (persisted in localStorage). Installing the PWA
 * mid-session flips the display-mode media query and the whole
 * thing disappears.
 */

(function () {
  const STORAGE_KEY = "tinker_pwa_hint_dismissed";
  const SHOW_DELAY_MS = 800;

  function isIosInstallableBrowser() {
    const ua = navigator.userAgent || "";
    const isIosDevice =
      /iPhone|iPod|iPad/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isIosDevice) return false;
    // In-app webviews (DuckDuckGo Privacy Browser, Google app) strip the
    // share-sheet entry for Add to Home Screen, so the banner has nothing
    // useful to point users at. Safari and Chrome iOS both expose it.
    if (/FxiOS|EdgiOS|OPiOS|mercury|DuckDuckGo|GSA/i.test(ua)) return false;
    // Safari sends "Safari", Chrome iOS sends "CriOS" — accept either.
    if (!/Safari|CriOS/i.test(ua)) return false;
    return true;
  }

  function isStandalone() {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  function isWrappedRuntime() {
    if (window.Capacitor) return true;
    if (window.tinker && window.tinker.supportsWebview === true) return true;
    return false;
  }

  function dismissed() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
  }
  function markDismissed() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* private mode */ }
  }

  function init() {
    if (isWrappedRuntime()) return;
    if (!isIosInstallableBrowser()) return;
    if (isStandalone()) return;
    if (dismissed()) return;

    const banner = document.getElementById("pwa-hint");
    const sheet = document.getElementById("pwa-hint-sheet");
    if (!banner) return;

    if (sheet) {
      const hostEl = sheet.querySelector("[data-pwa-host]");
      if (hostEl) hostEl.textContent = window.location.hostname;
      // Sheet anchors to the bottom — same side as iOS Safari's URL
      // bar (the default since iOS 15). Putting the instructions on
      // the same side as the action means when the user taps Share
      // and the iOS share sheet rises, it covers both the URL bar
      // AND our instructions together; when the share sheet closes,
      // the instructions are right where the user's attention was.
      // Anchoring to the opposite side (top) leaves the instructions
      // visible until the user taps Share, then hides them precisely
      // when step 2 needs re-reading.
    }

    function showBanner() {
      banner.hidden = false;
      document.documentElement.classList.add("pwa-hint-visible");
    }
    function hideAll({ remember = true } = {}) {
      banner.hidden = true;
      if (sheet) sheet.hidden = true;
      document.documentElement.classList.remove("pwa-hint-visible");
      if (remember) markDismissed();
    }
    function openSheet() { if (sheet) sheet.hidden = false; }
    function closeSheet() { if (sheet) sheet.hidden = true; }

    // Wait for the auth gate to drop before announcing ourselves so
    // we don't fight the sign-in flow for attention.
    const gate = document.getElementById("auth-gate");
    if (gate && !gate.hidden) {
      const obs = new MutationObserver(() => {
        if (gate.hidden) {
          obs.disconnect();
          setTimeout(showBanner, SHOW_DELAY_MS);
        }
      });
      obs.observe(gate, { attributes: true, attributeFilter: ["hidden"] });
    } else {
      setTimeout(showBanner, SHOW_DELAY_MS);
    }

    banner.addEventListener("click", (e) => {
      const action = e.target.closest("[data-pwa-action]");
      if (!action) return;
      const kind = action.dataset.pwaAction;
      if (kind === "install") openSheet();
      else if (kind === "dismiss") hideAll();
    });

    if (sheet) {
      // Direct listeners on the dismiss targets — the previous
      // delegated handler via e.target.closest() was unreliable on
      // iOS Safari taps where the SVG path was the event target.
      const closeBtn = sheet.querySelector(".pwa-hint-sheet__close");
      const backdrop = sheet.querySelector(".pwa-hint-sheet__backdrop");
      if (closeBtn) closeBtn.addEventListener("click", closeSheet);
      if (backdrop) backdrop.addEventListener("click", closeSheet);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !sheet.hidden) closeSheet();
      });
    }

    // Auto-disappear if the user installs mid-session.
    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => { if (mq.matches) hideAll({ remember: false }); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
