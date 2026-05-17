/* POST /api/auth/phone/verify
 *
 * Body: { phone_id, pin }   (the renderer also accepts legacy `code` alias)
 * Reply: { token, isNew }
 *
 * Authenticates the PIN against Stytch and returns the Stytch
 * `session_token` (30-day, opaque). The renderer stores it under
 * tinker_jwt and sends it as a Bearer token to /api/claude/* and
 * /api/search; the server re-validates it on every call via Stytch's
 * /sessions/authenticate. Previously we returned the `session_jwt`,
 * which expired after 5 minutes and would log the user out the next
 * time they reloaded the page (most visibly after clicking the
 * Update banner).
 *
 * `isNew` is best-effort — Stytch's authenticate response doesn't
 * directly say "first time", so we infer from the user's created_at
 * timestamp.
 */

"use strict";

const { authenticateOtp } = require("../../_lib/stytch.js");
const { withResponseLogging } = require("../../_lib/log.js");

function looksFreshlyCreated(stytchUser) {
  if (!stytchUser || typeof stytchUser.created_at !== "string") return false;
  const createdAt = Date.parse(stytchUser.created_at);
  if (Number.isNaN(createdAt)) return false;
  // If the user record was created in the last two minutes, treat this
  // verify as a signup. Anything older is a returning login.
  return Date.now() - createdAt < 2 * 60 * 1000;
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body = req.body;
  if (!body || typeof body !== "object") {
    try {
      body = JSON.parse(typeof body === "string" ? body : "{}");
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
  }

  const phoneId = body && body.phone_id;
  const pin = body && (body.pin || body.code);

  try {
    const stytch = await authenticateOtp(phoneId, pin);
    if (!stytch.session_token) {
      res.status(502).json({ error: "Stytch returned no session token." });
      return;
    }
    res.status(200).json({
      token: stytch.session_token,
      isNew: looksFreshlyCreated(stytch.user),
    });
  } catch (err) {
    const status = err.status && err.status >= 400 ? err.status : 502;
    res.status(status).json({ error: err.message || "Stytch verify failed" });
  }
});
