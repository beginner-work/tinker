/* profile.js — the founder's profile photo, the profile page, and the
 * share-pitch QR.
 *
 * The welcome screen's centre avatar (#welcome-avatar) shows the
 * founder's profile photo — or a placeholder prompting them to add one.
 * Tapping it opens #profile-page, a full-screen page where they can:
 *
 *   • upload / change / remove their photo (stored on the device as a
 *     downscaled data URL under `tinker_avatar`; broadcast via the
 *     `tinker:avatar-changed` event so every avatar repaints live), and
 *   • share their pitch via a QR encoding their published-pitch reader
 *     link — anyone can scan it to read the pitch and connect.
 *
 * The page also shows who's signed in and, on the web build with a live
 * session token, a sign-out action.
 *
 * The QR is drawn with the vendored global `qrcode` (lib/qr.js). The
 * share link comes from /api/feed/published-pitches (most-recently
 * published first); with nothing published yet we fall back to the app's
 * own URL as a plain invite link and nudge the founder to publish.
 */

(function () {
  "use strict";

  const TOKEN_KEY = "tinker_jwt";
  const PHONE_KEY = "tinker_phone";
  const AVATAR_KEY = "tinker_avatar";
  const MAX_DIM = 512; // longest edge after downscale, keeps storage small

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

  // ── Profile photo store ────────────────────────────────────────────

  function getAvatar() {
    try { return localStorage.getItem(AVATAR_KEY) || ""; }
    catch { return ""; }
  }

  function setAvatar(dataUrl) {
    try {
      if (dataUrl) localStorage.setItem(AVATAR_KEY, dataUrl);
      else localStorage.removeItem(AVATAR_KEY);
    } catch {
      return false;
    }
    try { window.dispatchEvent(new CustomEvent("tinker:avatar-changed")); }
    catch { /* ignore */ }
    return true;
  }

  // Paint every avatar surface (welcome centre + profile page preview).
  function paintAvatar() {
    const url = getAvatar();
    document.querySelectorAll("[data-avatar-img]").forEach((img) => {
      if (url) { img.src = url; img.hidden = false; }
      else { img.removeAttribute("src"); img.hidden = true; }
    });
    document.querySelectorAll("[data-avatar-empty]").forEach((el) => {
      el.hidden = !!url;
    });
    const removeBtn = document.querySelector("[data-avatar-remove]");
    if (removeBtn) removeBtn.hidden = !url;
    const uploadLabel = document.querySelector("[data-avatar-upload-label]");
    if (uploadLabel) uploadLabel.textContent = url ? "Change photo" : "Upload a photo";
    const welcome = document.getElementById("welcome-avatar");
    if (welcome) welcome.classList.toggle("welcome__avatar--set", !!url);
  }

  // Downscale a picked file to a square-ish data URL no bigger than
  // MAX_DIM on its longest edge. Resolves with the data URL, or rejects.
  function fileToScaledDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error("Please choose an image file."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("That image couldn't be loaded."));
        img.onload = () => {
          const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("Couldn't process that image.")); return; }
          ctx.drawImage(img, 0, 0, w, h);
          try {
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          } catch {
            reject(new Error("Couldn't process that image."));
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function wirePhotoControls() {
    const input = document.querySelector("[data-avatar-input]");
    const removeBtn = document.querySelector("[data-avatar-remove]");
    const errEl = document.querySelector("[data-avatar-error]");

    function setError(msg) { if (errEl) errEl.textContent = msg || ""; }

    if (input) {
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        input.value = ""; // allow re-picking the same file later
        if (!file) return;
        setError("");
        try {
          const dataUrl = await fileToScaledDataUrl(file);
          if (!setAvatar(dataUrl)) {
            setError("That photo is too large to save on this device.");
            return;
          }
          paintAvatar();
        } catch (err) {
          setError((err && err.message) || "Couldn't use that photo.");
        }
      });
    }
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        setError("");
        setAvatar("");
        paintAvatar();
      });
    }
  }

  // ── Identity ───────────────────────────────────────────────────────

  function paintIdentity() {
    const pretty = formatPhone(storedPhone());
    document.querySelectorAll("[data-profile-phone]").forEach((el) => {
      el.textContent = pretty || "Founder";
    });
    const signout = document.querySelector('[data-profile-action="signout"]');
    if (signout) signout.hidden = !(isWebPlatform() && token());
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

  let lastUrl = "";

  function flashCopy(btn, text) {
    if (!btn) return;
    const prev = btn.dataset.label || btn.textContent;
    btn.dataset.label = prev;
    btn.textContent = text;
    clearTimeout(flashCopy._t);
    flashCopy._t = setTimeout(() => { btn.textContent = btn.dataset.label; }, 1600);
  }

  async function paintShare() {
    const page = document.getElementById("profile-page");
    if (!page) return;
    const canvas = page.querySelector("[data-qr-canvas]");
    const linkEl = page.querySelector("[data-qr-link]");
    const noteEl = page.querySelector("[data-qr-note]");
    const copyBtn = page.querySelector("[data-qr-copy]");

    if (canvas) canvas.innerHTML = "";
    if (linkEl) linkEl.textContent = "Building your link…";
    if (copyBtn) copyBtn.disabled = true;

    const target = await resolveShareTarget();
    if (page.hidden) return; // closed while we were fetching

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

  // ── Profile page open/close ────────────────────────────────────────

  function openProfilePage() {
    const page = document.getElementById("profile-page");
    if (!page) return;
    page.hidden = false;
    paintIdentity();
    paintAvatar();
    paintShare();
  }

  function closeProfilePage() {
    const page = document.getElementById("profile-page");
    if (page) page.hidden = true;
  }

  // First-run nudge: if the founder has no photo yet, open the upload
  // page straight away so they're asked rather than left looking at a
  // placeholder. Fires at most once per page load, only once any sign-in
  // gate is down and the welcome screen is the thing on stage — never
  // over a draft, a published reader, or the auth gate.
  let prompted = false;
  function maybePromptUpload() {
    if (prompted || getAvatar()) return;
    if (document.documentElement.classList.contains("auth-gating")) return;
    if (window.tinkerAuth && !window.tinkerAuth.token && isWebPlatform()) return;
    const welcome = document.getElementById("welcome");
    if (!welcome || !welcome.hasAttribute("data-active")) return;
    const page = document.getElementById("profile-page");
    if (!page || !page.hidden) return;
    prompted = true;
    openProfilePage();
  }

  function wirePage() {
    const page = document.getElementById("profile-page");
    if (!page) return;

    page.addEventListener("click", (e) => {
      if (e.target.closest("[data-profile-close]")) closeProfilePage();
    });

    const copyBtn = page.querySelector("[data-qr-copy]");
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

    const signout = page.querySelector('[data-profile-action="signout"]');
    if (signout) {
      signout.addEventListener("click", () => {
        if (window.tinkerAuth && typeof window.tinkerAuth.signOut === "function") {
          window.tinkerAuth.signOut();
        }
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !page.hidden) closeProfilePage();
    });
  }

  // ── Init ───────────────────────────────────────────────────────────

  ready(() => {
    if (!document.getElementById("profile-page")) return;
    const welcome = document.getElementById("welcome-avatar");
    if (welcome) welcome.addEventListener("click", openProfilePage);
    wirePhotoControls();
    wirePage();
    paintIdentity();
    paintAvatar();
    // Returning, already-signed-in founders with no photo get asked now;
    // web first-timers get asked after the sign-in gate drops (below).
    maybePromptUpload();
  });

  // Keep avatars in sync across surfaces, and re-paint identity after a
  // web sign-in completes (auth.js dispatches tinker:auth-changed).
  window.addEventListener("tinker:avatar-changed", paintAvatar);
  window.addEventListener("tinker:auth-changed", () => {
    paintIdentity();
    // Wait for auth.js to drop the gate (~350ms) before we ask.
    setTimeout(maybePromptUpload, 600);
  });
})();
