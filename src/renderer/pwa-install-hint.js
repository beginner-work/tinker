/* pwa-install-hint.js — iOS Safari install banner + bottom-sheet,
 * re-implemented as a minimal show/hide via the `hidden` attribute.
 *
 * No transforms, no transitions, no theme-color juggling, no
 * compositing-layer hints. The browser toggles `display: none`
 * ↔ default for both elements; iOS Safari renders them in its
 * normal document paint layer with no transit-shadow artifacts.
 *
 * Banner shows when all of: iOS Safari (mobile web, not Chrome /
 * Firefox / etc. on iOS), not running standalone, not inside
 * Capacitor / Electron, not previously dismissed. Tap Install →
 * open the instructions sheet. Tap X → dismiss (persisted in
 * localStorage). Installing the PWA mid-session flips the
 * display-mode media query and the whole thing disappears.
 */

(function () {
  const STORAGE_KEY = "tinker_pwa_hint_dismissed";
  const SHOW_DELAY_MS = 800;

  function isIosSafari() {
    const ua = navigator.userAgent || "";
    const isIosDevice =
      /iPhone|iPod|iPad/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isIosDevice) return false;
    if (/CriOS|FxiOS|EdgiOS|OPiOS|mercury|DuckDuckGo|GSA/i.test(ua)) return false;
    if (!/Safari/i.test(ua)) return false;
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
    if (!isIosSafari()) return;
    if (isStandalone()) return;
    if (dismissed()) return;

    const banner = document.getElementById("pwa-hint");
    const sheet = document.getElementById("pwa-hint-sheet");
    if (!banner) return;

    if (sheet) {
      const hostEl = sheet.querySelector("[data-pwa-host]");
      if (hostEl) hostEl.textContent = window.location.hostname;
      // Anchor the sheet to the top of the viewport. The previous
      // attempt at detecting URL-bar edge via env(safe-area-inset-*)
      // proved unreliable: iOS Safari doesn't consistently include
      // the URL bar height in those insets across versions. Since
      // the bottom URL bar is the iOS 15+ default for every iPhone
      // size and the only place this banner ever shows is iOS
      // Safari, always opening from the top keeps the chrome the
      // user is about to tap unobstructed.
      sheet.classList.add("pwa-hint-sheet--from-top");
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
