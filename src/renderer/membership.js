/* membership.js — sidebar "Account" plan row.
 *
 * Surfaces which membership tier the signed-in founder is on, and what it
 * costs them each month, right inside the sidebar's Account section. The
 * server already owns entitlement (api/membership/status reads the one
 * `membership` row the Stripe webhook writes); this file is the read-only
 * mirror of that for the eyes.
 *
 *   active member  →  "Pre-seed · $9/mo"  +  "Renews Jul 1, 2026"
 *   free account   →  "Free plan"         +  "Pre-seed is $9/mo" + [Upgrade]
 *
 * Tapping the row when there's nothing to buy is a no-op; on a free account
 * the trailing "Upgrade" badge opens Stripe Checkout via the existing
 * /api/membership/checkout endpoint and redirects the tab to it. A free
 * account also gets a quiet "Already subscribed? Restore" row beneath, which
 * links a subscription started elsewhere (e.g. the beginner "Back me" page)
 * to this account via /api/membership/reconcile.
 *
 * Everything is best-effort and same-origin. We only show the row once a
 * status response has come back, so a signed-out tab — or an Electron
 * session that authenticates differently and has no token — never
 * flashes a stale plan. The pure formatter is exposed on
 * window.tinkerMembership for unit tests.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  // A one-time pre-seed pass bought anonymously on the beginner Back me page is
  // parked under this key by pwa-session.js (from the `#claim_pass=` handoff)
  // and redeemed here at first sign-in. Kept separate from the profile claim
  // (`tinker_claim`) so it can retry independently until the pass is granted.
  var PASS_CLAIM_KEY = "tinker_pass_claim";

  // Known tiers and their monthly price, mirroring api/_lib/stripe-checkout.js
  // (PRESEED_AMOUNT_CENTS = 900). Display copy only — the server is the source
  // of truth for who's entitled.
  var TIERS = {
    "pre-seed": { name: "Pre-seed", monthly: "$9/mo" },
  };

  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  }
  function authHeaders(token) {
    return { Authorization: "Bearer " + token };
  }

  // ── Pure formatting ──────────────────────────────────────────────────
  //
  // status: { active, tier, status, currentPeriodEnd } — exactly the shape
  // GET /api/membership/status returns. Returns the three strings the row
  // renders, plus whether to show the upgrade CTA.

  function formatDate(epochSec) {
    if (!epochSec) return "";
    try {
      var d = new Date(epochSec * 1000);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch { return ""; }
  }

  function formatMembership(status) {
    status = status || {};
    var info = TIERS[status.tier] || null;

    if (status.active && info) {
      var when = formatDate(status.currentPeriodEnd);
      // A one-time pass has no subscription behind it: it expires (it doesn't
      // renew), there's nothing to pause, and "Restore" would find nothing.
      if (status.oneTime) {
        return {
          active: true,
          label: info.name + " · 30-day pass",
          sub: when ? "Pass active — expires " + when : "Pass active",
          cta: "",
          restore: false,
          pause: "",
        };
      }
      var sub;
      if (status.status === "trialing") sub = when ? "Free trial — renews " + when : "Free trial";
      else if (status.status === "past_due") sub = "Payment past due — update card";
      else sub = when ? "Renews " + when : "Active";
      // An active member can pause billing — a softer exit than canceling,
      // since the subscription stays put and one tap brings it back.
      return { active: true, label: info.name + " · " + info.monthly, sub: sub, cta: "", restore: false, pause: "pause" };
    }

    // Paused: billing is suspended but the subscription is dormant, not gone.
    // We keep showing the tier (not "Free plan") and offer a one-tap resume so
    // the member can pick up where they left off.
    if (status.status === "paused" && info) {
      return { active: false, label: info.name + " · Paused", sub: "Billing paused — resume anytime", cta: "", restore: false, pause: "resume" };
    }

    // Anything else not entitled reads as a free account, with a nudge to
    // upgrade and a quiet way to link a subscription that was started elsewhere.
    return { active: false, label: "Free plan", sub: "Pre-seed is $9/mo", cta: "Upgrade", restore: true, pause: "" };
  }

  // ── Network ──────────────────────────────────────────────────────────

  function loadStatus(token) {
    return fetch("/api/membership/status", { headers: authHeaders(token) })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  // Redeem a parked one-time pass against this account. Best-effort: on a
  // successful claim we drop the token; otherwise we keep it so a pass whose
  // payment webhook hasn't landed yet is retried on the next load. Resolves to
  // true only when the pass was actually granted.
  function claimParkedPass(token) {
    var claim = read(PASS_CLAIM_KEY);
    if (!claim) return Promise.resolve(false);
    return fetch("/api/membership/claim", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify({ claim_token: claim }),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (json && json.claimed) {
          try { localStorage.removeItem(PASS_CLAIM_KEY); } catch { /* ignore */ }
          return true;
        }
        return false;
      })
      .catch(function () { return false; });
  }

  function dropParkedPass() {
    try { localStorage.removeItem(PASS_CLAIM_KEY); } catch { /* ignore */ }
  }

  // Open Stripe Checkout for the pre-seed membership and send the tab there.
  // The success/cancel URLs bounce back to wherever we are now (returnPath),
  // and a fresh status fetch on the next load reflects the result.
  function startCheckout(token, btn) {
    var returnPath = "/";
    try { returnPath = window.location.pathname || "/"; } catch { /* ignore */ }
    return fetch("/api/membership/checkout", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify({ returnPath: returnPath, origin: window.location.origin }),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (json && json.url) { window.location.href = json.url; return; }
        if (btn) flashError(btn);
      })
      .catch(function () { if (btn) flashError(btn); });
  }

  function flashError(btn) {
    var cta = btn.querySelector("[data-membership-cta]");
    if (!cta) return;
    var prev = cta.textContent;
    cta.textContent = "Try again";
    setTimeout(function () { cta.textContent = prev || "Upgrade"; }, 2200);
  }

  var RESTORE_LABEL = "Already subscribed? Restore";

  function setRestoreText(btn, text, reset) {
    if (!btn) return;
    btn.textContent = text;
    if (reset) setTimeout(function () { btn.textContent = RESTORE_LABEL; }, 2600);
  }

  function askEmail() {
    try {
      var v = window.prompt("Enter the email you used to subscribe:");
      return v ? v.trim() : "";
    } catch { return ""; }
  }

  // Link an already-paid subscription to this account — for memberships
  // started outside tinker's own checkout (e.g. the beginner "Back me" page),
  // which carry no tinker user_id for the webhook to key on. Tries the account
  // email server-side first; if that finds nothing, asks once for the email
  // used at checkout. On success, re-pull status so the row flips to the tier.
  function startReconcile(token, btn, emailOverride) {
    setRestoreText(btn, "Restoring…");
    return fetch("/api/membership/reconcile", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify(emailOverride ? { email: emailOverride } : {}),
    })
      .then(function (res) {
        // Keep the HTTP status alongside the body. A *clean* empty result is a
        // 200 with { restored:false, reason }. A 503 (Stripe key not configured
        // on this deploy), a 502 (Stripe rejected the request — e.g. a wrong or
        // test-mode key), or any other 5xx is a SERVER/CONFIG failure, not "you
        // have no subscription". The old code collapsed every non-ok response to
        // null and reported "No subscription found" for all of them, so a
        // misconfigured deploy looked exactly like a genuine miss — which is how
        // a broken reconcile could survive several rounds of UI fixes unnoticed.
        var ok = res.ok;
        var status = res.status;
        return res.json().then(
          function (body) { return { ok: ok, status: status, body: body }; },
          function () { return { ok: ok, status: status, body: null }; }
        );
      })
      .then(function (r) {
        var json = r.body;
        if (r.ok && json && json.restored) {
          // Paint the row straight from the reconcile response — it carries the
          // same { active, tier, status, currentPeriodEnd } shape status returns
          // and is the freshly-written source of truth. Re-pulling /status here
          // instead would discard that for a read that can come back stale from
          // the HTTP cache, lag read-after-write, or blip to a 5xx — and
          // loadStatus collapses all of those to null, which renders as "Free
          // plan", bouncing the member we just restored right back to free.
          var row = document.getElementById("nav-membership");
          if (row) render(row, json);
          return;
        }
        // Server/config failure — surface it as its own state (and leave the
        // link live to retry) rather than mislabeling it "No subscription found".
        if (!r.ok) {
          setRestoreText(
            btn,
            r.status === 503 ? "Billing unavailable — try later" : "Couldn’t restore — try again",
            true
          );
          return;
        }
        // A genuine empty result (HTTP 200). Ask for an email at most once — if
        // we already tried one, stop.
        if (!emailOverride && json && (json.reason === "no-email" || json.reason === "no-subscription")) {
          var typed = askEmail();
          if (typed) return startReconcile(token, btn, typed);
        }
        setRestoreText(btn, "No subscription found", true);
      })
      .catch(function () { setRestoreText(btn, "Try again", true); });
  }

  // Pause / resume the member's subscription. Pausing keeps the subscription
  // alive but stops billing until they resume; the endpoint returns the same
  // { active, tier, status, currentPeriodEnd } shape /status does, freshly
  // written, so we paint the row straight from it (same reasoning as restore).
  var PAUSE_LABELS = { pause: "Pause membership", resume: "Resume membership" };

  function setPauseText(btn, text, resetTo) {
    if (!btn) return;
    btn.textContent = text;
    if (resetTo) setTimeout(function () { btn.textContent = PAUSE_LABELS[resetTo] || text; }, 2600);
  }

  function startPause(token, btn, resume) {
    // Confirm the pause (not the resume) — it's the one that quietly stops a
    // member's access, so a stray click shouldn't trigger it silently.
    if (!resume) {
      var ok = true;
      try { ok = window.confirm("Pause your membership? Billing stops until you resume — your access pauses too."); } catch { ok = true; }
      if (!ok) return;
    }
    var action = resume ? "resume" : "pause";
    setPauseText(btn, resume ? "Resuming…" : "Pausing…");
    return fetch("/api/membership/pause", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(token)),
      body: JSON.stringify({ resume: resume }),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (json) {
          var row = document.getElementById("nav-membership");
          if (row) render(row, json);
          return;
        }
        setPauseText(btn, "Couldn’t " + action + " — try again", action);
      })
      .catch(function () { setPauseText(btn, "Try again", action); });
  }

  // ── Render ───────────────────────────────────────────────────────────

  function render(btn, status) {
    var view = formatMembership(status);
    var tierEl = btn.querySelector("[data-membership-tier]");
    var subEl = btn.querySelector("[data-membership-sub]");
    var ctaEl = btn.querySelector("[data-membership-cta]");

    if (tierEl) tierEl.textContent = view.label;
    if (subEl) subEl.textContent = view.sub;
    if (ctaEl) {
      if (view.cta) { ctaEl.textContent = view.cta; ctaEl.removeAttribute("hidden"); }
      else { ctaEl.textContent = ""; ctaEl.setAttribute("hidden", ""); }
    }

    // "Already subscribed? Restore" lives in its own row beneath this one;
    // only the free-plan view offers it.
    var restoreEl = document.getElementById("nav-membership-restore");
    if (restoreEl) {
      if (view.restore) restoreEl.removeAttribute("hidden");
      else restoreEl.setAttribute("hidden", "");
    }

    // Pause / resume lives in its own row too: shown to an active member
    // ("Pause membership") and to a paused one ("Resume membership"), hidden
    // for free accounts (which have nothing to pause). Its dataset.resume tells
    // the click handler which way to flip.
    var pauseEl = document.getElementById("nav-membership-pause");
    if (pauseEl) {
      if (view.pause) {
        pauseEl.textContent = PAUSE_LABELS[view.pause];
        pauseEl.dataset.resume = view.pause === "resume" ? "1" : "0";
        pauseEl.removeAttribute("hidden");
      } else {
        pauseEl.setAttribute("hidden", "");
      }
    }

    btn.dataset.active = view.active ? "1" : "0";
    // Paused accounts read as inactive but must NOT fall through to checkout on
    // a row tap — the resume row owns that. Mark them so the handler bails.
    btn.dataset.paused = view.pause === "resume" ? "1" : "0";
    btn.setAttribute(
      "aria-label",
      view.active ? "Your plan: " + view.label + ". " + view.sub : "Free plan — upgrade to pre-seed for $9 a month"
    );
    btn.removeAttribute("hidden");
  }

  // ── Orchestration ────────────────────────────────────────────────────

  var inFlight = false;
  function hydrate() {
    var btn = document.getElementById("nav-membership");
    if (!btn) return;
    var token = read(TOKEN_KEY);
    // No token → no membership identity (signed-out web, or Electron
    // which authenticates differently). Keep the row hidden.
    if (!token) { btn.setAttribute("hidden", ""); return; }
    if (inFlight) return;
    inFlight = true;

    if (!btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        // Only free accounts have something to do here — start checkout. Active
        // members (active="1") and paused ones (paused="1", whose resume lives
        // on its own row) both no-op.
        if (btn.dataset.active === "1" || btn.dataset.paused === "1") return;
        var t = read(TOKEN_KEY);
        if (t) startCheckout(t, btn);
      });
    }

    var restoreBtn = document.getElementById("nav-membership-restore");
    if (restoreBtn && !restoreBtn.dataset.bound) {
      restoreBtn.dataset.bound = "1";
      restoreBtn.addEventListener("click", function () {
        var t = read(TOKEN_KEY);
        if (t) startReconcile(t, restoreBtn);
      });
    }

    var pauseBtn = document.getElementById("nav-membership-pause");
    if (pauseBtn && !pauseBtn.dataset.bound) {
      pauseBtn.dataset.bound = "1";
      pauseBtn.addEventListener("click", function () {
        var t = read(TOKEN_KEY);
        if (t) startPause(t, pauseBtn, pauseBtn.dataset.resume === "1");
      });
    }

    // Redeem any parked one-time pass first, so the status read below reflects
    // a freshly-granted pass on this very load.
    claimParkedPass(token)
      .then(function () { return loadStatus(token); })
      .then(function (status) {
        // A null status (network/5xx) still resolves to the free-plan view —
        // better a quiet "Free plan" than a missing row mid-session.
        render(btn, status || {});
        // Stop retrying a parked pass once the account is entitled (the claim
        // succeeded, or a subscription/other pass already covers them).
        if (status && status.active) dropParkedPass();
      })
      .catch(function () { /* best-effort */ })
      .finally(function () { inFlight = false; });
  }

  // Pure helper out for tests; refresh out so other modules (e.g. after a
  // checkout return) can re-pull on demand.
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
