/* GET/PUT /api/user-data/tree
 *
 * GET  → { data: { [deckHeading]: [{ writingId, offset, length, addedAt }, ...] } | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * The v0.103 sidebar tree: deck heading (one of the eleven pitch-deck
 * literals) → list of verbatim phrase rows. The client computes new
 * entries by calling /api/classify on each writing-session close and
 * round-trips the updated blob through this endpoint. Whole-blob
 * semantics. Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("tree");
