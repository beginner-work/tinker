/* tinker — Upgrade button
 *
 * Wires the "Upgrade" entry in the sidebar Account list to open the
 * Stripe-hosted Payment Link in a new tab. Same URL across preview
 * and production: the price, trial, and post-payment behavior all
 * live in the Stripe dashboard, so there's no backend in tinker.
 */

(() => {
  "use strict";

  const PAYMENT_LINK = "https://buy.stripe.com/aFadR31m450B1rE2KJ3F604";

  const btn = document.getElementById("nav-upgrade");
  if (!btn) return;

  btn.addEventListener("click", () => {
    window.open(PAYMENT_LINK, "_blank", "noopener,noreferrer");
  });
})();
