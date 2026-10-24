import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const TARGET = __ENV.TARGET || "http://127.0.0.1:3081";
const wait = new Trend("agent_wait_ms", true);

export const options = {
  stages: [
    { duration: "8s", target: 10 },
    { duration: "15s", target: 40 },
    { duration: "8s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.1"],
  },
};

const prompts = [
  "What is the status of order ord_100?",
  "Is ord_200 refunded already?",
  "Customer asks for a refund policy blurb",
];

export default function () {
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];
  const res = http.post(`${TARGET}/agent`, JSON.stringify({ prompt }), {
    headers: { "content-type": "application/json" },
    timeout: "30s",
  });
  check(res, { "200": (r) => r.status === 200 });
  try {
    const body = res.json();
    if (body && typeof body.wait_ms === "number") wait.add(body.wait_ms);
  } catch {
    /* ignore */
  }
  sleep(0.05);
}

export function handleSummary(data) {
  const out = {
    target: TARGET,
    http_req_duration: data.metrics.http_req_duration?.values || {},
    agent_wait_ms: data.metrics.agent_wait_ms?.values || {},
  };
  return {
    stdout: JSON.stringify(out, null, 2) + "\n",
    "k6-summary.json": JSON.stringify(out, null, 2),
  };
}
