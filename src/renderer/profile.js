/* profile.js — the founder's profile photo and the upload page.
 *
 * The welcome screen's centre avatar (#welcome-avatar) shows the
 * founder's profile photo — or a placeholder. Tapping it opens
 * #profile-page, a full-screen page where they can upload / change /
 * remove their photo. On first run (or any load with no photo set) the
 * page is shown automatically so they're asked to add one.
 *
 * The photo is stored on the device as a downscaled data URL under
 * `tinker_avatar` and broadcast via the `tinker:avatar-changed` event so
 * every avatar surface repaints live.
 */

(function () {
  "use strict";

  const AVATAR_KEY = "tinker_avatar";
  const MAX_DIM = 512; // longest edge after downscale, keeps storage small

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function isWebPlatform() {
    return document.documentElement.classList.contains("on-web");
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

  // Downscale a picked file to a data URL no bigger than MAX_DIM on its
  // longest edge. Resolves with the data URL, or rejects.
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

  // ── Profile page open/close ────────────────────────────────────────

  function openProfilePage() {
    const page = document.getElementById("profile-page");
    if (!page) return;
    page.hidden = false;
    paintAvatar();
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
    paintAvatar();
    // Returning, already-signed-in founders with no photo get asked now;
    // web first-timers get asked after the sign-in gate drops (below).
    maybePromptUpload();
  });

  window.addEventListener("tinker:avatar-changed", paintAvatar);
  // After a web sign-in completes (auth.js dispatches this), ask once the
  // gate has dropped (~350ms).
  window.addEventListener("tinker:auth-changed", () => {
    setTimeout(maybePromptUpload, 600);
  });
})();
