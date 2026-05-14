/* Thin LaunchDarkly Node SDK wrapper for the signup gate.
 *
 * Reads LAUNCHDARKLY_SDK_KEY from Vercel env (set per-environment so
 * Preview hits LD's Test env and Production hits LD's Production
 * env). Exposes one helper: canSignUp().
 *
 * Behaviour:
 *  - Key not set      → returns true (fail open in dev / before the
 *                       env var is configured).
 *  - SDK eval error   → returns false (fail closed so an LD outage
 *                       doesn't accidentally bless every signup).
 *  - Normal eval      → variation("signup-enabled", …, defaultFalse).
 *
 * Serverless flush note: Vercel functions can return + terminate
 * before the SDK's 5-second event flush interval ticks. We race
 * client.flush() against a 1.5s timeout after each eval so events
 * actually make it to LD's Insights tab without holding the verify
 * response open for long. The Edge SDK + Vercel Edge Config (see
 * docs/launchdarkly-edge-setup.md) eliminates this latency entirely
 * via waitUntil — that's the planned next migration.
 */

"use strict";

let LD;
let ldRequireError = null;
try {
  LD = require("@launchdarkly/node-server-sdk");
} catch (err) {
  LD = null;
  ldRequireError = err && err.message;
  console.error("[launchdarkly] SDK require failed:", ldRequireError);
}

let clientPromise = null;

function getClient() {
  if (clientPromise) return clientPromise;
  if (!LD) {
    clientPromise = Promise.resolve(null);
    return clientPromise;
  }
  const key = process.env.LAUNCHDARKLY_SDK_KEY;
  if (!key) {
    clientPromise = Promise.resolve(null);
    return clientPromise;
  }
  const c = LD.init(key, {
    capacity: 100,
    flushInterval: 5,
  });
  clientPromise = c.waitForInitialization({ timeout: 5 })
    .then(() => c)
    .catch((err) => {
      console.error("[launchdarkly] initialisation failed:", err && err.message);
      clientPromise = null;
      return null;
    });
  return clientPromise;
}

async function canSignUp(stytchUserId, phone) {
  const keyPresent = !!process.env.LAUNCHDARKLY_SDK_KEY;
  const sdkLoaded = !!LD;
  console.log("[launchdarkly] canSignUp", JSON.stringify({
    phone: phone || null,
    userId: stytchUserId || null,
    keyPresent,
    sdkLoaded,
    requireError: ldRequireError,
  }));

  if (!keyPresent) {
    console.log("[launchdarkly] fail-open: LAUNCHDARKLY_SDK_KEY not visible to the function");
    return true;
  }
  const client = await getClient();
  if (!client) {
    console.error("[launchdarkly] fail-closed: getClient returned null (SDK missing or init failed)");
    return false;
  }
  try {
    const ctx = {
      kind: "user",
      key: String(stytchUserId || phone || "anonymous"),
    };
    if (phone) ctx.phone = phone;
    const allowed = await client.variation("signup-enabled", ctx, false);
    console.log("[launchdarkly] evaluated signup-enabled:", { ctx, allowed });

    // Serverless flush: Vercel functions can terminate before the
    // 5s flush interval ticks, so the eval event never reaches LD's
    // Insights endpoint. Race the flush against a 1.5s ceiling so a
    // slow events server doesn't hold the user's verify response open.
    try {
      await Promise.race([
        client.flush(),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch (e) {
      console.error("[launchdarkly] flush failed:", e && e.message);
    }
    return !!allowed;
  } catch (err) {
    console.error("[launchdarkly] evaluation threw:", err && err.message);
    return false;
  }
}

module.exports = { canSignUp };
