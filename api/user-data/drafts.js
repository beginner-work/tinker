/* GET/PUT /api/user-data/drafts
 *
 * GET  → { data: <drafts array> | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * Whole-array semantics. Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("drafts");
