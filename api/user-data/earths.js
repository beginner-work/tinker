/* GET/PUT /api/user-data/earths
 *
 * Holds both the explicit Earth list and the hidden-key tombstones in
 * a single { explicit: [...], hidden: [...] } blob so a single
 * round-trip keeps the two in sync. Auth: Stytch session token.
 *
 * Renamed from /api/user-data/seeds with the v0.102 sidebar revamp,
 * which reclaimed "seed" for the new cluster meaning. Old installs
 * still have their data under the "seeds" kind row; sync.js's
 * hydrate() falls back to fetching that row when this one is empty
 * and forward-migrates the blob into the "earths" row on the next
 * push.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("earths");
