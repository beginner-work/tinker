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
try { LD = require("@launchdarkly/node-server-sdk"); } catch { LD = null; }

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
  if (!process.env.LAUNCHDARKLY_SDK_KEY) {
    // Not wired yet — let signups through so local + early-preview
    // dev works without LD configured. Once the env var is set on
    // Preview / Production, this branch stops firing.
    return true;
  }
  const client = await getClient();
  if (!client) return false; // SDK missing or init failed → fail closed
  try {
    const ctx = {
      kind: "user",
      key: String(stytchUserId || phone || "anonymous"),
    };
    if (phone) ctx.phone = phone;
    const allowed = await client.variation("signup-enabled", ctx, false);
    return !!allowed;
  } catch (err) {
    console.error("[launchdarkly] evaluation failed:", err && err.message);
    return false;
  }
}

module.exports = { canSignUp };
