/**
 * Baseline: every flag decision makes a fake network call to a stub CDN.
 * Hostile to edge runtimes. No Optimizely account.
 */

const CDN_DELAY_MS = 40;

async function remoteDecide(userId) {
  await sleep(CDN_DELAY_MS);
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return {
    variationKey: h % 100 < 50 ? "checklist_v1" : "checklist_v2",
    source: "network",
  };
}

export async function decide(userId) {
  const t0 = performance.now();
  const body = await remoteDecide(String(userId));
  return { ...body, decide_ms: performance.now() - t0 };
}

export async function runLoad(n = 80) {
  const t0 = performance.now();
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => decide("user_" + i))
  );
  const ms = results.map((r) => r.decide_ms).sort((a, b) => a - b);
  return {
    mode: "baseline",
    n,
    total_ms: performance.now() - t0,
    p95_ms: ms[Math.floor(ms.length * 0.95)],
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
