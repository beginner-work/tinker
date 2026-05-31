/* notifications.js — native-style toast notifications.
 *
 * Replaces the old post-publish "arrangement" review screen, which
 * narrated the organize job live and locked in a placement after a
 * single round — a placement the backend often moved seconds (or a
 * session) later, so "you found a new direction" routinely turned out
 * to be a lie once the essay got folded into another pitch.
 *
 * The renderer now waits for the organize job to actually SETTLE and
 * then calls window.tinkerNotify(...) with where the essay truly
 * landed. This module turns that into a toast that behaves like an OS
 * notification: it slides in, stacks, auto-dismisses, pauses on hover,
 * and can be clicked to open the pitch the essay joined.
 *
 * Persistence: every notification is stored (capped) in localStorage.
 * One emitted while the tab is hidden or closed is held "unseen" and
 * surfaced the next time the founder actually has the site in front of
 * them — so "you'll know where it landed" holds whether they stayed in
 * the session or came back later.
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
  }
  function markSeen(id) {
    const list = loadAll();
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) return;
    list[i] = Object.assign({}, list[i], { seen: true });
    saveAll(list);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

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

    const clickable = !!(n.pitchId || n.essayId);
    if (clickable) el.classList.add("tinker-toast--clickable");

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
    const arm = () => { dismissTimer = setTimeout(() => dismiss(el), AUTO_DISMISS_MS); };
    const disarm = () => { if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; } };

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      disarm();
      dismiss(el);
    });

    if (clickable) {
      el.addEventListener("click", () => {
        disarm();
        try {
          window.dispatchEvent(new CustomEvent("tinker:open-pitch", {
            detail: { pitchId: n.pitchId || null, essayId: n.essayId || null },
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

  // Surface every stored notification the founder hasn't seen yet — but
  // only when the page is actually in front of them. Marks them seen as
  // they appear so they don't re-pop on every reload.
  function flushUnseen() {
    if (document.hidden) return;
    const list = loadAll();
    let changed = false;
    for (const n of list) {
      if (n.seen) continue;
      showToast(n);
      n.seen = true;
      changed = true;
    }
    if (changed) saveAll(list);
  }

  function notify(payload) {
    if (!payload || typeof payload !== "object") return null;
    const n = {
      id: payload.id || ("n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      kind: payload.kind || "info",
      title: String(payload.title || "tinker"),
      body: String(payload.body || ""),
      essayId: payload.essayId || null,
      pitchId: payload.pitchId || null,
      createdAt: Date.now(),
      seen: false,
    };
    const list = loadAll();
    list.push(n);
    saveAll(list);

    // Show immediately if the founder is here; otherwise it waits unseen
    // for flushUnseen() to pick it up on the next visit / tab focus.
    if (!document.hidden) {
      showToast(n);
      markSeen(n.id);
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

  function boot() { flushUnseen(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
