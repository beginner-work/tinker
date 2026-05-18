/* GET/PUT /api/user-data/tree
 *
 * Holds the cached clustering tree the sidebar renders from. Shape:
 *   { earths: [{ earthId, earthName, seeds: [...] }, ...] }
 * Written by the renderer after every successful /api/cluster call so
 * the same tree appears across the founder's devices without each one
 * having to re-cluster. Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("tree");
