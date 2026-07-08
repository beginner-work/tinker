/* GET /api/stakes/wallet
 *
 * Authorization: Bearer <stytch session_token>
 *
 * GET → { balanceCents, currency, seededAt, stakes: [{ id, founderId,
 *         amountCents, at }] }
 *
 * The member's staking wallet. First touch seeds the Phase A practice
 * balance (see api/_lib/stakes.js); after that it round-trips the
 * ledger. Auth: Stytch session token, same as every user-data endpoint.
 */

"use strict";

const { resolveUserId } = require("../_lib/user-data.js");
const { withResponseLogging } = require("../_lib/log.js");
const { getWallet } = require("../_lib/stakes.js");

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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
    res.status(200).json(await getWallet(userId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
