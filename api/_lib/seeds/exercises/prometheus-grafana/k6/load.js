import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const TARGET = __ENV.TARGET || "http://127.0.0.1:5091";
const series = new Trend("reported_series", true);

export const options = {
  stages: [
    { duration: "10s", target: 40 },
    { duration: "20s", target: 120 },
    { duration: "10s", target: 0 },
  ],
};

export default function () {
  const userId = Math.floor(Math.random() * 50000);
  const res = http.get(`${TARGET}/checkout?user_id=${userId}`);
  check(res, { "status ok-ish": (r) => r.status === 200 || r.status === 500 });
  try {
    const body = res.json();
    if (typeof body.series === "number") series.add(body.series);
  } catch {
    /* ignore */
  }
  sleep(0.02);
}

export function handleSummary(data) {
  const out = {
    target: TARGET,
    http_req_duration: data.metrics.http_req_duration?.values || {},
    reported_series: data.metrics.reported_series?.values || {},
  };
  return {
    stdout: JSON.stringify(out, null, 2) + "\n",
    "k6-summary.json": JSON.stringify(out, null, 2),
  };
}
