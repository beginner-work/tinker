/* GET/PUT /api/user-data/tree
 *
 * Holds the cached clustering output produced by /api/cluster — the
 * three-tier Earth → Seed → Growth vector blob rendered into the
 * sidebar. Persisted here (rather than recomputed on every device)
 * so a second device sees the same tree without paying for another
 * clustering call. Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("tree");
