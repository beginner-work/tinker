/* GET/PUT /api/user-data/linkedin-posted-quotes
 *
 * GET  → { data: { quotes: [...] } | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * Whole-object semantics: the client owns the inner shape
 * ({ quotes: [{ text, essayId, postedAt, excluded }] }) and replaces
 * it on every save.
 * Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("linkedin-posted-quotes");
