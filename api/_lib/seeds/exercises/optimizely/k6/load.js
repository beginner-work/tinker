import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const TARGET = __ENV.TARGET || "http://127.0.0.1:3071";
const decideMs = new Trend("decide_ms", true);

export const options = {
  stages: [
    { duration: "10s", target: 30 },
    { duration: "20s", target: 100 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"],
    decide_ms: ["p(95)<80"],
  },
};

export default function () {
  const userId = `user_${Math.floor(Math.random() * 5000)}`;
  const res = http.get(`${TARGET}/decide?userId=${userId}`);
  check(res, { "200": (r) => r.status === 200 });
  try {
    const body = res.json();
    if (body && typeof body.decide_ms === "number") decideMs.add(body.decide_ms);
    else decideMs.add(res.timings.duration);
  } catch {
    decideMs.add(res.timings.duration);
  }
  sleep(0.02);
}

export function handleSummary(data) {
  const out = {
    target: TARGET,
    http_req_duration: data.metrics.http_req_duration?.values || {},
    decide_ms: data.metrics.decide_ms?.values || {},
  };
  return {
    stdout: JSON.stringify(out, null, 2) + "\n",
    "k6-summary.json": JSON.stringify(out, null, 2),
  };
}
