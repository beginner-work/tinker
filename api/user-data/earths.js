/* GET/PUT /api/user-data/earths
 *
 * Holds both the explicit earth list and the hidden-key tombstones in a
 * single { explicit: [...], hidden: [...] } blob so a single round-trip
 * keeps the two in sync. Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("earths");
