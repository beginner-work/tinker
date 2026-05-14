/* pwa-install-hint.js — App-Store-style install banner + bottom-sheet
 * instructions for adding tinker to the iOS Home Screen.
 *
 * Banner is shown only on iOS Safari (mobile web, not standalone,
 * not Capacitor). Tapping Install opens the bottom-sheet with the
 * three-step Safari flow. Tapping the banner's X dismisses it and
 * remembers the choice in localStorage. Installing the PWA
 * mid-session flips the display-mode media query and the whole
 * thing is removed silently.
 */

(function () {
  const STORAGE_KEY = "tinker_pwa_hint_dismissed";
  const SHOW_DELAY_MS = 1200;

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

  function alreadyDismissed() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* private mode */ }
  }

  function showBanner(banner) {
    banner.hidden = false;
    document.documentElement.classList.add("pwa-hint-visible");
    requestAnimationFrame(() => { banner.dataset.visible = ""; });
  }

  function hideBanner(banner, sheet, { remember = true } = {}) {
    delete banner.dataset.visible;
    document.documentElement.classList.remove("pwa-hint-visible");
    if (remember) markDismissed();
    setTimeout(() => {
      banner.remove();
      if (sheet) sheet.remove();
    }, 360);
  }

  function openSheet(sheet) {
    sheet.hidden = false;
    // Two rAFs so the initial hidden→visible transform animates.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sheet.dataset.visible = "";
    }));
  }

  function closeSheet(sheet) {
    delete sheet.dataset.visible;
    setTimeout(() => { sheet.hidden = true; }, 320);
  }

  function init() {
    if (isWrappedRuntime()) return;
    if (!isIosSafari()) return;
    if (isStandalone()) return;
    if (alreadyDismissed()) return;

    const banner = document.getElementById("pwa-hint");
    const sheet = document.getElementById("pwa-hint-sheet");
    if (!banner) return;

    // Fill in the live hostname so the sheet matches the deploy.
    if (sheet) {
      const hostEl = sheet.querySelector("[data-pwa-host]");
      if (hostEl) hostEl.textContent = window.location.hostname;
    }

    // Wait for the auth gate before showing — we don't want to fight
    // the sign-in screen for the user's attention.
    const authGate = document.getElementById("auth-gate");
    if (authGate && !authGate.hidden) {
      const obs = new MutationObserver(() => {
        if (authGate.hidden) {
          obs.disconnect();
          setTimeout(() => showBanner(banner), SHOW_DELAY_MS);
        }
      });
      obs.observe(authGate, { attributes: true, attributeFilter: ["hidden"] });
    } else {
      setTimeout(() => showBanner(banner), SHOW_DELAY_MS);
    }

    // Banner buttons — Install opens the sheet, X dismisses everything.
    banner.addEventListener("click", (e) => {
      const action = e.target.closest("[data-pwa-action]");
      if (!action) return;
      const kind = action.dataset.pwaAction;
      if (kind === "install" && sheet) openSheet(sheet);
      else if (kind === "dismiss") hideBanner(banner, sheet);
    });

    // Sheet — backdrop or close button shuts it; the banner stays.
    if (sheet) {
      sheet.addEventListener("click", (e) => {
        const action = e.target.closest("[data-pwa-action]");
        if (action && action.dataset.pwaAction === "close-sheet") closeSheet(sheet);
      });
      // Escape closes the sheet (matters on iPad with hardware keyboards).
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && "visible" in sheet.dataset) closeSheet(sheet);
      });
    }

    // Auto-disappear when the PWA gets installed mid-session.
    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => { if (mq.matches) hideBanner(banner, sheet, { remember: false }); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
