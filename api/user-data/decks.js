/* GET/PUT /api/user-data/decks
 *
 * GET  → { data: { decks: { ... }, activeId, _meta } | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * The v0.103 multi-deck state. Each user has one row keyed by
 * (userId, "decks"); the inner blob holds the founder's decks
 * (default + any paid additions), the active deck id, and per-deck
 * trees + sourceContext.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("decks");
