/* mobile-drawer.js — open/close logic for the mobile sidebar drawer.
 *
 * The CSS in mobile-drawer.css handles styling and transitions; this
 * file toggles body[data-drawer-open] in response to the hamburger,
 * the backdrop, Escape, and selecting a session. Inert on ≥541px for
 * the floating toggle; messages threads use an in-header menu button
 * (data-messages-menu) up through 720px so the round control never
 * floats over the title/logo.
 */

(function () {
  const FLOAT_BREAKPOINT = 540;
  const MESSAGES_MOBILE = 720;
  const isFloatMobile = () => window.innerWidth <= FLOAT_BREAKPOINT;
  const isMessagesMobile = () => window.innerWidth <= MESSAGES_MOBILE;

  const toggle = document.getElementById('drawer-toggle');
  const backdrop = document.getElementById('drawer-backdrop');
  const homeListEl = document.getElementById('home-list');
  const treeNav = document.querySelector('.sidebar__tree');
  const navHome = document.getElementById('nav-home');

  function headerMenu() {
    return document.querySelector('#messages-pane [data-messages-menu]');
  }

  function open() {
    document.body.dataset.drawerOpen = '';
    setExpanded(true);
  }
  function close() {
    delete document.body.dataset.drawerOpen;
    setExpanded(false);
  }
  function isOpen() {
    return 'drawerOpen' in document.body.dataset;
  }
  function setExpanded(on) {
    const value = on ? 'true' : 'false';
    if (toggle) toggle.setAttribute('aria-expanded', value);
    const menu = headerMenu();
    if (menu) menu.setAttribute('aria-expanded', value);
  }

  function inMessagesThread() {
    return isMessagesMobile()
      && document.body.classList.contains('messages-mobile-thread')
      && document.body.classList.contains('messages-shell-open');
  }

  function syncHeaderMenu() {
    const menu = headerMenu();
    if (!menu) return;
    // Visibility is CSS-driven (body.messages-mobile-thread). Keep aria in sync.
    menu.setAttribute('aria-hidden', inMessagesThread() ? 'false' : 'true');
  }

  function onMenuClick(e) {
    e.preventDefault();
    if (isOpen()) close(); else open();
  }

  toggle && toggle.addEventListener('click', () => {
    if (isOpen()) close(); else open();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('[data-messages-menu]');
    if (!btn) return;
    onMenuClick(e);
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
    if (!isFloatMobile() && isOpen() && !inMessagesThread()) close();
    syncHeaderMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  const mo = typeof MutationObserver === 'function'
    ? new MutationObserver(syncHeaderMenu)
    : null;
  if (mo) {
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncHeaderMenu);
  } else {
    syncHeaderMenu();
  }
  setTimeout(syncHeaderMenu, 0);
  setTimeout(syncHeaderMenu, 200);

  window.tinkerMobileDrawer = {
    open: open,
    close: close,
    syncHeaderMenu: syncHeaderMenu,
    isOpen: isOpen,
  };
})();
