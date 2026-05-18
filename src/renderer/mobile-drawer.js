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
  const treeNav = document.querySelector('.sidebar__tree');
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
  });

  // Escape closes the drawer.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  // ── Scroll-with-page ──────────────────────────────────────────────
  // The hamburger is position:fixed so it stays in front of the section
  // content, but the user expects it to drift up with the page when the
  // section is scrolled (and to bounce along with iOS overscroll).
  // Mirror the active section's scrollTop into a CSS custom property
  // that the CSS uses to translateY the toggle.
  const stage = document.querySelector('main.stage');
  if (toggle && stage) {
    const sections = Array.from(stage.querySelectorAll(':scope > section'));

    function activeScroller() {
      for (const s of sections) {
        if (s.hidden) continue;
        if (s.classList.contains('feed') && !s.hasAttribute('data-active')) continue;
        // The writing view delegates its scroll to .writing__body; every
        // other section is itself the scroll container.
        if (s.id === 'writing') return s.querySelector('.writing__body') || s;
        return s;
      }
      return null;
    }

    function syncToggle() {
      const scroller = activeScroller();
      const y = scroller ? scroller.scrollTop : 0;
      toggle.style.setProperty('--toggle-y', `${-y}px`);
    }

    const scrollers = [...sections, stage.querySelector('.writing__body')].filter(Boolean);
    scrollers.forEach((el) => el.addEventListener('scroll', syncToggle, { passive: true }));

    const obs = new MutationObserver(syncToggle);
    sections.forEach((s) => {
      obs.observe(s, { attributes: true, attributeFilter: ['hidden', 'data-active'] });
    });
  }
})();
