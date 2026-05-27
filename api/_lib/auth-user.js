/* Resolve the Stytch user_id from a request's bearer token.
 *
 * Same pattern as api/_lib/user-data.js, factored out so both
 * /api/checkout/preseed and /api/user-data/* can share it without
 * importing user-data's makeHandler factory.
 */

"use strict";

const { authenticateSession } = require("./stytch.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

async function resolveUserId(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  const session = await authenticateSession(token);
  const userId =
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    "";
  if (!userId) {
    throw Object.assign(new Error("Session missing user id"), { status: 401 });
  }
  return userId;
}

module.exports = { resolveUserId, extractBearer };
