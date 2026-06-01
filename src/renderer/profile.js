/* profile.js — show the founder's avatar in the top-right corner.
 *
 * The landing form ("set up your profile" on beginner-work.com) stashes a
 * profile and hands the app a one-time token as `#claim=<token>`, which
 * pwa-session.js parks in localStorage["tinker_claim"]. Once the user is
 * signed in we:
 *   1. exchange any parked claim token for the stashed profile
 *      (POST /api/profile/claim — first write wins, single-use), then
 *   2. read the canonical profile (GET /api/user-data/profile) and
 *   3. render the avatar top-right.
 *
 * Every path is best-effort: no token, no claim, or a failed request just
 * leaves the corner empty — the app is never blocked. Same-origin fetches
 * only, so the page CSP (connect-src 'self') is satisfied.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var CLAIM_KEY = "tinker_claim";

  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  }
  function drop(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  function authHeaders(token) {
    return { Authorization: "Bearer " + token };
  }

  // Trade a parked claim token for the stashed profile. Resolves to the
  // bound profile (or null). Clears the claim once the server has acted on
  // it (claimed or benign no-op); keeps it if the request never landed.
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

  function fetchProfile(token) {
    return fetch("/api/user-data/profile", { headers: authHeaders(token) })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) { return json && json.data ? json.data : null; })
      .catch(function () { return null; });
  }

  // ── Render ──────────────────────────────────────────────────────────
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
        // Decode failed — fall back to the initial badge.
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

  // ── Orchestration ───────────────────────────────────────────────────
  var inFlight = false;
  function hydrate() {
    if (inFlight) return;
    var token = read(TOKEN_KEY);
    if (!token) return;
    inFlight = true;
    claimIfPending(token)
      .then(function (claimed) {
        return claimed || fetchProfile(token);
      })
      .then(function (profile) {
        if (profile) render(profile);
      })
      .finally(function () { inFlight = false; });
  }

  // Run on load (resuming an existing session) and right after a fresh
  // sign-in (auth.js dispatches tinker:auth-changed before dropping the
  // gate, so the claim fires at first login).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate, { once: true });
  } else {
    hydrate();
  }
  window.addEventListener("tinker:auth-changed", hydrate);
})();
