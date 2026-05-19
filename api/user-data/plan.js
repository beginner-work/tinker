/* GET/PUT /api/user-data/plan
 *
 * GET  → { data: { tier } | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * Whole-blob semantics: the client owns the inner shape (the v0.102
 * Plan section writes { tier } where tier is one of the deck's
 * verbatim strings — "Free to start", "$7", "$35", "$70",
 * "Enterprise") and replaces the full object on every save. Auth:
 * Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("plan");
