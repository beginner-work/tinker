/* POST /api/auth/phone/request
 *
 * Body: { phone: "5551234567" }
 * Reply: { phone_id, isNew }
 *
 * Triggers a Stytch SMS OTP and returns the phone_id the client needs
 * to pass back on verify. Before calling Stytch we evaluate the
 * signup-enabled LaunchDarkly flag — phones that aren't on the
 * allowlist get a 403 here BEFORE an SMS goes out, so we don't burn
 * Stytch credit on uninvited numbers and the renderer can route the
 * user to a "not on the list" view instead of advancing to the PIN
 * screen.
 *
 * 403 responses include `blocked: true` so the renderer can
 * distinguish "you're not on the list" from generic Stytch errors
 * and switch UI states accordingly.
 */

"use strict";

const { sendSmsOtp, toE164 } = require("../../_lib/stytch.js");
const { canSignUp } = require("../../_lib/launchdarkly.js");

module.exports = async function handler(req, res) {
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

  const phone = body && body.phone;
  if (typeof phone !== "string" || !phone.trim()) {
    res.status(400).json({ error: "phone is required" });
    return;
  }

  // Normalise to E.164 BEFORE the LD check so the targeting rule
  // matches the same shape Stytch will return on verify. Reuses
  // stytch.js' toE164 helper so we have one source of truth.
  let e164;
  try {
    e164 = toE164(phone);
  } catch (err) {
    const status = err.status && err.status >= 400 ? err.status : 400;
    res.status(status).json({ error: err.message || "Invalid phone number" });
    return;
  }

  // Allowlist gate. We don't yet know the Stytch user_id (Stytch
  // hasn't been called) so the LD context key falls back to the
  // phone — same flag, same rule, evaluated against the same
  // attribute the verify endpoint will pass later.
  const allowed = await canSignUp(null, e164);
  if (!allowed) {
    res.status(403).json({
      error: "tinker is in private beta — your number isn't on the list yet. text Tyler if you'd like access.",
      blocked: true,
    });
    return;
  }

  try {
    const stytch = await sendSmsOtp(phone);
    res.status(200).json({
      phone_id: stytch.phone_id,
      isNew: Boolean(stytch.user_created),
    });
  } catch (err) {
    const status = err.status && err.status >= 400 ? err.status : 502;
    res.status(status).json({ error: err.message || "Stytch request failed" });
  }
};
