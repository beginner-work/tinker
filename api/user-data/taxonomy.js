/* GET/PUT /api/user-data/taxonomy
 *
 * Holds the Claude-managed taxonomy: { taxonomy: {...}, seeds: {...} }.
 * The classifier rewrites the whole map on each pass, so whole-blob
 * semantics match how the client already treats it.
 * Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("taxonomy");
