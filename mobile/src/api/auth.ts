/* Phone/PIN sign-in — same two-step Stytch SMS OTP as src/renderer/auth.js. */

import { api } from "./client";

export async function requestPin(
  phone: string,
): Promise<{ phoneId: string; isNew: boolean }> {
  const r = await api<{ phone_id: string; isNew: boolean }>(
    "/api/auth/phone/request",
    { method: "POST", body: { phone }, auth: false },
  );
  return { phoneId: r.phone_id, isNew: r.isNew };
}

export async function verifyPin(
  phoneId: string,
  pin: string,
): Promise<{ token: string; isNew: boolean }> {
  return api<{ token: string; isNew: boolean }>("/api/auth/phone/verify", {
    method: "POST",
    body: { phone_id: phoneId, pin },
    auth: false,
  });
}
