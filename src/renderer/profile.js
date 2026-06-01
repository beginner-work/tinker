/* profile.js — the top-right profile section and the share-pitch QR.
 *
 * The profile icon (#profile-avatar, fixed in the top-right corner) IS
 * the share button: tapping it raises #qr-modal — a small sheet that
 * shows a QR encoding the founder's published-pitch reader link, who's
 * signed in, and (web build, with a session token) a sign-out action.
 * Anyone can scan the QR to read the pitch and connect.
 *
 * The QR itself is drawn with the vendored global `qrcode` (lib/qr.js).
 * The share link comes from /api/feed/published-pitches (most-recently
 * published first); with nothing published yet we fall back to the app's
 * own URL as a plain invite link and nudge the founder to publish.
 */

(function () {
  "use strict";

  const TOKEN_KEY = "tinker_jwt";
  const PHONE_KEY = "tinker_phone";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  function storedPhone() {
    try { return localStorage.getItem(PHONE_KEY) || ""; }
    catch { return ""; }
  }

  function isWebPlatform() {
    return document.documentElement.classList.contains("on-web");
  }

  function formatPhone(raw) {
    const d = String(raw || "").replace(/\D/g, "").slice(0, 10);
    if (d.length !== 10) return "";
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }

  function appUrl() {
    const origin = window.location.origin;
    if (origin && /^https?:/.test(origin)) return origin + "/";
    return window.location.href;
  }

  // ── Identity / avatar monogram ─────────────────────────────────────

  function paintIdentity() {
    const phone = storedPhone();
    const pretty = formatPhone(phone);
    const phoneEl = document.querySelector("[data-profile-phone]");
    if (phoneEl) phoneEl.textContent = pretty || "Founder";

    // Last two digits make a quiet monogram when we know the number.
    const mono = document.querySelector("[data-profile-monogram]");
    if (mono && phone.replace(/\D/g, "").length >= 2) {
      const digits = phone.replace(/\D/g, "");
      mono.textContent = digits.slice(-2);
      mono.classList.add("profile-avatar__glyph--text");
    }

    // Sign out only makes sense on the web build with a live session.
    const signout = document.querySelector('[data-profile-action="signout"]');
    if (signout) signout.hidden = !(isWebPlatform() && token());
  }

  // ── Profile icon ───────────────────────────────────────────────────

  // The profile icon is the share button — tapping it opens the QR sheet.
  function wireAvatar() {
    const avatar = document.getElementById("profile-avatar");
    if (avatar) avatar.addEventListener("click", openQrModal);
  }

  // ── QR rendering ───────────────────────────────────────────────────

  // Build a crisp SVG for `text` into `mount`. Dark modules on a white
  // field with a 4-module quiet zone — the standard margin readers
  // expect. Returns true on success.
  function renderQr(mount, text) {
    if (!mount) return false;
    if (typeof window.qrcode !== "function") return false;
    let qr;
    try {
      qr = window.qrcode(0, "M"); // type 0 = auto-pick the smallest version
      qr.addData(text);
      qr.make();
    } catch {
      return false;
    }
    const count = qr.getModuleCount();
    const margin = 4;
    const dim = count + margin * 2;
    let path = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          path += `M${c + margin} ${r + margin}h1v1h-1z`;
        }
      }
    }
    mount.innerHTML =
      `<svg viewBox="0 0 ${dim} ${dim}" width="100%" height="100%" ` +
      `shape-rendering="crispEdges" role="img" aria-label="QR code linking to your pitch">` +
      `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
      `<path d="${path}" fill="#1a1a1a"/>` +
      `</svg>`;
    return true;
  }

  // ── Share link resolution ──────────────────────────────────────────

  // Resolve the link the QR should carry. Prefers the founder's most
  // recently published pitch; otherwise falls back to the app URL as a
  // plain invite. Returns { url, title, published }.
  async function resolveShareTarget() {
    const t = token();
    if (t && isWebPlatform()) {
      try {
        const res = await fetch("/api/feed/published-pitches", {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (res.ok) {
          const json = await res.json();
          const pitches = Array.isArray(json && json.pitches) ? json.pitches : [];
          const first = pitches.find((p) => p && p.readerUrl);
          if (first) {
            return { url: first.readerUrl, title: first.title || "", published: true };
          }
        }
      } catch {
        /* fall through to the invite link */
      }
    }
    return { url: appUrl(), title: "", published: false };
  }

  // ── QR modal ───────────────────────────────────────────────────────

  let lastUrl = "";

  function flashCopy(btn, text) {
    if (!btn) return;
    const prev = btn.dataset.label || btn.textContent;
    btn.dataset.label = prev;
    btn.textContent = text;
    clearTimeout(flashCopy._t);
    flashCopy._t = setTimeout(() => { btn.textContent = btn.dataset.label; }, 1600);
  }

  function wireModal() {
    const modal = document.getElementById("qr-modal");
    if (!modal) return;
    modal.addEventListener("click", (e) => {
      if (e.target.closest("[data-qr-close]")) closeQrModal();
    });
    const copyBtn = modal.querySelector("[data-qr-copy]");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        if (!lastUrl) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(lastUrl);
            flashCopy(copyBtn, "Copied");
            return;
          }
        } catch { /* ignore */ }
        flashCopy(copyBtn, "Couldn't copy");
      });
    }
    const signout = modal.querySelector('[data-profile-action="signout"]');
    if (signout) {
      signout.addEventListener("click", () => {
        if (window.tinkerAuth && typeof window.tinkerAuth.signOut === "function") {
          window.tinkerAuth.signOut();
        }
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeQrModal();
    });
  }

  function closeQrModal() {
    const modal = document.getElementById("qr-modal");
    if (modal) modal.hidden = true;
  }

  async function openQrModal() {
    const modal = document.getElementById("qr-modal");
    if (!modal) return;
    const canvas = modal.querySelector("[data-qr-canvas]");
    const linkEl = modal.querySelector("[data-qr-link]");
    const noteEl = modal.querySelector("[data-qr-note]");
    const copyBtn = modal.querySelector("[data-qr-copy]");

    modal.hidden = false;
    if (canvas) canvas.innerHTML = "";
    if (linkEl) linkEl.textContent = "Building your link…";
    if (copyBtn) copyBtn.disabled = true;

    const target = await resolveShareTarget();
    // The modal may have been closed again while we were fetching.
    if (modal.hidden) return;

    lastUrl = target.url;
    renderQr(canvas, target.url);
    if (linkEl) linkEl.textContent = target.url;
    if (copyBtn) copyBtn.disabled = false;

    if (noteEl) {
      if (target.published) {
        noteEl.textContent = target.title
          ? `Scan to read “${target.title}” — and invite them to connect.`
          : "Scan to read your pitch — and invite them to connect.";
      } else {
        noteEl.textContent =
          "Publish a pitch to share it directly. For now this links to tinker — invite someone to start.";
      }
    }
  }

  ready(() => {
    if (!document.getElementById("profile-corner")) return;
    paintIdentity();
    wireAvatar();
    wireModal();
  });

  // Re-paint identity once auth completes (web sign-in dispatches this).
  window.addEventListener("tinker:auth-changed", paintIdentity);
})();
