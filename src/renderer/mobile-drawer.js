/* mobile-drawer.js — open/close logic for the mobile sidebar drawer.
 *
 * The CSS in mobile-drawer.css handles styling and transitions; this
 * file toggles body[data-drawer-open] in response to the hamburger,
 * the backdrop, Escape, and selecting a session. Inert on ≥541px.
 *
 * On a messages mobile thread, the hamburger parks inside the pane
 * lead row (with back / logo / name) instead of floating fixed.
 */

(function () {
  const MOBILE_BREAKPOINT = 540;
  const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

  const toggle = document.getElementById('drawer-toggle');
  const backdrop = document.getElementById('drawer-backdrop');
  const homeListEl = document.getElementById('home-list');
  const treeNav = document.querySelector('.sidebar__tree');
  const navHome = document.getElementById('nav-home');
  const toggleHome = toggle ? toggle.parentNode : null;

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

  function leadSlot() {
    return document.querySelector('#messages-pane [data-messages-lead]');
  }

  function syncToggleHome() {
    if (!toggle || !toggleHome) return;
    const lead = leadSlot();
    const inThread = isMobile()
      && document.body.classList.contains('messages-mobile-thread')
      && document.body.classList.contains('messages-shell-open')
      && lead;
    if (inThread) {
      if (toggle.parentNode !== lead) {
        lead.insertBefore(toggle, lead.firstChild);
      }
      toggle.classList.add('drawer-toggle--in-header');
      toggle.setAttribute('aria-label', 'Open conversations');
    } else {
      if (toggle.parentNode !== toggleHome) {
        // Keep toggle before the backdrop when restoring.
        if (backdrop && backdrop.parentNode === toggleHome) {
          toggleHome.insertBefore(toggle, backdrop);
        } else {
          toggleHome.appendChild(toggle);
        }
      }
      toggle.classList.remove('drawer-toggle--in-header');
      toggle.setAttribute('aria-label', 'Open sidebar');
    }
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
  // v0.103: same gesture on a sidebar-tree phrase row — tapping a
  // phrase opens the underlying writing, so on mobile we want the
  // drawer to step out of the way.
  treeNav && treeNav.addEventListener('click', (e) => {
    if (isMobile() && e.target.closest('.sidebar__phrase')) close();
  });
  navHome && navHome.addEventListener('click', () => {
    if (isMobile()) close();
  });

  // Resizing from mobile to desktop drops the open state.
  window.addEventListener('resize', () => {
    if (!isMobile() && isOpen()) close();
    syncToggleHome();
  });

  // Escape closes the drawer.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  const mo = typeof MutationObserver === 'function'
    ? new MutationObserver(syncToggleHome)
    : null;
  if (mo) {
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncToggleHome);
  } else {
    syncToggleHome();
  }
  // Messages shell may mount the lead slot a tick later.
  setTimeout(syncToggleHome, 0);
  setTimeout(syncToggleHome, 200);

})();
