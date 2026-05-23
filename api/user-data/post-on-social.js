/* GET/PUT /api/user-data/post-on-social
 *
 * GET  → { data: <verdicts-by-essay-and-platform object> | null, updatedAt }
 * PUT  body { data } → { ok: true, updatedAt }
 *
 * Whole-object semantics: the client owns the inner shape. Verdicts are
 * keyed by `${essayId}::${platform}` → { score, reason, reader_question,
 * scorer_model, ts }. Replaced on every save.
 * Auth: Stytch session token.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("post-on-social");
