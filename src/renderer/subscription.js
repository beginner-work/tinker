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
 *   setTier(tier)     -> persist a tier
 *   isPitchUnlocked() -> true when the current tier unlocks Pitch
 *   clear()           -> reset to free (e.g. on sign-out)
 */
(() => {
  "use strict";

  const KEY = "tinker_subscription_tier";
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

  function setTier(tier) {
    const value = tier || FREE;
    try {
      window.localStorage.setItem(KEY, value);
      // Mirror into the legacy flag so any not-yet-updated reader still
      // sees the unlock.
      if (PAID_TIERS.has(value)) {
        window.localStorage.setItem(LEGACY_FLAG, "1");
      } else {
        window.localStorage.removeItem(LEGACY_FLAG);
      }
    } catch { /* ignore */ }
  }

  function isPitchUnlocked() {
    return PAID_TIERS.has(read());
  }

  function clear() {
    try {
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem(LEGACY_FLAG);
    } catch { /* ignore */ }
  }

  window.tinkerSubscription = { getTier, setTier, isPitchUnlocked, clear };
})();
