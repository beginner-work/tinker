/* notifications.js — native-style toast notifications.
 *
 * A small, generic notice surface: the renderer calls
 * window.tinkerNotify(...) (today: the back-online notice for essays
 * written offline) and this module turns it into a toast that behaves
 * like an OS notification: it slides in, stacks, auto-dismisses,
 * pauses on hover, and can be clicked to open the essay it's about.
 *
 * Persistence: every notification is stored (capped) in localStorage.
 * One emitted while the tab is hidden or closed is held "unseen" and
 * surfaced the next time the founder actually has the site in front of
 * them — so "you'll know where it landed" holds whether they stayed in
 * the session or came back later.
 *
 * Cross-device: the store round-trips through sync.js
 * (/api/user-data/notifications), so a notice raised on one device
 * shows up on the others. Notices flagged `sticky` (e.g. "you wrote
 * this offline and it's on its way out now you're back online") never
 * auto-dismiss and keep re-surfacing on every device until the founder
 * acknowledges one — dismissing or opening it — which propagates the
 * acknowledgement everywhere so it clears for good.
 */

(function () {
  const STORE_KEY = "tinker.notifications";
  const MAX_STORED = 30;
  const AUTO_DISMISS_MS = 9000;

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function saveAll(list) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-MAX_STORED)));
    } catch { /* ignore */ }
    // Mirror the change to the server so other devices pick it up. Best
    // effort — sync.js debounces and no-ops when there's no auth token.
    try {
      if (window.tinkerSync && typeof window.tinkerSync.pushNotifications === "function") {
        window.tinkerSync.pushNotifications();
      }
    } catch { /* ignore */ }
  }
  function markSeen(id) {
    const list = loadAll();
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) return;
    list[i] = Object.assign({}, list[i], { seen: true });
    saveAll(list);
  }
  // Acknowledging is the terminal state for a sticky notice: it stops
  // re-surfacing here and, once synced, on every other device too.
  function acknowledge(id) {
    const list = loadAll();
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) return;
    if (list[i].acknowledged) return;
    list[i] = Object.assign({}, list[i], { acknowledged: true, seen: true });
    saveAll(list);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Ids with a toast currently on screen this session — guards against
  // flushUnseen() (which can run on hydrate, focus, and boot) stacking a
  // second copy of a sticky notice that's already showing.
  const shown = new Set();

  let container = null;
  function ensureContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.getElementById("tinker-toasts");
    if (!container) {
      container = document.createElement("div");
      container.id = "tinker-toasts";
      container.className = "tinker-toasts";
      container.setAttribute("role", "region");
      container.setAttribute("aria-label", "Notifications");
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }
    return container;
  }

  function dismiss(el) {
    if (!el || el.dataset.leaving) return;
    el.dataset.leaving = "1";
    el.classList.add("tinker-toast--leaving");
    if (el.dataset.notifId) shown.delete(el.dataset.notifId);
    const done = () => { if (el.parentNode) el.parentNode.removeChild(el); };
    el.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 400);
  }

  function showToast(n) {
    const root = ensureContainer();
    const el = document.createElement("div");
    el.className = "tinker-toast";
    el.setAttribute("role", "alert");
    el.dataset.notifId = n.id;
    shown.add(n.id);

    const clickable = !!n.essayId;
    if (clickable) el.classList.add("tinker-toast--clickable");
    // Sticky notices stay put until acknowledged — no auto-dismiss
    // timer, and dismissing one records the acknowledgement so it won't
    // come back here or on another device.
    const sticky = !!n.sticky;
    if (sticky) el.classList.add("tinker-toast--sticky");

    el.innerHTML =
      `<img class="tinker-toast__icon" src="./icons/tinker-mark.svg" alt="" aria-hidden="true">` +
      `<div class="tinker-toast__body">` +
        `<div class="tinker-toast__head">` +
          `<span class="tinker-toast__app">tinker</span>` +
          `<span class="tinker-toast__time">now</span>` +
        `</div>` +
        `<p class="tinker-toast__title">${escapeHtml(n.title)}</p>` +
        `<p class="tinker-toast__text">${escapeHtml(n.body)}</p>` +
      `</div>` +
      `<button type="button" class="tinker-toast__close" aria-label="Dismiss">&times;</button>`;

    const closeBtn = el.querySelector(".tinker-toast__close");
    let dismissTimer = null;
    const arm = () => {
      if (sticky) return;
      dismissTimer = setTimeout(() => dismiss(el), AUTO_DISMISS_MS);
    };
    const disarm = () => { if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; } };

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      disarm();
      if (sticky) acknowledge(n.id);
      dismiss(el);
    });

    if (clickable) {
      el.addEventListener("click", () => {
        disarm();
        if (sticky) acknowledge(n.id);
        try {
          // Clicking a toast opens the essay it's about.
          window.dispatchEvent(new CustomEvent("tinker:open-essay", {
            detail: { essayId: n.essayId || null },
          }));
        } catch { /* ignore */ }
        dismiss(el);
      });
    }

    // Pause auto-dismiss while hovered, like a native notification.
    el.addEventListener("mouseenter", disarm);
    el.addEventListener("mouseleave", arm);

    root.prepend(el);
    requestAnimationFrame(() => { el.classList.add("tinker-toast--in"); });
    arm();
  }

  // A notice still wants showing when it's never been seen, or — for a
  // sticky one — until it's actually acknowledged, however many times
  // and devices it's surfaced on in between.
  function wantsSurface(n) {
    return n.sticky ? !n.acknowledged : !n.seen;
  }

  // Surface every stored notification that still wants showing — but
  // only when the page is in front of the founder, and never a second
  // copy of one already on screen. Non-sticky notices are marked seen as
  // they appear so they don't re-pop; sticky ones wait for acknowledge().
  function flushUnseen() {
    if (document.hidden) return;
    const list = loadAll();
    let changed = false;
    for (const n of list) {
      if (!wantsSurface(n)) continue;
      if (shown.has(n.id)) continue;
      showToast(n);
      if (!n.sticky) { n.seen = true; changed = true; }
    }
    if (changed) saveAll(list);
  }

  function notify(payload) {
    if (!payload || typeof payload !== "object") return null;
    const id = payload.id || ("n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const list = loadAll();
    // Stable-id notices (e.g. one per offline essay) can be re-fired by a
    // later flush or arrive from another device — dedupe so the founder
    // never gets two of the same, and never one they've already cleared.
    const existing = list.find((x) => x && x.id === id);
    if (existing) {
      if (wantsSurface(existing) && !shown.has(id) && !document.hidden) {
        showToast(existing);
        if (!existing.sticky) markSeen(id);
      }
      return id;
    }
    const n = {
      id,
      kind: payload.kind || "info",
      title: String(payload.title || "tinker"),
      body: String(payload.body || ""),
      essayId: payload.essayId || null,
      sticky: !!payload.sticky,
      createdAt: Date.now(),
      seen: false,
      acknowledged: false,
    };
    list.push(n);
    saveAll(list);

    // Show immediately if the founder is here; otherwise it waits unseen
    // for flushUnseen() to pick it up on the next visit / tab focus.
    if (!document.hidden) {
      showToast(n);
      if (!n.sticky) markSeen(n.id);
    }
    return n.id;
  }

  window.tinkerNotify = notify;
  window.addEventListener("tinker:notify", (e) => {
    if (e && e.detail) notify(e.detail);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) flushUnseen();
  });

  // Clear any on-screen toast whose stored copy is now acknowledged —
  // catches the case where the founder dismissed it on another device,
  // so the acknowledgement that arrived over sync takes it down here too.
  function reconcileAcknowledged() {
    if (!container) return;
    const acked = new Set(
      loadAll().filter((n) => n && n.acknowledged).map((n) => n.id),
    );
    container.querySelectorAll(".tinker-toast").forEach((el) => {
      if (acked.has(el.dataset.notifId)) dismiss(el);
    });
  }

  // A hydrate (boot or sign-in) may have merged in notices raised on
  // another device — take down any just-acknowledged elsewhere, then
  // surface any that still want showing.
  window.addEventListener("tinker:hydrated", () => {
    reconcileAcknowledged();
    flushUnseen();
  });

  function boot() { flushUnseen(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
