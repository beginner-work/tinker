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

  function isIosChrome() {
    return /CriOS/i.test(navigator.userAgent || "");
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
      //
      // Chrome iOS is the exception: its three-dot menu lives at the
      // top, the Share entry is one tap away (no URL-bar pre-tap), and
      // "Add to Home Screen" sits under "View more" inside Share. The
      // sheet pulls down from the top, ball rolls across the top, and
      // the now-three steps (Share → View more → Add to Home Screen)
      // sit at the bottom near the user's thumb. We swap which steps
      // list is `hidden` here too — that way visibility is JS-driven
      // and immune to CSS specificity fights from base step rules.
      if (isIosChrome()) {
        sheet.classList.add("pwa-hint-sheet--chrome");
        const defaultList = sheet.querySelector(".pwa-hint-sheet__steps--default");
        const chromeList = sheet.querySelector(".pwa-hint-sheet__steps--chrome");
        if (defaultList) defaultList.hidden = true;
        if (chromeList) chromeList.hidden = false;
      }
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
    function openSheet() {
      if (!sheet) return;
      // Hide the banner while the sheet is open. The full-viewport sheet
      // (z-index 100) sits above the banner (z-index 75) with only a 45%
      // translucent backdrop, so the purple Install button stays dimly
      // visible at the top — but every tap there lands on the backdrop,
      // whose handler is closeSheet. A user tapping "Install" again to
      // proceed would instead dismiss the very instructions they just
      // opened. Taking the banner out of the layout removes that trap;
      // closeSheet restores it so they can re-open the instructions.
      banner.hidden = true;
      sheet.hidden = false;
    }
    function closeSheet() {
      if (!sheet) return;
      sheet.hidden = true;
      banner.hidden = false;
      // Wipe any inline styles the drag-to-close handler may have
      // applied so the next openSheet re-triggers the CSS pull-down
      // keyframe (animations restart on the display: none → flex flip
      // only when no inline `animation: none` is overriding the rule).
      const panel = sheet.querySelector(".pwa-hint-sheet__panel");
      if (panel) {
        panel.style.animation = "";
        panel.style.transition = "";
        panel.style.transform = "";
      }
    }

    // Drag-to-close for both sheet variants. The close gesture mirrors
    // the metaphor of how the sheet entered: Chrome's pull-down sheet
    // closes by dragging up (sign = -1); Safari's rise-from-bottom
    // sheet closes by dragging down (sign = +1). Pass-through threshold
    // is either distance (80px in the close direction) or a quick flick
    // (velocity above 0.5 px/ms). Tapping a button inside the panel is
    // excluded so a close-button tap can't accidentally trigger a drag.
    function attachDragToClose(sheetEl, onClose, sign) {
      const panel = sheetEl.querySelector(".pwa-hint-sheet__panel");
      if (!panel) return;
      const DISMISS_DISTANCE = 80;
      const DISMISS_VELOCITY = 0.5;
      const SNAP_MS = 220;
      const EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";
      let startY = 0;
      let startTime = 0;
      let currentY = 0;
      let dragging = false;

      panel.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) return;
        if (e.target.closest("button, a")) return;
        // Cancel any in-flight entrance keyframe so the inline
        // transform isn't overridden while the finger is down.
        panel.style.animation = "none";
        panel.style.transition = "none";
        startY = e.touches[0].clientY;
        startTime = Date.now();
        currentY = 0;
        dragging = true;
      }, { passive: true });

      panel.addEventListener("touchmove", (e) => {
        if (!dragging) return;
        const dy = e.touches[0].clientY - startY;
        // Clamp to the close direction; drags the other way snap at
        // rest rather than pulling the panel further out of place.
        currentY = sign < 0 ? Math.min(dy, 0) : Math.max(dy, 0);
        panel.style.transform = "translateY(" + currentY + "px)";
      }, { passive: true });

      function settle() {
        if (!dragging) return;
        dragging = false;
        const elapsed = Math.max(Date.now() - startTime, 1);
        const travelled = sign * currentY; // px travelled toward close
        const velocity = travelled / elapsed;
        const shouldClose =
          travelled >= DISMISS_DISTANCE || velocity >= DISMISS_VELOCITY;
        panel.style.transition = "transform " + SNAP_MS + "ms " + EASING;
        if (shouldClose) {
          // Slide the rest of the way off-screen in the close direction.
          panel.style.transform = "translateY(" + (sign < 0 ? "-100%" : "100%") + ")";
          setTimeout(onClose, SNAP_MS);
        } else {
          panel.style.transform = "translateY(0)";
          setTimeout(() => {
            panel.style.animation = "";
            panel.style.transition = "";
            panel.style.transform = "";
          }, SNAP_MS);
        }
      }

      panel.addEventListener("touchend", settle);
      panel.addEventListener("touchcancel", settle);
    }

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
      // The X close button is gone — dismissal happens via the
      // drag-to-close gesture, a backdrop tap, or Escape. Direct
      // listener on the backdrop (delegating via closest() was
      // unreliable on iOS Safari taps where the SVG path inside
      // the old X icon was the event target).
      const backdrop = sheet.querySelector(".pwa-hint-sheet__backdrop");
      if (backdrop) backdrop.addEventListener("click", closeSheet);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !sheet.hidden) closeSheet();
      });
      // Chrome's pull-down sheet closes by dragging UP (sign -1);
      // Safari's rise-from-bottom sheet closes by dragging DOWN (+1).
      const dragSign = sheet.classList.contains("pwa-hint-sheet--chrome") ? -1 : 1;
      attachDragToClose(sheet, closeSheet, dragSign);
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
