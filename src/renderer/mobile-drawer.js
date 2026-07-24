/* mobile-drawer.js — open/close logic for the mobile sidebar drawer.
 *
 * The CSS in mobile-drawer.css handles styling and transitions; this
 * file toggles body[data-drawer-open] in response to the hamburger,
 * the backdrop, Escape, and selecting a pitch. Inert on ≥541px.
 *
 * Cursor-mobile shape: the drawer is the pitches (agents) inbox; the
 * workspace (pitch sections) lives in the main column. Picking a
 * pitch closes the drawer so the workspace comes forward.
 */

(function () {
  const MOBILE_BREAKPOINT = 540;
  const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

  const toggle = document.getElementById('drawer-toggle');
  const backdrop = document.getElementById('drawer-backdrop');
  const homeListEl = document.getElementById('home-list');
  const agentsNav = document.querySelector('.sidebar__agents');
  const navHome = document.getElementById('nav-home');

  function open() {
    document.body.dataset.drawerOpen = '';
    toggle && toggle.setAttribute('aria-expanded', 'true');
  }
  function close() {
    delete document.body.dataset.drawerOpen;
    toggle && toggle.setAttribute('aria-expanded', 'false');
  }
  function isOpen() {
    return 'drawerOpen' in document.body.dataset;
  }

  toggle && toggle.addEventListener('click', () => {
    if (isOpen()) close(); else open();
  });

  backdrop && backdrop.addEventListener('click', close);

  // Auto-close after picking a seed or tapping the brand — the
  // user wants the stage back.
  homeListEl && homeListEl.addEventListener('click', (e) => {
    if (isMobile() && e.target.closest('.home-card')) close();
  });
  // Pitch row in the agents inbox — same gesture as Cursor mobile
  // picking an agent from the drawer.
  agentsNav && agentsNav.addEventListener('click', (e) => {
    if (isMobile() && e.target.closest('.sidebar__pitch-menu-item')) close();
  });
  navHome && navHome.addEventListener('click', () => {
    if (isMobile()) close();
  });

  // Resizing from mobile to desktop drops the open state.
  window.addEventListener('resize', () => {
    if (!isMobile() && isOpen()) close();
  });

  // Escape closes the drawer.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

})();
