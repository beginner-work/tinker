/* GET/PUT /api/user-data/tree
 *
 * Holds the cached three-tier sidebar tree (Earth → Seed → Growth
 * vector) produced by /api/cluster. The client caches it under
 * localStorage["tinker.tree.v1"] and pushes the same blob here so the
 * tree is identical across devices without recomputation.
 *
 * Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("tree");
