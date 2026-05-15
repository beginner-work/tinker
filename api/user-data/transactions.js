/* GET/PUT /api/user-data/transactions
 *
 * GET  → { data: <transactions array> | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * Whole-array semantics: the client owns the inner shape and replaces
 * the full list on every save. Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("transactions");
