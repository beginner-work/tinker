/* GET /api/me
 *
 * The authenticated founder's own identity — just their Stytch user id,
 * resolved from the session token. The client needs this to tag a Stripe
 * Checkout Session with the founder (so beginner's webhook can write the
 * resulting subscription tier back under the right user). The id is not a
 * secret — it already rides in public reader URLs (/daily/?u=<userId>).
 *
 * Auth: Stytch session token (Bearer), same as /api/user-data/*.
 *
 * Reply (200): { userId }
 */

"use strict";

const { resolveUserId } = require("./_lib/user-data.js");
const { withResponseLogging } = require("./_lib/log.js");

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

  res.status(200).json({ userId });
});
