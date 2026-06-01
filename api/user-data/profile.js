/* GET/PUT /api/user-data/profile
 *
 * GET  → { data: { name, email, avatarUrl, plan, createdAt } | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * The canonical tinker profile, keyed by Stytch user_id. Written by the
 * claim path (api/profile/claim.js, from the landing form) and readable
 * by the app to show the founder's avatar. Same whole-blob, Stytch-auth
 * semantics as the other user-data kinds.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("profile");
