import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const TARGET = __ENV.TARGET || "http://127.0.0.1:5401";
const errorRate = new Rate("errors");
const latency = new Trend("events_latency", true);

export const options = {
  stages: [
    { duration: "10s", target: 20 },
    { duration: "20s", target: 80 },
    { duration: "20s", target: 150 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    errors: ["rate<0.2"],
    events_latency: ["p(95)<500"],
  },
};

export default function () {
  const userId = Math.floor(Math.random() * 200) + 1;
  const res = http.get(`${TARGET}/events?user_id=${userId}`, {
    timeout: "3s",
  });
  const ok = check(res, { "status 200": (r) => r.status === 200 });
  errorRate.add(!ok);
  latency.add(res.timings.duration);
  sleep(0.05);
}

export function handleSummary(data) {
  const out = {
    target: TARGET,
    http_req_failed: data.metrics.http_req_failed?.values || {},
    errors: data.metrics.errors?.values || {},
    events_latency: data.metrics.events_latency?.values || {},
  };
  return {
    stdout: JSON.stringify(out, null, 2) + "\n",
    "k6-summary.json": JSON.stringify(out, null, 2),
  };
}
