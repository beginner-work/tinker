/* profile.js — claim the landing-form profile, run first-login onboarding
 * for everyone else, and show the founder's avatar in the top-right corner.
 *
 * Flow after sign-in (auth.js dispatches tinker:auth-changed) and on every
 * resume (page load with a stored token):
 *   1. exchange any parked claim token for the stashed profile
 *      (POST /api/profile/claim — first write wins, single-use), else
 *   2. read the canonical profile (GET /api/user-data/profile);
 *   3a. if a profile exists → render the avatar top-right;
 *   3b. if it's definitively missing (and we're on the web gate) → show the
 *       onboarding step (photo/name/email). Saving PUTs the same
 *       (user_id,"profile") row the claim path writes, then renders.
 *
 * Source of truth: every path ends at one profile blob in the shared
 * TinkerUserData store. The in-app photo is a downscaled data: URL kept in
 * that row (well under the 256 KB cap) — no separate blob store on tinker.
 *
 * Everything is best-effort and same-origin (CSP connect-src 'self').
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var CLAIM_KEY = "tinker_claim";
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var AVATAR_MAX = 384; // px, longest edge

  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  }
  function drop(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
  function authHeaders(token) {
    return { Authorization: "Bearer " + token };
  }
  // Onboarding only belongs on the plain web sign-in gate. Electron/Capacitor
  // authenticate differently; we still render an avatar there if a profile
  // happens to exist, but never force the capture screen.
  function isWebGate() {
    try {
      if (window.tinker && window.tinker.supportsWebview === true) return false;
      return document.documentElement.classList.contains("on-web");
    } catch { return false; }
  }

  // ── Network ─────────────────────────────────────────────────────────
  function claimIfPending(token) {
    var claim = read(CLAIM_KEY);
    if (!claim) return Promise.resolve(null);
    return fetch("/api/profile/claim", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify({ claim_token: claim }),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (json && json.ok) drop(CLAIM_KEY);
        return json && json.profile ? json.profile : null;
      })
      .catch(function () { return null; });
  }

  // Resolve to { state: "present"|"missing"|"unknown", profile? }. Only a
  // definitive empty row counts as "missing"; a network/5xx error stays
  // "unknown" so a transient failure never forces onboarding.
  function loadProfile(token) {
    return fetch("/api/user-data/profile", { headers: authHeaders(token) })
      .then(function (res) {
        if (!res.ok) return { state: "unknown" };
        return res.json().then(function (json) {
          return json && json.data
            ? { state: "present", profile: json.data }
            : { state: "missing" };
        });
      })
      .catch(function () { return { state: "unknown" }; });
  }

  function saveProfile(token, profile) {
    return fetch("/api/user-data/profile", {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify({ data: profile }),
    }).then(function (res) {
      if (!res.ok) throw new Error("save-failed");
      return profile;
    });
  }

  // Shrink an image file to a small JPEG data URL that fits the profile
  // row's 256 KB cap and renders anywhere (CSP img-src allows data:).
  function downscale(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, AVATAR_MAX / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("no-canvas")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("bad-image")); };
      img.src = url;
    });
  }

  // ── Avatar render (top-right) ───────────────────────────────────────
  function initial(name, email) {
    var s = (name || email || "").trim();
    return s ? s.charAt(0).toUpperCase() : "·";
  }

  function render(profile) {
    var corner = document.getElementById("profile-corner");
    if (!corner || !profile) return;
    var btn = document.getElementById("profile-avatar");
    var img = corner.querySelector(".profile-avatar__img");
    var ini = corner.querySelector(".profile-avatar__initial");
    var nameEl = corner.querySelector(".profile-popover__name");
    var emailEl = corner.querySelector(".profile-popover__email");
    var pop = document.getElementById("profile-popover");

    var name = profile.name || "";
    var email = profile.email || "";

    if (nameEl) nameEl.textContent = name || "Founder";
    if (emailEl) emailEl.textContent = email;
    if (btn) btn.setAttribute("aria-label", name ? "Your profile: " + name : "Your profile");

    if (img && profile.avatarUrl) {
      img.alt = name ? name + "’s profile picture" : "";
      img.onload = function () {
        img.removeAttribute("hidden");
        if (ini) ini.setAttribute("hidden", "");
      };
      img.onerror = function () {
        img.setAttribute("hidden", "");
        if (ini) { ini.textContent = initial(name, email); ini.removeAttribute("hidden"); }
      };
      img.src = profile.avatarUrl;
    } else if (ini) {
      ini.textContent = initial(name, email);
      ini.removeAttribute("hidden");
      if (img) img.setAttribute("hidden", "");
    }

    corner.removeAttribute("hidden");

    if (btn && pop && !btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var open = pop.hasAttribute("hidden");
        if (open) pop.removeAttribute("hidden"); else pop.setAttribute("hidden", "");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      document.addEventListener("click", function (e) {
        if (!corner.contains(e.target) && !pop.hasAttribute("hidden")) {
          pop.setAttribute("hidden", "");
          btn.setAttribute("aria-expanded", "false");
        }
      });
    }
  }

  // ── Onboarding (first-login capture) ────────────────────────────────
  var onboardingBound = false;
  function showOnboarding(token) {
    var gate = document.getElementById("profile-onboarding");
    if (!gate) return;
    var form = document.getElementById("onboarding-form");
    var fileInput = document.getElementById("onboarding-avatar");
    var nameInput = document.getElementById("onboarding-name");
    var emailInput = document.getElementById("onboarding-email");
    var saveBtn = document.getElementById("onboarding-save");
    var errEl = document.getElementById("onboarding-error");
    var avatarImg = gate.querySelector(".onboarding__avatar-img");
    var avatarPh = gate.querySelector(".onboarding__avatar-ph");
    var hint = gate.querySelector(".onboarding__photo-hint");
    if (!form || !fileInput || !nameInput) return;

    gate.removeAttribute("hidden");
    document.documentElement.classList.add("onboarding-active");
    setTimeout(function () { try { nameInput.focus(); } catch { /* ignore */ } }, 0);

    if (onboardingBound) return;
    onboardingBound = true;

    var previewUrl = null;
    var pendingAvatar = null; // downscaled data URL once a file is chosen

    function setError(msg) {
      if (!errEl) return;
      errEl.textContent = msg || "";
      if (msg) errEl.removeAttribute("hidden"); else errEl.setAttribute("hidden", "");
    }

    fileInput.addEventListener("change", function () {
      setError("");
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (avatarImg) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        avatarImg.src = previewUrl;
        avatarImg.removeAttribute("hidden");
        if (avatarPh) avatarPh.setAttribute("hidden", "");
      }
      if (hint) hint.textContent = file.name;
      pendingAvatar = null;
      downscale(file)
        .then(function (dataUrl) { pendingAvatar = dataUrl; })
        .catch(function () { setError("That image couldn’t be read — try another."); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      setError("");
      var name = (nameInput.value || "").trim();
      var email = (emailInput && emailInput.value || "").trim();
      if (!name) { setError("Add your name so your pitches have an author."); nameInput.focus(); return; }
      if (!(fileInput.files && fileInput.files.length)) { setError("Add a profile picture — this is you, founder."); return; }
      if (email && !EMAIL_RE.test(email)) { setError("That doesn’t look like an email address."); emailInput.focus(); return; }

      saveBtn.disabled = true;
      var prev = saveBtn.textContent;
      saveBtn.textContent = "Saving…";

      var ready = pendingAvatar
        ? Promise.resolve(pendingAvatar)
        : downscale(fileInput.files[0]);

      ready
        .then(function (avatarUrl) {
          var profile = {
            name: name,
            email: email,
            avatarUrl: avatarUrl,
            createdAt: new Date().toISOString(),
          };
          return saveProfile(token, profile);
        })
        .then(function (profile) {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          gate.setAttribute("hidden", "");
          document.documentElement.classList.remove("onboarding-active");
          render(profile);
        })
        .catch(function () {
          setError("Couldn’t save just now — check your connection and try again.");
          saveBtn.disabled = false;
          saveBtn.textContent = prev;
        });
    });
  }

  // ── Orchestration ───────────────────────────────────────────────────
  var inFlight = false;
  function hydrate() {
    if (inFlight) return;
    var token = read(TOKEN_KEY);
    if (!token) return;
    inFlight = true;
    claimIfPending(token)
      .then(function (claimed) {
        if (claimed) { render(claimed); return null; }
        return loadProfile(token).then(function (res) {
          if (res.state === "present") render(res.profile);
          else if (res.state === "missing" && isWebGate()) showOnboarding(token);
          return null;
        });
      })
      .catch(function () { /* best-effort */ })
      .finally(function () { inFlight = false; });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate, { once: true });
  } else {
    hydrate();
  }
  window.addEventListener("tinker:auth-changed", hydrate);
})();
