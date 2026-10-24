import http from "k6/http";
import { check, sleep } from "k6";

const TARGET = __ENV.TARGET || "http://127.0.0.1:5101";

export const options = {
  stages: [
    { duration: "8s", target: 30 },
    { duration: "15s", target: 80 },
    { duration: "8s", target: 0 },
  ],
};

export default function () {
  const id = `evt_k6_${__VU}_${__ITER}`;
  const res = http.post(
    `${TARGET}/webhook`,
    JSON.stringify({
      id,
      type: "payment_intent.succeeded",
      data: { object: { id: `pi_${__VU}_${__ITER}` } },
    }),
    { headers: { "content-type": "application/json" } }
  );
  check(res, { "accepted": (r) => r.status === 200 || r.status === 202 });
  sleep(0.02);
}

export function handleSummary(data) {
  const out = {
    target: TARGET,
    http_req_duration: data.metrics.http_req_duration?.values || {},
    http_req_failed: data.metrics.http_req_failed?.values || {},
  };
  return {
    stdout: JSON.stringify(out, null, 2) + "\n",
    "k6-summary.json": JSON.stringify(out, null, 2),
  };
}
