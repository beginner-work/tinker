/* GET/PUT /api/user-data/linkedin-pitch-draft
 *
 * GET  → { data: <stitched-draft object> | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * Whole-object semantics: the client owns the inner shape
 * ({ segments, essayIds, ts }) and replaces it on every save.
 * Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("linkedin-pitch-draft");
