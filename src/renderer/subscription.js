/* tinker — subscription state
 *
 * Tracks the founder's paid tier. The only tier today is "pre-seed"
 * ($8 / month) which unlocks the multi-pitch switcher — without it,
 * every pitch except the most robust one renders blurred in the
 * sidebar dropdown (see sidebar-tree.js).
 *
 * Source of truth is server-side: TinkerUserData{ userId,
 * kind:"subscription" }, written by /api/stripe-webhook on
 * checkout.session.completed and read by the client via
 * /api/user-data/subscription. localStorage is a synchronous cache
 * the sidebar can read on render — never the authority.
 *
 * Boot flow:
 *
 *   1. On load (and whenever the tab becomes visible again), GET
 *      /api/user-data/subscription with the Stytch session token.
 *      Mirror the server's blob into localStorage and fire
 *      "tinker:subscription-changed" if the active state moved.
 *   2. The sidebar reads isPreseed() synchronously on render.
 *
 * Upgrade flow:
 *
 *   1. Click the indigo "Upgrade to pre-seed" button in the sidebar
 *      → renderer.js calls startCheckout().
 *   2. startCheckout() POSTs /api/checkout/preseed, which mints a
 *      Stripe URL with client_reference_id=<userId> set. We navigate
 *      to that URL in the same window.
 *   3. The founder pays on Stripe; Stripe fires the
 *      checkout.session.completed webhook back to us with that
 *      client_reference_id. /api/stripe-webhook writes the row.
 *   4. When the founder returns to the tab, the visibilitychange
 *      hydrate above picks up the new row and the sidebar re-renders.
 *
 * Local dev override: window.tinkerSubscription.activatePreseed()
 * still works without hitting Stripe — it PUTs a dev-source row to
 * the same table so it persists per-user just like the real one.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.subscription.v1";
  const TOKEN_KEY = "tinker_jwt";

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

  // Apply an incoming server (or local-dev) blob to localStorage.
  // Returns true if the active state flipped.
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
    // Same-window navigation so the post-payment redirect lands back
    // in the app; localStorage and the server-side row both round-trip
    // cleanly on the return.
    window.location.href = json.url;
  }

  // Local-dev override: PUTs a "dev"-source row to the same table so
  // the unlock persists per-user even without going through Stripe.
  // Useful for the inspector and for tests on preview deployments.
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

  // Hydrate as soon as a token is available, and again whenever the
  // tab returns to the foreground — that's the moment the founder
  // comes back from Stripe checkout.
  hydrate();
  window.addEventListener("tinker:auth-changed", () => { hydrate(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") hydrate();
  });
})();
