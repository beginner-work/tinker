/* GET/PUT /api/user-data/earths
 *
 * Holds both the explicit Earth list and the hidden-key tombstones in a
 * single { explicit: [...], hidden: [...] } blob so a single round-trip
 * keeps the two in sync. Auth: Stytch session token.
 *
 * Renamed from /api/user-data/seeds in the v0.102 sidebar revamp.
 * "Seed" now means "AI-derived cluster" (see /api/cluster). The place
 * data lives here.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("earths");
