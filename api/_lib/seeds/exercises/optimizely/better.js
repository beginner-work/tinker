/**
 * Better: local Optimizely-shaped datafile evaluation. No network hop.
 */

export const datafile = {
  experiments: {
    onboarding_checklist_experiment: {
      variations: ["checklist_v1", "checklist_v2"],
      // endOfRange style 50/50 split
      traffic: [50, 50],
    },
  },
};

function bucket(userId, flagKey) {
  let h = 0;
  const s = String(flagKey) + ":" + String(userId);
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 100;
}

export function decide(userId) {
  const t0 = performance.now();
  const exp = datafile.experiments.onboarding_checklist_experiment;
  const b = bucket(userId, "onboarding_checklist_experiment");
  const variationKey = b < exp.traffic[0] ? exp.variations[0] : exp.variations[1];
  return {
    variationKey,
    source: "local_datafile",
    decide_ms: performance.now() - t0,
  };
}

export async function runLoad(n = 80) {
  const t0 = performance.now();
  const results = Array.from({ length: n }, (_, i) => decide("user_" + i));
  const ms = results.map((r) => r.decide_ms).sort((a, b) => a - b);
  return {
    mode: "better",
    n,
    total_ms: performance.now() - t0,
    p95_ms: ms[Math.floor(ms.length * 0.95)],
    sample: [decide("user_1"), decide("user_1"), decide("user_2")],
  };
}
