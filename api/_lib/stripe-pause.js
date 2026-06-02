/* Pure helpers for pausing / resuming a pre-seed membership subscription.
 *
 * Pausing is done with Stripe's `pause_collection` on the subscription rather
 * than a cancel: the subscription stays alive (status keeps reading "active"
 * to Stripe) but stops billing the member until they resume. We surface that
 * paused-but-alive state as our own status "paused" so feature gates can lock
 * the paid surface while billing is stopped, and the member can flip it back
 * on with one tap.
 *
 * Side-effect-free so it unit-tests without the network or the Stripe SDK,
 * matching api/_lib/stripe-checkout.js. The handler in api/membership/pause.js
 * POSTs the result to Stripe over fetch — no SDK.
 */

"use strict";

/**
 * Build the subscription-update params that pause or resume billing.
 *
 *   pause   → set pause_collection[behavior]=void so no invoice is generated
 *             while paused (the member isn't charged for the dormant time).
 *   resume  → clear pause_collection by sending it empty, which Stripe reads as
 *             "remove the pause" and bills normally again on the next cycle.
 */
function buildPauseParams({ resume } = {}) {
  const params = new URLSearchParams();
  if (resume) {
    // An empty value clears the field on Stripe's side — i.e. un-pauses.
    params.append("pause_collection", "");
  } else {
    params.append("pause_collection[behavior]", "void");
  }
  return params;
}

module.exports = { buildPauseParams };
