/* GET/PUT /api/user-data/tree
 *
 * Holds the cached three-tier sidebar tree (earths → seeds → growth
 * vectors) as returned by /api/cluster. Persisted via sync.js so the
 * same tree renders on the founder's phone PWA, desktop browser, and
 * any future Electron build without recomputation.
 *
 * Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("tree");
