/* POST /api/auth/phone/request
 *
 * Body: { phone: "5551234567" }
 * Reply: { phone_id, isNew }
 *
 * Triggers a Stytch SMS OTP and returns the phone_id the client needs
 * to pass back on verify. No allowlist gate — anyone with the URL who
 * completes phone-OTP is in. The URL is not advertised, the page is
 * noindex, and Stytch is the actual authentication boundary. If a
 * stranger ever shows up in the Stytch user list we'll hear about it
 * and add a gate then.
 */

"use strict";

const { sendSmsOtp } = require("../../_lib/stytch.js");

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
