/* GET/PUT /api/user-data/linkedin-destination
 *
 * GET  → { data: { text } | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * Whole-object semantics: the client owns the inner shape
 * ({ text: string }) and replaces it on every save.
 * Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("linkedin-destination");
