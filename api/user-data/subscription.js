/* GET/PUT /api/user-data/subscription
 *
 * GET  → { data: { tier, status, activatedAt, source } | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * The paid-tier blob for the calling user. The authoritative writer
 * is /api/stripe-webhook (on checkout.session.completed); the client
 * reads via GET and uses PUT only to record a local dev override
 * (window.tinkerSubscription.activatePreseed()). Stripe's webhook
 * upserts the same row using the Stytch user_id passed through as
 * client_reference_id at checkout time.
 *
 * Auth: Stytch session token, same as the other user-data kinds.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("subscription");
