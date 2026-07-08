/* GET /api/stakes/coin?founder=<userId | "me">
 *
 * Authorization: Bearer <stytch session_token>
 *
 * GET → { founderId, symbol, totalStakedCents, backerCount, myStakeCents }
 *
 * Public stats for one founder's coin plus the viewer's own position on
 * it. Individual backer identities never leave the server — only the
 * count and the viewer's own stake. `founder=me` resolves to the caller,
 * so the client can show its own coin without knowing its Stytch id.
 */

"use strict";

const { resolveUserId } = require("../_lib/user-data.js");
const { withResponseLogging } = require("../_lib/log.js");
const { getCoin } = require("../_lib/stakes.js");

function founderParam(req) {
  if (req.query && typeof req.query.founder === "string") return req.query.founder;
  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get("founder") || "";
  } catch {
    return "";
  }
}

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

  let founderId = String(founderParam(req) || "").trim();
  if (founderId === "me") founderId = userId;
  if (!founderId) {
    res.status(400).json({ error: "Query must include `founder`." });
    return;
  }

  try {
    res.status(200).json(await getCoin(founderId, userId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
