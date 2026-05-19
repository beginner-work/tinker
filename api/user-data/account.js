/* GET/PUT /api/user-data/account
 *
 * GET  → { data: { name, linkedin, completedAt } | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * Whole-blob semantics: the client owns the inner shape (the v0.102
 * Account setup form writes { name, linkedin, completedAt }) and
 * replaces the full object on every save. Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("account");
