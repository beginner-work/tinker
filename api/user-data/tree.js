/* GET/PUT /api/user-data/tree
 *
 * Holds the clustered sidebar tree — the response shape returned by
 * /api/cluster: { earths: [{ earthId, earthName, seeds: [...] }, ...] }.
 * Auth: Stytch session token.
 *
 * The tree is derived data (re-computed by /api/cluster on every
 * writing-session close) but it round-trips through this slot so a
 * second device renders the same tree on first load without paying
 * for the clustering call.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("tree");
