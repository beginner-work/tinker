/* native-glass-chrome.js — bridge the Capacitor GlassChrome plugin.
 *
 * On iOS Capacitor, mounts Apple Liquid Glass (or material fallback) chrome
 * for the drawer toggle and AI / No AI mode nav, then hides the CSS chips
 * so we don't double-draw. Taps on the native overlay click the existing
 * DOM controls so freewrite.js / mobile-drawer.js keep owning state.
 *
 * No-ops on web, Electron, and Android.
 */

(function () {
  "use strict";

  const MOBILE_BREAKPOINT = 540;

  function getPlugin() {
    const Cap = window.Capacitor;
    if (!Cap || typeof Cap.getPlatform !== "function") return null;
    if (Cap.getPlatform() !== "ios") return null;
    return (Cap.Plugins && Cap.Plugins.GlassChrome) || null;
  }

  function isMobileWidth() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function welcomeActive() {
    const welcome = document.getElementById("welcome");
    return !!(welcome && welcome.hasAttribute("data-active"));
  }

  function modeFromDom() {
    const noai = document.getElementById("mode-noai");
    if (noai && noai.getAttribute("aria-pressed") === "true") return "noai";
    return "ai";
  }

  function offlineFromDom() {
    if (window.tinkerFreewrite && typeof window.tinkerFreewrite.isOffline === "function") {
      return !!window.tinkerFreewrite.isOffline();
    }
    return navigator.onLine === false;
  }

  function drawerExpanded() {
    return "drawerOpen" in document.body.dataset;
  }

  async function sync(Glass) {
    try {
      await Glass.setModeNav({
        mode: modeFromDom(),
        offline: offlineFromDom(),
        visible: welcomeActive(),
      });
      await Glass.setDrawerToggle({
        expanded: drawerExpanded(),
        visible: isMobileWidth(),
      });
    } catch {
      /* native bridge may not be ready yet */
    }
  }

  async function boot() {
    const Glass = getPlugin();
    if (!Glass || typeof Glass.isAvailable !== "function") return;

    let info;
    try {
      info = await Glass.isAvailable();
    } catch {
      return;
    }
    if (!info || !info.available) return;

    try {
      await Glass.present();
    } catch {
      return;
    }

    document.documentElement.classList.add("native-glass-chrome");
    if (info.liquidGlass) {
      document.documentElement.classList.add("native-liquid-glass");
    }

    if (typeof Glass.addListener === "function") {
      Glass.addListener("drawerToggle", () => {
        const btn = document.getElementById("drawer-toggle");
        if (btn) btn.click();
      });
      Glass.addListener("modeSelect", (ev) => {
        const mode = ev && ev.mode;
        const id = mode === "noai" ? "mode-noai" : "mode-ai";
        const btn = document.getElementById(id);
        if (btn && !btn.disabled) btn.click();
      });
    }

    const schedule = () => {
      sync(Glass);
    };

    window.addEventListener("tinker:freewrite-changed", schedule);
    window.addEventListener("online", schedule);
    window.addEventListener("offline", schedule);
    window.addEventListener("resize", schedule);

    // Welcome visibility + drawer open state live on DOM attributes.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-drawer-open"],
    });
    const welcome = document.getElementById("welcome");
    if (welcome) {
      mo.observe(welcome, {
        attributes: true,
        attributeFilter: ["data-active"],
      });
    }
    const modeNav = document.getElementById("mode-nav");
    if (modeNav) {
      mo.observe(modeNav, {
        attributes: true,
        subtree: true,
        attributeFilter: ["aria-pressed", "hidden", "disabled"],
      });
    }

    schedule();
    // freewrite.js may wire after us — resync shortly.
    setTimeout(schedule, 0);
    setTimeout(schedule, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
