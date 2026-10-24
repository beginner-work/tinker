/**
 * Better under load: bounded label sets (route template + status class),
 * exposes ready-made counters for recording rules / burn-rate alerts.
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 5092);
let failRate = Number(process.env.FAIL_RATE || 0.01);

const totals = {
  "200": 0,
  "500": 0,
};
const byRoute = {
  checkout: { "200": 0, "500": 0 },
  health: { "200": 0, "500": 0 },
};

export function setFailRate(n) {
  failRate = n;
}

function renderMetrics() {
  const lines = [
    "# HELP http_requests_total requests by route template and status",
    "# TYPE http_requests_total counter",
  ];
  for (const [route, statuses] of Object.entries(byRoute)) {
    for (const [status, value] of Object.entries(statuses)) {
      lines.push(`http_requests_total{route="${route}",status="${status}"} ${value}`);
    }
  }
  lines.push("# HELP http_requests_by_status_total rollup without route");
  lines.push("# TYPE http_requests_by_status_total counter");
  for (const [status, value] of Object.entries(totals)) {
    lines.push(`http_requests_by_status_total{status="${status}"} ${value}`);
  }
  const series = Object.keys(byRoute).length * 2 + Object.keys(totals).length;
  lines.push("# HELP app_series_count bounded series count");
  lines.push("# TYPE app_series_count gauge");
  lines.push(`app_series_count ${series}`);
  return lines.join("\n") + "\n";
}

const server = http.createServer((req, res) => {
  if (req.url === "/metrics") {
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(renderMetrics());
    return;
  }
  if (req.url === "/health") {
    byRoute.health["200"] += 1;
    totals["200"] += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: "better", series: "bounded" }));
    return;
  }
  if (req.url?.startsWith("/checkout")) {
    const fail = Math.random() < failRate;
    const status = fail ? "500" : "200";
    byRoute.checkout[status] += 1;
    totals[status] += 1;
    if (fail) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_timeout" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

if (process.argv[1] && process.argv[1].endsWith("better/app/server.js")) {
  server.listen(PORT, () => {
    console.log(`better app on ${PORT} (bounded labels + burn-rate ready)`);
  });
}

export { server, totals, byRoute };
