import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const TARGET = __ENV.TARGET || "http://127.0.0.1:5201";
const HOT_ID = __ENV.HOT_ID || "1";
const latency = new Trend("product_ms", true);

export const options = {
  stages: [
    { duration: "8s", target: 20 },
    { duration: "20s", target: 80 },
    { duration: "8s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  // 70% traffic on the hot key to provoke stampedes in baseline.
  const id = Math.random() < 0.7 ? HOT_ID : String(Math.floor(Math.random() * 200) + 1);
  const res = http.get(`${TARGET}/products/${id}`);
  check(res, { "200": (r) => r.status === 200 });
  try {
    const body = res.json();
    if (body && typeof body.ms === "number") latency.add(body.ms);
    else latency.add(res.timings.duration);
  } catch {
    latency.add(res.timings.duration);
  }
  sleep(0.02);
}

export function handleSummary(data) {
  const out = {
    target: TARGET,
    http_req_duration: data.metrics.http_req_duration?.values || {},
    product_ms: data.metrics.product_ms?.values || {},
  };
  return {
    stdout: JSON.stringify(out, null, 2) + "\n",
    "k6-summary.json": JSON.stringify(out, null, 2),
  };
}
