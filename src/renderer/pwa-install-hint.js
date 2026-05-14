/* pwa-install-hint.js — show the "Add to Home Screen" coach mark on
 * iOS Safari. Only fires when:
 *   - the user is on iOS Safari (not Chrome/Firefox/etc. on iOS, not
 *     a non-Apple device, not Capacitor, not Electron),
 *   - the page is NOT already running standalone (i.e. they haven't
 *     installed the PWA yet),
 *   - they haven't dismissed the hint before.
 *
 * The hint is built lazily — when the conditions don't match nothing
 * is added to the DOM. The card itself lives in index.html so the
 * markup is reviewable; this file just wires visibility, dismissal,
 * and persistence.
 */

(function () {
  const STORAGE_KEY = "tinker_pwa_hint_dismissed";
  const SHOW_DELAY_MS = 1400; // let the page settle before sliding in.

  function isIosSafari() {
    const ua = navigator.userAgent || "";
    // iPad on iOS 13+ reports as Mac; cover both shapes.
    const isIosDevice =
      /iPhone|iPod|iPad/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isIosDevice) return false;
    // Filter out Chrome/Firefox/Edge/Opera/Brave/DuckDuckGo on iOS —
    // they all wrap WebKit but don't expose Add-to-Home-Screen the
    // same way through the page menu.
    if (/CriOS|FxiOS|EdgiOS|OPiOS|mercury|DuckDuckGo|GSA/i.test(ua)) return false;
    if (!/Safari/i.test(ua)) return false;
    return true;
  }

  function isStandalone() {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    // iOS Safari sets navigator.standalone when launched from Home Screen.
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  function isWrappedRuntime() {
    if (window.Capacitor) return true;
    if (window.tinker && window.tinker.supportsWebview === true) return true; // Electron preload
    return false;
  }

  function alreadyDismissed() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* private mode — fine, just won't persist */ }
  }

  function show(el) {
    // rAF so the transition has a frame to work with.
    requestAnimationFrame(() => { el.dataset.visible = ""; });
  }

  function hide(el, { remember = true } = {}) {
    delete el.dataset.visible;
    if (remember) markDismissed();
    // Remove from the DOM after the transition so it doesn't trap focus.
    setTimeout(() => { el.remove(); }, 360);
  }

  function init() {
    if (isWrappedRuntime()) return;
    if (!isIosSafari()) return;
    if (isStandalone()) return;
    if (alreadyDismissed()) return;

    const el = document.getElementById("pwa-hint");
    if (!el) return;

    // If the user signs in / out, we don't want to fight the auth gate —
    // wait until it's hidden before announcing ourselves.
    const authGate = document.getElementById("auth-gate");
    if (authGate && !authGate.hidden) {
      const obs = new MutationObserver(() => {
        if (authGate.hidden) {
          obs.disconnect();
          setTimeout(() => show(el), SHOW_DELAY_MS);
        }
      });
      obs.observe(authGate, { attributes: true, attributeFilter: ["hidden"] });
    } else {
      setTimeout(() => show(el), SHOW_DELAY_MS);
    }

    // The whole pill is the dismiss target — there's no close button.
    el.addEventListener("click", () => hide(el));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        hide(el);
      }
    });

    // If the app gets installed mid-session (user follows the steps),
    // the display-mode media query flips. Drop the hint quietly without
    // recording a dismissal — they did the thing.
    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => { if (mq.matches) hide(el, { remember: false }); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
