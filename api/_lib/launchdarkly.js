/* Thin LaunchDarkly wrapper for the signup gate.
 *
 * Reads LAUNCHDARKLY_SDK_KEY from Vercel env (set per-environment so
 * Preview deployments hit the LD Test environment and Production hits
 * the LD Production environment). Exposes one helper: canSignUp().
 *
 * Behaviour:
 *  - Key not set      → returns true (fail open in dev / before the
 *                       env var is configured).
 *  - SDK eval error   → returns false (fail closed so an LD outage
 *                       doesn't accidentally bless every signup).
 *  - Normal evaluation → variation("signup-enabled", …, defaultFalse).
 *
 * Client init is lazy + memoised across warm invocations of the same
 * Vercel function instance, so cold-start pays the ~200-500ms config
 * download once, then subsequent calls are local.
 */

"use strict";

let LD;
let ldRequireError = null;
try {
  LD = require("@launchdarkly/node-server-sdk");
} catch (err) {
  LD = null;
  ldRequireError = err && err.message;
  // Surfaces in Vercel function logs on cold start if the install
  // step skipped this dependency.
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
    // Keep the in-process event buffer modest — the only thing we eval
    // is the signup gate, so we don't need a huge capacity.
    capacity: 100,
    flushInterval: 5,
  });
  clientPromise = c.waitForInitialization({ timeout: 5 })
    .then(() => c)
    .catch((err) => {
      console.error("[launchdarkly] initialisation failed:", err && err.message);
      // Reset so a later invocation can retry instead of being stuck
      // on the failed promise forever.
      clientPromise = null;
      return null;
    });
  return clientPromise;
}

async function canSignUp(stytchUserId, phone) {
  const keyPresent = !!process.env.LAUNCHDARKLY_SDK_KEY;
  const sdkLoaded = !!LD;
  // Single-line breadcrumb on every call so Vercel function logs make
  // the path obvious when debugging "why isn't my flag evaluating".
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
    return !!allowed;
  } catch (err) {
    console.error("[launchdarkly] evaluation threw:", err && err.message);
    return false;
  }
}

module.exports = { canSignUp };
