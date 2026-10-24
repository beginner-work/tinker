/**
 * Baseline: high-cardinality metrics (raw user_id + full path per request).
 * Fake registry only. No Prometheus server.
 */

const series = new Map();

function inc(name, labels) {
  const key = name + JSON.stringify(labels);
  series.set(key, (series.get(key) || 0) + 1);
}

export function reset() {
  series.clear();
}

export function handleCheckout(userId) {
  const path = "/checkout?user_id=" + userId;
  const fail = userId % 17 === 0;
  inc("http_requests_total", {
    path,
    user_id: String(userId),
    status: fail ? "500" : "200",
  });
  return { ok: !fail, series: series.size };
}

export function runLoad(n = 500) {
  reset();
  let failures = 0;
  for (let i = 0; i < n; i += 1) {
    const r = handleCheckout(i);
    if (!r.ok) failures += 1;
  }
  return { mode: "baseline", n, failures, series: series.size };
}
