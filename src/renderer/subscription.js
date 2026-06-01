/* subscription.js — the founder's plan tier, persisted locally.
 *
 * tinker's paywalled feature (Pitch) is unlocked by the pre-seed
 * ($9/month) plan sold over on beginner. Until tinker has a server-backed
 * entitlement check, the tier the founder is on is persisted right here:
 * beginner's checkout sends them back with ?unlocked=1, we record
 * "pre-seed", and every surface that gates on Pitch reads it from this
 * one place — so clicking Pitch on the pre-seed plan reliably opens the
 * QR code, across reloads and app restarts.
 *
 * Tiers: "free" (default) | "pre-seed".
 *
 * window.tinkerSubscription:
 *   getTier()         -> "free" | "pre-seed"
 *   setTier(tier)     -> persist a tier (fires tinker:subscription-changed)
 *   isPitchUnlocked() -> true when the current tier unlocks Pitch
 *   refresh()         -> ask the server for the Stripe-synced tier and
 *                        reconcile the local cache; resolves to the tier
 *   clear()           -> reset to free (e.g. on sign-out)
 *
 * Source of truth: Stripe. beginner's webhook writes the live tier into
 * the shared user-data store on every subscription change; tinker's
 * /api/subscription reads it back. The local cache is only an optimistic
 * hint so the UI is instant — refresh() reconciles it to Stripe.
 */
(() => {
  "use strict";

  const KEY = "tinker_subscription_tier";
  const TOKEN_KEY = "tinker_jwt";
  // After an optimistic unlock (the ?unlocked=1 return from checkout),
  // Stripe's webhook may take a few seconds to write the tier back. Until
  // this timestamp passes, refresh() won't downgrade a paid cache to free
  // on the webhook's behalf — so a founder who just paid isn't re-locked
  // for the gap between the success redirect and the webhook landing.
  const OPTIMISTIC_KEY = "tinker_subscription_optimistic_until";
  const OPTIMISTIC_GRACE_MS = 10 * 60 * 1000; // 10 minutes
  // The very first cut stored a bare boolean; keep reading/writing it so a
  // founder who unlocked before this shipped isn't silently downgraded.
  const LEGACY_FLAG = "tinker_pitch_unlocked";
  const FREE = "free";
  const PAID_TIERS = new Set(["pre-seed"]);

  function read() {
    try {
      const tier = window.localStorage.getItem(KEY);
      if (tier) return tier;
      if (window.localStorage.getItem(LEGACY_FLAG) === "1") return "pre-seed";
    } catch { /* ignore */ }
    return FREE;
  }

  function getTier() {
    return read();
  }

  function setTier(tier, opts) {
    const value = tier || FREE;
    const before = read();
    try {
      window.localStorage.setItem(KEY, value);
      // Mirror into the legacy flag so any not-yet-updated reader still
      // sees the unlock.
      if (PAID_TIERS.has(value)) {
        window.localStorage.setItem(LEGACY_FLAG, "1");
      } else {
        window.localStorage.removeItem(LEGACY_FLAG);
      }
      // Open a grace window on an optimistic unlock (the post-checkout
      // return); clear it whenever the tier is set authoritatively.
      if (opts && opts.optimistic && PAID_TIERS.has(value)) {
        window.localStorage.setItem(OPTIMISTIC_KEY, String(Date.now() + OPTIMISTIC_GRACE_MS));
      } else {
        window.localStorage.removeItem(OPTIMISTIC_KEY);
      }
    } catch { /* ignore */ }
    if (value !== before) emitChanged(value);
  }

  function withinOptimisticGrace() {
    try {
      const until = Number(window.localStorage.getItem(OPTIMISTIC_KEY) || 0);
      return Number.isFinite(until) && Date.now() < until;
    } catch {
      return false;
    }
  }

  function isPitchUnlocked() {
    return PAID_TIERS.has(read());
  }

  function emitChanged(tier) {
    try {
      window.dispatchEvent(
        new CustomEvent("tinker:subscription-changed", { detail: { tier } })
      );
    } catch { /* CustomEvent unavailable — fine */ }
  }

  // Ask the server for the Stripe-synced tier and reconcile the cache.
  // On any failure (offline, signed out) we keep the optimistic cache,
  // never downgrade a paid founder because the network blipped.
  async function refresh() {
    let token = "";
    try { token = window.localStorage.getItem(TOKEN_KEY) || ""; } catch { /* ignore */ }
    if (!token) return read();
    try {
      const res = await fetch("/api/subscription", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return read();
      const data = await res.json().catch(() => null);
      if (data && typeof data.tier === "string") {
        // Don't let a webhook lag re-lock a founder who just paid: while
        // the optimistic grace window is open, ignore a server "free"
        // that would downgrade a paid cache. (Upgrades always apply.)
        if (
          !PAID_TIERS.has(data.tier) &&
          PAID_TIERS.has(read()) &&
          withinOptimisticGrace()
        ) {
          return read();
        }
        setTier(data.tier);
        return data.tier;
      }
    } catch { /* keep cache */ }
    return read();
  }

  function clear() {
    try {
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem(LEGACY_FLAG);
    } catch { /* ignore */ }
  }

  window.tinkerSubscription = { getTier, setTier, isPitchUnlocked, refresh, clear };
})();
