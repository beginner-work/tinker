/* notifications-banner.js — once the PWA is installed (display-mode:
 * standalone), surface the install banner (#pwa-hint) in "notifications"
 * mode so the user can grant OS-level notification permission.
 *
 * Conditions to show: running standalone, Notification API available,
 * current permission state is "default" (unasked — not granted or denied),
 * not in a wrapped runtime (Capacitor / Electron handle notifications via
 * their own native channels), not previously dismissed, and the banner is
 * not already claimed by install or update mode.
 *
 * Reuses #pwa-hint's DOM and CSS by rewriting the subtitle, action label,
 * and data-pwa-action keys — same pattern as update-banner.js. Clicking
 * "Turn on" calls Notification.requestPermission() synchronously from the
 * click handler: iOS Safari silently drops the request when it isn't
 * called directly from a user gesture.
 *
 * Dismiss is persistent. Notification nags are the fastest way to lose
 * trust — one ask per device. A future in-app settings panel can re-offer
 * the prompt for users who change their mind.
 *
 * Granting permission here only unlocks the API surface. Actually
 * delivering pushes requires a service worker + VAPID + a sender, which
 * is a follow-up; this banner is the human-facing first step.
 */

(function () {
  const STORAGE_KEY = "tinker_notifications_hint_dismissed";
  const SHOW_DELAY_MS = 1200;

  function isWrappedRuntime() {
    if (window.Capacitor) return true;
    if (window.tinker && window.tinker.supportsWebview === true) return true;
    return false;
  }

  function isStandalone() {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator && window.navigator.standalone === true) return true;
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
    if (!isStandalone()) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    if (dismissed()) return;

    const banner = document.getElementById("pwa-hint");
    if (!banner) return;
    const subtitle = banner.querySelector(".pwa-hint__subtitle");
    const actionBtn = banner.querySelector(".pwa-hint__action");
    const dismissBtn = banner.querySelector(".pwa-hint__dismiss");
    if (!subtitle || !actionBtn || !dismissBtn) return;

    function enter() {
      // Don't steal the banner from a higher-priority mode. Update mode
      // is the only contender here — install mode is gated on !standalone
      // and so cannot coexist with this one.
      if (banner.dataset.mode === "update") return;
      // Re-check permission at show time — the user may have flipped it
      // in OS settings between init and the delayed reveal.
      if (Notification.permission !== "default") return;
      banner.dataset.mode = "notifications";
      subtitle.textContent = "Turn on notifications";
      actionBtn.textContent = "Turn on";
      actionBtn.dataset.pwaAction = "enable-notifications";
      dismissBtn.dataset.pwaAction = "dismiss-notifications";
      banner.setAttribute("aria-label", "Enable notifications");
      banner.hidden = false;
      document.documentElement.classList.add("pwa-hint-visible");
    }

    function hide({ remember = true } = {}) {
      banner.hidden = true;
      document.documentElement.classList.remove("pwa-hint-visible");
      if (remember) markDismissed();
    }

    banner.addEventListener("click", (e) => {
      const action = e.target.closest("[data-pwa-action]");
      if (!action) return;
      const kind = action.dataset.pwaAction;
      if (kind === "enable-notifications") {
        // Must run synchronously in the click handler — iOS Safari
        // ignores requestPermission() calls that aren't tied to a
        // direct user gesture.
        let result;
        try {
          result = Notification.requestPermission();
        } catch {
          hide();
          return;
        }
        Promise.resolve(result).then((state) => {
          if (state === "granted" || state === "denied") hide();
        }).catch(() => hide());
      } else if (kind === "dismiss-notifications") {
        hide();
      }
    });

    // Wait for the auth gate to drop before announcing ourselves, then
    // pause a beat so we don't appear on top of any first-paint shuffle.
    const gate = document.getElementById("auth-gate");
    if (gate && !gate.hidden) {
      const obs = new MutationObserver(() => {
        if (gate.hidden) {
          obs.disconnect();
          setTimeout(enter, SHOW_DELAY_MS);
        }
      });
      obs.observe(gate, { attributes: true, attributeFilter: ["hidden"] });
    } else {
      setTimeout(enter, SHOW_DELAY_MS);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
