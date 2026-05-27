/* tinker — subscription state
 *
 * Tracks the founder's paid tier. The only tier today is "pre-seed"
 * ($8 / month) which unlocks the multi-pitch switcher — without it,
 * every pitch except the most robust one renders blurred in the
 * sidebar dropdown (see sidebar-tree.js).
 *
 * Source of truth is server-side: TinkerUserData{ userId,
 * kind:"subscription" }, written by /api/checkout/verify after the
 * founder returns from Stripe (the server fetches the Checkout
 * Session via Stripe API to confirm payment_status === "paid"
 * before persisting). localStorage is a synchronous cache the
 * sidebar can read on render — never the authority.
 *
 * Boot flow:
 *
 *   1. If the URL has `?stripe_session_id=cs_…` (the post-payment
 *      redirect Stripe sends back from /api/checkout/preseed), POST
 *      that id to /api/checkout/verify and then strip the param.
 *      That call is the one that flips the row to active.
 *   2. Whether or not (1) ran, hydrate from
 *      /api/user-data/subscription so the sidebar gets the row.
 *      Also re-hydrate on every visibilitychange so a founder who
 *      paid in another tab sees the unlock on return.
 *
 * Upgrade flow:
 *
 *   1. Click the indigo "Upgrade to pre-seed" button in the sidebar
 *      → renderer.js calls startCheckout().
 *   2. startCheckout() POSTs /api/checkout/preseed; the server
 *      creates a Stripe Checkout Session pinned to this user's
 *      Stytch user_id and returns its hosted URL. We navigate
 *      same-window.
 *   3. Stripe runs checkout and, on success, redirects back to
 *      `/?stripe_session_id={CHECKOUT_SESSION_ID}` (the success_url
 *      we baked into the session). Step (1) of the boot flow handles
 *      that return.
 *
 * Local dev override: window.tinkerSubscription.activatePreseed()
 * still works without hitting Stripe — it PUTs a manual-source row
 * to the same table so it persists per-user just like the real one.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.subscription.v1";
  const TOKEN_KEY = "tinker_jwt";
  const RETURN_PARAM = "stripe_session_id";

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch { return null; }
  }

  function save(value) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
    catch { /* ignore */ }
  }

  function fire() {
    try { window.dispatchEvent(new CustomEvent("tinker:subscription-changed")); }
    catch { /* ignore */ }
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  function isActive(blob) {
    return !!(blob && blob.tier === "preseed" && blob.status === "active");
  }

  function getSubscription() {
    return load();
  }

  function isPreseed() {
    return isActive(load());
  }

  function applyServerBlob(blob) {
    const prevActive = isActive(load());
    if (blob && typeof blob === "object") {
      save(blob);
    } else {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
    const nextActive = isActive(load());
    if (prevActive !== nextActive) fire();
    return prevActive !== nextActive;
  }

  async function hydrate() {
    const t = token();
    if (!t) return;
    let res;
    try {
      res = await fetch("/api/user-data/subscription", {
        method: "GET",
        headers: { Authorization: `Bearer ${t}` },
      });
    } catch { return; }
    if (!res.ok) return;
    let json;
    try { json = await res.json(); } catch { return; }
    const data = json && Object.prototype.hasOwnProperty.call(json, "data") ? json.data : null;
    applyServerBlob(data);
  }

  async function startCheckout() {
    const t = token();
    if (!t) return;
    let res;
    try {
      res = await fetch("/api/checkout/preseed", {
        method: "POST",
        headers: { Authorization: `Bearer ${t}` },
      });
    } catch {
      return;
    }
    if (!res.ok) return;
    let json;
    try { json = await res.json(); } catch { return; }
    if (!json || typeof json.url !== "string") return;
    // Same-window navigation so Stripe's success_url redirect lands
    // back in the app and the boot-time consumeReturnRedirect() call
    // can finalize the upgrade.
    window.location.href = json.url;
  }

  // Boot path #1: the URL came back from Stripe with the session id.
  // Hand it to /api/checkout/verify which fetches the session via
  // the Stripe API (server-side, using STRIPE_SECRET_KEY) and only
  // writes the row if payment_status === "paid" AND the session's
  // client_reference_id matches the calling user.
  async function consumeReturnRedirect() {
    let url;
    try { url = new URL(window.location.href); }
    catch { return; }
    const sessionId = url.searchParams.get(RETURN_PARAM);
    if (!sessionId) return;
    // Strip the param immediately so a reload doesn't keep replaying
    // the verify call (the server is idempotent, but the founder
    // shouldn't keep seeing the marker in their address bar).
    url.searchParams.delete(RETURN_PARAM);
    const cleaned = url.pathname + (url.search ? url.search : "") + (url.hash || "");
    try { window.history.replaceState({}, "", cleaned); } catch { /* ignore */ }

    const t = token();
    if (!t) return;
    let res;
    try {
      res = await fetch("/api/checkout/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({ sessionId }),
      });
    } catch { return; }
    if (!res.ok) return;
    let blob;
    try { blob = await res.json(); } catch { return; }
    if (!blob || typeof blob !== "object") return;
    applyServerBlob({
      tier: blob.tier || "preseed",
      status: blob.status || "active",
      activatedAt: blob.activatedAt || Date.now(),
      source: "checkout-verify",
    });
  }

  // Local-dev override: PUTs a "manual"-source row to the same table
  // so the unlock persists per-user even without going through Stripe.
  async function activatePreseed() {
    const blob = {
      tier: "preseed",
      status: "active",
      activatedAt: Date.now(),
      source: "manual",
    };
    applyServerBlob(blob);
    const t = token();
    if (!t) return true;
    try {
      await fetch("/api/user-data/subscription", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({ data: blob }),
      });
    } catch { /* best-effort */ }
    return true;
  }

  window.tinkerSubscription = {
    getSubscription,
    isPreseed,
    activatePreseed,
    startCheckout,
    hydrate,
  };

  // Run the return-redirect handler first so a returning founder's
  // /verify call has a chance to land before the generic hydrate.
  // Both are awaited inside an async IIFE so the second only runs
  // after the first resolves.
  (async () => {
    await consumeReturnRedirect();
    await hydrate();
  })();
  window.addEventListener("tinker:auth-changed", () => { hydrate(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") hydrate();
  });
})();
