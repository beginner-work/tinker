/* LaunchDarkly Edge SDK + Vercel Edge Config wrapper for the
 * signup-enabled gate.
 *
 * How this differs from the Node SDK approach:
 *   - Flag state lives in Vercel Edge Config (a KV store at the edge).
 *     The LD ↔ Vercel integration writes flag changes there
 *     automatically. Reads are sub-millisecond.
 *   - No streaming connection from the function to LD — eliminates
 *     cold-start latency, eliminates the "function dies before
 *     init finishes" failure mode.
 *   - Eval events still flush to LD's Insights, but via Vercel's
 *     waitUntil() so they run AFTER the response goes back to the
 *     user. The verify endpoint returns at full speed; the events
 *     trickle out behind it.
 *
 * Required env vars (Vercel → Project Settings → Environment Variables):
 *   - EDGE_CONFIG                  (auto-set by Vercel when an Edge
 *                                   Config is linked to the project)
 *   - LAUNCHDARKLY_CLIENT_SIDE_ID  (paste the 24-char hex from LD →
 *                                   Account Settings → Projects →
 *                                   your env → Client-side IDs;
 *                                   different rows for Preview vs
 *                                   Production)
 *
 * The flag (signup-enabled) must be marked "Available on client-side
 * SDKs" in LD for the Edge SDK to read it. That checkbox is already
 * on per the LD dashboard.
 */

"use strict";

let LD, edgeConfig, waitUntil;
let loadError = null;

try {
  LD = require("@launchdarkly/vercel-server-sdk");
  edgeConfig = require("@vercel/edge-config");
  // @vercel/functions is optional — if absent we fall back to a
  // capped inline await for the flush.
  try { waitUntil = require("@vercel/functions").waitUntil; } catch { waitUntil = null; }
} catch (err) {
  loadError = err && err.message;
  console.error("[launchdarkly] Edge SDK require failed:", loadError);
}

let clientPromise = null;

function getClient() {
  if (clientPromise) return clientPromise;
  if (!LD || !edgeConfig) {
    clientPromise = Promise.resolve(null);
    return clientPromise;
  }
  const clientSideId = process.env.LAUNCHDARKLY_CLIENT_SIDE_ID;
  const edgeConfigConnection = process.env.EDGE_CONFIG;
  if (!clientSideId || !edgeConfigConnection) {
    clientPromise = Promise.resolve(null);
    return clientPromise;
  }
  const edgeClient = edgeConfig.createClient(edgeConfigConnection);
  const c = LD.init(clientSideId, edgeClient);
  clientPromise = c.waitForInitialization()
    .then(() => c)
    .catch((err) => {
      console.error("[launchdarkly] Edge SDK init failed:", err && err.message);
      clientPromise = null;
      return null;
    });
  return clientPromise;
}

async function canSignUp(stytchUserId, phone) {
  const haveCsid = !!process.env.LAUNCHDARKLY_CLIENT_SIDE_ID;
  const haveEdge = !!process.env.EDGE_CONFIG;
  console.log("[launchdarkly] canSignUp", JSON.stringify({
    phone: phone || null,
    userId: stytchUserId || null,
    haveCsid,
    haveEdge,
    sdkLoaded: !!LD,
    loadError,
  }));

  // Fail open during transition / if Edge Config isn't linked yet.
  // Once both env vars are set on Vercel, this branch stops firing.
  if (!haveCsid || !haveEdge) {
    console.log("[launchdarkly] fail-open: Edge Config or client-side ID not visible to the function");
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

    // Flush analytics events. With Vercel's waitUntil() this runs
    // AFTER the response returns — zero user-visible latency. Fallback
    // path (no @vercel/functions installed) awaits inline with a 1.5s
    // ceiling so a slow LD events endpoint doesn't hold the verify
    // request open.
    const flushPromise = client.flush().catch((e) =>
      console.error("[launchdarkly] flush failed:", e && e.message)
    );
    if (waitUntil) {
      waitUntil(flushPromise);
    } else {
      await Promise.race([
        flushPromise,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    return !!allowed;
  } catch (err) {
    console.error("[launchdarkly] evaluation threw:", err && err.message);
    return false;
  }
}

module.exports = { canSignUp };
