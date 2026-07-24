/* mobile-drawer.js — open/close logic for the mobile sidebar drawer.
 *
 * The CSS in mobile-drawer.css / native-mobile.css handles styling;
 * this file toggles body[data-drawer-open] in response to the
 * hamburger, the backdrop, Escape, and selecting a pitch.
 *
 * Active on:
 *   - viewports ≤540px
 *   - Capacitor (html.on-capacitor) at any width — native shell always
 *     uses the drawer, matching a phone app.
 */

(function () {
  const MOBILE_BREAKPOINT = 540;

  function isNativeShell() {
    return window.innerWidth <= MOBILE_BREAKPOINT
      || document.documentElement.classList.contains("on-capacitor");
  }

  const toggle = document.getElementById("drawer-toggle");
  const backdrop = document.getElementById("drawer-backdrop");
  const homeListEl = document.getElementById("home-list");
  const agentsNav = document.querySelector(".sidebar__agents");
  const navHome = document.getElementById("nav-home");
  const topbar = document.getElementById("native-topbar");

  function open() {
    document.body.dataset.drawerOpen = "";
    toggle && toggle.setAttribute("aria-expanded", "true");
    if (topbar) topbar.setAttribute("aria-hidden", "true");
  }
  function close() {
    delete document.body.dataset.drawerOpen;
    toggle && toggle.setAttribute("aria-expanded", "false");
    if (topbar) topbar.setAttribute("aria-hidden", "false");
  }
  function isOpen() {
    return "drawerOpen" in document.body.dataset;
  }

  toggle && toggle.addEventListener("click", () => {
    if (!isNativeShell()) return;
    if (isOpen()) close(); else open();
  });

  backdrop && backdrop.addEventListener("click", close);

  homeListEl && homeListEl.addEventListener("click", (e) => {
    if (isNativeShell() && e.target.closest(".home-card")) close();
  });
  agentsNav && agentsNav.addEventListener("click", (e) => {
    if (isNativeShell() && e.target.closest(".sidebar__pitch-menu-item")) close();
  });
  navHome && navHome.addEventListener("click", () => {
    if (isNativeShell()) close();
  });

  window.addEventListener("resize", () => {
    if (!isNativeShell() && isOpen()) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });
})();
