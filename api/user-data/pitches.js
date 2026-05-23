/* GET/PUT /api/user-data/pitches
 *
 * GET  → { data: { pitches: [...], activeId, _migratedFromTree } | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * The pitches blob: a list of full eleven-slide decks plus the
 * active selection. The renderer (src/renderer/pitches.js) owns the
 * inner shape — `aiTitle` is the model-generated label, `personalTitle`
 * is the founder's own recognition name (the one we need to persist
 * across devices), and `deck` holds verbatim phrase records per
 * heading. Whole-blob semantics. Auth: Stytch session token.
 *
 * The backend job at /api/pitches/organize owns the AI-shaped fields
 * (aiTitle, deck contents from rehoming). PUT exists so the client
 * can persist user-controlled fields between organize runs —
 * personalTitle, activeId, expanded toggles — without waiting for
 * the next organize.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("pitches");
