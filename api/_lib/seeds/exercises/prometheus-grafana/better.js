/**
 * Better: bounded labels (route template + status). Series count stays flat.
 */

const totals = {
  checkout: { "200": 0, "500": 0 },
  health: { "200": 0, "500": 0 },
};

export function reset() {
  for (const route of Object.keys(totals)) {
    totals[route]["200"] = 0;
    totals[route]["500"] = 0;
  }
}

export function handleCheckout(userId) {
  const fail = userId % 17 === 0;
  const status = fail ? "500" : "200";
  totals.checkout[status] += 1;
  return { ok: !fail, series: seriesCount() };
}

function seriesCount() {
  return Object.keys(totals).length * 2;
}

/** Stretch: recording-rule style success ratio over the bounded counters. */
export function successRatio() {
  const ok = totals.checkout["200"];
  const bad = totals.checkout["500"];
  const n = ok + bad;
  return n ? ok / n : 1;
}

/** Stretch: simplified fast burn check for a 99% SLO. */
export function burnAlert(slo = 0.99) {
  const ratio = successRatio();
  const burning = 1 - ratio > 14.4 * (1 - slo);
  return { ratio, burning, slo };
}

export function runLoad(n = 500) {
  reset();
  let failures = 0;
  for (let i = 0; i < n; i += 1) {
    const r = handleCheckout(i);
    if (!r.ok) failures += 1;
  }
  return {
    mode: "better",
    n,
    failures,
    series: seriesCount(),
    successRatio: successRatio(),
    burn: burnAlert(),
  };
}
