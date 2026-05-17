/* GET/PUT /api/user-data/earths
 *
 * Holds both the explicit earth list (places the founder writes from)
 * and the hidden-key tombstones in a single { explicit: [...], hidden: [...] }
 * blob so a single round-trip keeps the two in sync. Auth: Stytch session
 * token.
 *
 * Renamed from /api/user-data/seeds in v0.102 — "seed" now means an
 * AI-derived cluster (see /api/cluster). The place concept is "earth".
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("earths");
