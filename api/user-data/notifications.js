/* GET/PUT /api/user-data/notifications
 *
 * GET  → { data: <notifications array> | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * The notification store (notifications.js) — including which ones the
 * founder has acknowledged — round-trips here so a notice raised on one
 * device shows up on the others and stays until it's dismissed anywhere.
 * Whole-array semantics; the client owns the inner shape and merges by
 * id on hydrate. Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("notifications");
