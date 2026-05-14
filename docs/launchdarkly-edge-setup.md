# LaunchDarkly + Vercel Edge Config setup

> **Status:** Future migration. This PR keeps the Node SDK approach
> (with `await client.flush()` workaround for the serverless flush
> race). The Edge SDK + Edge Config swap lands in a separate PR
> later, once the dashboard wiring below is done.

When the signup gate reads flags from **Vercel Edge Config** (a KV
store at the edge) instead of streaming from LaunchDarkly directly,
LD pushes flag updates into the Edge Config automatically via an
integration; the verify function reads them in sub-millisecond time
and flushes eval events through Vercel's `waitUntil` so they reach
LD's Insights tab without holding up the response.

Three dashboard steps and two env vars to wire it up. The code side
is already on the branch (see `api/_lib/launchdarkly.js`).

## 1. Create the Edge Config in Vercel

1. Vercel dashboard → **Storage** tab → **Create** → **Edge Config**.
2. Name: `launchdarkly-flags` (or anything; the name doesn't matter
   for the integration).
3. After creation, on the Edge Config's page click **Projects** →
   **Connect Project** → pick the `tinker` project.
   This auto-sets the `EDGE_CONFIG` environment variable on every
   scope (Development / Preview / Production). You don't add this
   var by hand.

## 2. Install the LaunchDarkly integration on Vercel

1. Vercel → **Integrations** marketplace → search **LaunchDarkly** →
   **Add Integration**.
2. Walk through the OAuth flow to connect your LD account.
3. In the integration's configuration screen, map:
   - **Vercel project** → `tinker`
   - **LaunchDarkly project** → `Tyler's Account`
   - **LaunchDarkly environment** → `Test`
   - **Edge Config** → `launchdarkly-flags`
4. Save. LD writes the current flag config to the Edge Config and
   keeps it in sync on every flag change.
5. Run the integration a **second time** to map the **Production**
   LaunchDarkly environment to the same Edge Config — or to a
   separate one if you want full isolation. (Most teams use one Edge
   Config with the LD env taking care of separation.)

## 3. Add `LAUNCHDARKLY_CLIENT_SIDE_ID` to Vercel env vars

The Edge SDK auths with the **Client-side ID**, not the SDK key. You
already have this — it's the 24-char hex from your earlier screenshot:
`69fa8017cc2d280a7a8c85fe`.

1. LaunchDarkly → **Account settings** → **Projects** → your project
   → **Test** environment → **Client-side IDs** → copy the hex.
2. Vercel → Project Settings → **Environment Variables** → **Add**:
   - Name: `LAUNCHDARKLY_CLIENT_SIDE_ID`
   - Value: (paste)
   - Scope: only **Preview** ticked
   - Save.
3. Repeat: same variable name, the **Production** env's client-side
   ID, scope only **Production**.

## 4. Confirm the flag is client-side eligible

LD → **Flags** → `signup-enabled` → right sidebar → **Available on
client-side SDKs** must be **On**. Per your earlier screenshot this
is already set; the Edge SDK can't read flags that aren't.

## 5. Redeploy

Push any commit (or hit **Redeploy** on the latest deployment in
Vercel) so the function picks up the new env vars. Then run a sign-up
flow. Within ~5 seconds the eval should appear under **Flags →
signup-enabled → Insights**.

## What to keep, what to drop

You can now **remove** the old `LAUNCHDARKLY_SDK_KEY` from Vercel env
vars — the Edge SDK doesn't use it. Leaving it set is harmless, but
removing it makes the wiring obvious.

## Why this is better than the Node SDK on serverless

- **No streaming connection** to maintain per cold-start. Flag reads
  are local KV lookups.
- **No init wait**. Verify returns at full speed.
- **Events flush via `waitUntil()`** which runs after the response
  goes back. No latency cost, no buffer-dies-with-the-process bug.
