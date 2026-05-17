/* GET/PUT /api/user-data/themes
 *
 * Persists the latest /api/themes response so the sidebar renders the
 * same labels on every device without a recompute lag. Whole-blob
 * semantics — the client stores the validated themes array verbatim.
 * Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("themes");
