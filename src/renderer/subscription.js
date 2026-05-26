/* tinker — subscription state
 *
 * Tracks the founder's paid tier. The only tier today is "pre-seed"
 * ($8 / month) which unlocks the multi-pitch switcher — without it,
 * every pitch except the most robust one renders blurred in the
 * sidebar dropdown (see sidebar-tree.js).
 *
 * Storage:
 *   - tinker.subscription.v1
 *       {
 *         tier: "preseed" | null,
 *         status: "active" | "inactive",
 *         activatedAt: <ts> | null,
 *       }
 *
 * Activation paths:
 *   1. The Stripe payment link's success URL is configured to redirect
 *      back to the app with ?preseed=success. On boot, if that query
 *      param is present, we mark the tier active and strip the param
 *      from the URL so reloads don't re-trigger any UI.
 *   2. window.tinkerSubscription.activatePreseed() — callable from the
 *      upgrade button click handler or the inspector for manual
 *      activation during dev.
 *
 * Events:
 *   - "tinker:subscription-changed"   the active tier changed.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.subscription.v1";
  const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/bJe5kx8Owdx70nA9973F605";

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

  function getSubscription() {
    return load();
  }

  function isPreseed() {
    const s = load();
    return !!(s && s.tier === "preseed" && s.status === "active");
  }

  function activatePreseed() {
    const next = {
      tier: "preseed",
      status: "active",
      activatedAt: Date.now(),
    };
    const current = load();
    if (current && current.tier === next.tier && current.status === next.status) {
      return false;
    }
    save(next);
    fire();
    return true;
  }

  function startCheckout() {
    // Hand off to Stripe in the same window so the configured success
    // redirect lands back here with ?preseed=success — see activation
    // path #1 above. localStorage holds every consumer module's state,
    // so the round-trip rehydrates cleanly.
    window.location.href = STRIPE_PAYMENT_LINK;
  }

  // Activation path #1: check the URL for ?preseed=success on boot.
  // Strip the param afterwards so a reload doesn't keep the marker in
  // the address bar.
  function consumeSuccessRedirect() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("preseed") !== "success") return;
      url.searchParams.delete("preseed");
      activatePreseed();
      const cleaned = url.pathname + (url.search ? url.search : "") + (url.hash || "");
      window.history.replaceState({}, "", cleaned);
    } catch { /* ignore */ }
  }

  window.tinkerSubscription = {
    getSubscription,
    isPreseed,
    activatePreseed,
    startCheckout,
    STRIPE_PAYMENT_LINK,
  };

  consumeSuccessRedirect();
})();
