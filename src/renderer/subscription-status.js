/* subscription-status.js — the "Plan" row in the sidebar Account list.
 *
 * Replaces the old inert "Receipts" placeholder with the founder's
 * current subscription tier (free / pre-seed), read from
 * window.tinkerSubscription. The tier is persisted locally and — once
 * the Stripe webhook sync is in place — reconciled against Stripe as the
 * source of truth, so the row reflects the real plan.
 *
 * Tapping the row:
 *   - on pre-seed  → opens the founder's QR code (the unlocked feature);
 *   - on free      → opens beginner's /unlock page to subscribe.
 */
(() => {
  "use strict";

  const STR = {
    free: "Free",
    preSeed: "pre-seed",
    ariaPaid: "Plan: pre-seed — show your QR code",
    ariaFree: "Plan: free — unlock Pitch",
  };

  function sub() {
    return window.tinkerSubscription || null;
  }

  function tierLabel(tier) {
    return tier === "pre-seed" ? STR.preSeed : STR.free;
  }

  function render(btn, tierEl) {
    const s = sub();
    const tier = s && typeof s.getTier === "function" ? s.getTier() : "free";
    tierEl.textContent = tierLabel(tier);
    tierEl.setAttribute("data-tier", tier);
    btn.setAttribute("aria-label", tier === "pre-seed" ? STR.ariaPaid : STR.ariaFree);
  }

  function openUnlock() {
    const url =
      (typeof window.tinkerUnlockUrl === "function" && window.tinkerUnlockUrl()) ||
      "https://beginner.work/unlock";
    if (window.tinker && typeof window.tinker.openExternal === "function") {
      window.tinker.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function init() {
    const btn = document.getElementById("nav-plan");
    if (!btn) return;
    const tierEl = btn.querySelector("[data-plan-tier]");
    if (!tierEl) return;

    render(btn, tierEl);

    btn.addEventListener("click", () => {
      const s = sub();
      const unlocked = s && typeof s.isPitchUnlocked === "function" && s.isPitchUnlocked();
      if (unlocked && typeof window.tinkerShowPitchQr === "function") {
        window.tinkerShowPitchQr();
      } else {
        openUnlock();
      }
    });

    // Reconcile against Stripe (source of truth) when the data layer can
    // — then re-render so the row reflects the authoritative tier.
    const s = sub();
    if (s && typeof s.refresh === "function") {
      Promise.resolve(s.refresh()).then(() => render(btn, tierEl)).catch(() => { /* keep cache */ });
    }

    // If another surface changes the tier (e.g. the post-checkout return),
    // keep this row in sync.
    window.addEventListener("tinker:subscription-changed", () => render(btn, tierEl));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
