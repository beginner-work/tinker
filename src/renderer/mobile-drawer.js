/* mobile-drawer.js — open/close logic for the mobile sidebar drawer.
 *
 * The CSS in mobile-drawer.css handles styling and transitions; this
 * file toggles body[data-drawer-open] in response to the hamburger,
 * the backdrop, Escape, and selecting a session. Inert on ≥541px.
 */

(function () {
  const MOBILE_BREAKPOINT = 540;
  const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

  const toggle = document.getElementById('drawer-toggle');
  const backdrop = document.getElementById('drawer-backdrop');
  const homeListEl = document.getElementById('home-list');
  const storyNav = document.querySelector('.sidebar__story');
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
  // Same gesture on a story row — tapping a piece (or a draft, or the
  // pocket) opens the underlying surface, so on mobile we want the
  // drawer to step out of the way.
  storyNav && storyNav.addEventListener('click', (e) => {
    if (isMobile() && e.target.closest('.sidebar__account-item, .sidebar__pocket-card, .sidebar__pitch-action')) close();
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
