/* Thin Stytch REST client for the tinker auth flow.
 *
 * Reads STYTCH_PROJECT_ID + STYTCH_SECRET from Vercel env. Project ID prefix
 * (`project-test-*` vs `project-live-*`) decides the API base — test creds
 * route to test.stytch.com, live creds route to api.stytch.com. This is the
 * same behaviour the Stytch SDKs implement; doing it explicitly here keeps
 * us dependency-free.
 *
 * Only the two endpoints we actually use: SMS OTP login_or_create, and
 * authenticate. Everything else (passwords, magic links, oauth) is out of
 * scope for the phone-gated PWA.
 */

"use strict";

function readEnv() {
  const projectId = process.env.STYTCH_PROJECT_ID;
  const secret = process.env.STYTCH_SECRET;
  if (!projectId || !secret) {
    throw Object.assign(
      new Error("Stytch is not configured on this deployment."),
      { status: 503 },
    );
  }
  return { projectId, secret };
}

function baseUrlFor(projectId) {
  return projectId.startsWith("project-test-")
    ? "https://test.stytch.com"
    : "https://api.stytch.com";
}

async function stytchPost(path, body) {
  const { projectId, secret } = readEnv();
  const url = baseUrlFor(projectId) + path;
  const auth = Buffer.from(`${projectId}:${secret}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const message =
      (payload && (payload.error_message || payload.error_type)) ||
      `Stytch ${res.status}`;
    throw Object.assign(new Error(message), {
      status: res.status,
      stytchType: payload && payload.error_type,
    });
  }

  return payload || {};
}

// Normalise a 10-digit US phone to E.164. Stytch requires E.164; the
// renderer ships a 10-digit string after stripping formatting.
function toE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw Object.assign(new Error("Enter a 10-digit US phone number."), {
    status: 400,
  });
}

async function sendSmsOtp(phone) {
  return stytchPost("/v1/otps/sms/login_or_create", {
    phone_number: toE164(phone),
    expiration_minutes: 10,
  });
}

async function authenticateOtp(phoneId, code) {
  if (!phoneId || typeof phoneId !== "string") {
    throw Object.assign(new Error("phone_id is required."), { status: 400 });
  }
  if (!/^\d{6}$/.test(String(code || ""))) {
    throw Object.assign(new Error("Enter the 6-digit code you received."), {
      status: 400,
    });
  }
  // 30 days — long-lived enough for a personal writing tool, short enough
  // that an abandoned device eventually drops out. Adjust here if needed.
  return stytchPost("/v1/otps/authenticate", {
    method_id: phoneId,
    code,
    session_duration_minutes: 60 * 24 * 30,
  });
}

module.exports = { readEnv, baseUrlFor, sendSmsOtp, authenticateOtp };
