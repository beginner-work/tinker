/* mobile-drawer.js — open/close logic for the mobile sidebar drawer.
 *
 * The inbox (messages-shell-open) never uses a pull-out drawer: mobile is
 * plain push navigation (list → full-screen thread → back). This file stays
 * for non-inbox surfaces that still use the floating hamburger ≤540px.
 * It is inert while the messages shell owns the screen.
 */

(function () {
  const FLOAT_BREAKPOINT = 540;
  const isFloatMobile = () => window.innerWidth <= FLOAT_BREAKPOINT;

  const toggle = document.getElementById('drawer-toggle');
  const backdrop = document.getElementById('drawer-backdrop');
  const homeListEl = document.getElementById('home-list');
  const treeNav = document.querySelector('.sidebar__tree');
  const navHome = document.getElementById('nav-home');

  function inboxOwnsScreen() {
    return document.body.classList.contains('messages-shell-open')
      || document.body.classList.contains('messages-inbox-primary');
  }

  function open() {
    // Inbox is push-nav only — never slide a drawer over a thread or list.
    if (inboxOwnsScreen()) return;
    document.body.dataset.drawerOpen = '';
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }
  function close() {
    delete document.body.dataset.drawerOpen;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  function isOpen() {
    return 'drawerOpen' in document.body.dataset;
  }

  toggle && toggle.addEventListener('click', () => {
    if (inboxOwnsScreen()) return;
    if (isOpen()) close(); else open();
  });

  backdrop && backdrop.addEventListener('click', close);

  homeListEl && homeListEl.addEventListener('click', (e) => {
    if (isFloatMobile() && e.target.closest('.home-card')) close();
  });
  treeNav && treeNav.addEventListener('click', (e) => {
    if (isFloatMobile() && e.target.closest('.sidebar__phrase')) close();
  });
  navHome && navHome.addEventListener('click', () => {
    if (isFloatMobile()) close();
  });

  window.addEventListener('resize', () => {
    if (!isFloatMobile() && isOpen()) close();
    if (inboxOwnsScreen() && isOpen()) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  // If the inbox boots or class flips on, drop any leftover drawer state.
  const mo = typeof MutationObserver === 'function'
    ? new MutationObserver(function () {
      if (inboxOwnsScreen() && isOpen()) close();
    })
    : null;
  if (mo) {
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (inboxOwnsScreen()) close();

  window.tinkerMobileDrawer = {
    open: open,
    close: close,
    isOpen: isOpen,
  };
})();
