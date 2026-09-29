/* membership.js: quiet claim of a parked one-time pass.
 *
 * Tinker is free. The sidebar no longer shows a plan footer, price,
 * Upgrade, Restore, or pause controls. Stripe claim still runs so a
 * pass handed off from beginner can bind to the signed-in account.
 * formatMembership stays exported for unit tests and always returns a
 * blank free view with no price label.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var PASS_CLAIM_KEY = "tinker_pass_claim";

  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  }
  function dropParkedPass() {
    try { localStorage.removeItem(PASS_CLAIM_KEY); } catch { /* ignore */ }
  }
  function authHeaders(token) {
    return { Authorization: "Bearer " + token };
  }

  // Blank free view: no price, no pause, no restore, no upgrade CTA.
  function formatMembership(/* status */) {
    return { active: false, label: "", sub: "", cta: "", restore: false, pause: "" };
  }

  function claimParkedPass(token) {
    var claim = read(PASS_CLAIM_KEY);
    if (!claim) return Promise.resolve(false);
    return fetch("/api/membership/claim", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify({ token: claim }),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (json && json.ok) {
          dropParkedPass();
          return true;
        }
        return false;
      })
      .catch(function () { return false; });
  }

  var inFlight = false;
  function hydrate() {
    var token = read(TOKEN_KEY);
    if (!token || inFlight) return;
    inFlight = true;
    claimParkedPass(token)
      .catch(function () { /* best-effort */ })
      .finally(function () { inFlight = false; });
  }

  window.tinkerMembership = { formatMembership: formatMembership, refresh: hydrate };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", hydrate, { once: true });
    } else {
      hydrate();
    }
    window.addEventListener("tinker:auth-changed", hydrate);
  }
})();
