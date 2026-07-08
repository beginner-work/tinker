/* POST /api/stakes/release
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { stakeId }
 * Reply: { ok: true,
 *          released: { id, founderId, amountCents, at },
 *          wallet:   { balanceCents, currency, seededAt, stakes } }
 *
 * Return one of the member's stakes to their balance and shrink the
 * founder coin it was backing. Only the stake's owner can release it —
 * the stake is looked up inside the caller's own wallet row.
 */

"use strict";

const { resolveUserId, readJsonBody } = require("../_lib/user-data.js");
const { withResponseLogging } = require("../_lib/log.js");
const { releaseStake } = require("../_lib/stakes.js");

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await releaseStake(userId, body && body.stakeId);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
