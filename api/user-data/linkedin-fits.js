/* GET/PUT /api/user-data/linkedin-fits
 *
 * GET  → { data: <verdict cache object> | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * Whole-object semantics: the client owns the inner shape (a map of
 * essay id → verdict) and replaces the full object on every save.
 * Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("linkedin-fits");
