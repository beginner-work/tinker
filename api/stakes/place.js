/* POST /api/stakes/place
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { founderId, amountCents }
 * Reply: { ok: true,
 *          stake:  { id, founderId, amountCents, at },
 *          wallet: { balanceCents, currency, seededAt, stakes },
 *          coin:   { founderId, symbol, totalStakedCents, backerCount,
 *                    myStakeCents } }
 *
 * Move part of the member's staking balance onto another founder's
 * coin. Validation (positive integer cents, per-stake cap, no
 * self-staking, founder must exist) and the two-row ledger move live in
 * api/_lib/stakes.js.
 */

"use strict";

const { resolveUserId, readJsonBody } = require("../_lib/user-data.js");
const { withResponseLogging } = require("../_lib/log.js");
const { placeStake } = require("../_lib/stakes.js");

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
    const result = await placeStake(
      userId,
      body && body.founderId,
      body && body.amountCents,
    );
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
