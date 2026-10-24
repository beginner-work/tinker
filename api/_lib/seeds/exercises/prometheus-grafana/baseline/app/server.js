/**
 * Baseline under load: every request creates a unique time series via
 * high-cardinality labels (raw user_id + full path). k6 makes this explode.
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 5091);
let failRate = Number(process.env.FAIL_RATE || 0.01);

/** @type {Map<string, number>} */
const counters = new Map();

function inc(name, labels) {
  const key = name + JSON.stringify(labels);
  counters.set(key, (counters.get(key) || 0) + 1);
}

function renderMetrics() {
  const lines = ["# HELP http_requests_total requests", "# TYPE http_requests_total counter"];
  for (const [key, value] of counters) {
    const name = key.slice(0, key.indexOf("{") === -1 ? key.length : key.indexOf("{"));
    // key format: name{json}
    const brace = key.indexOf("{");
    if (brace === -1) {
      lines.push(`${key} ${value}`);
      continue;
    }
    const metric = key.slice(0, brace);
    const labels = JSON.parse(key.slice(brace));
    const labelText = Object.entries(labels)
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
      .join(",");
    lines.push(`${metric}{${labelText}} ${value}`);
  }
  lines.push(`# HELP app_series_count approximate in-process series`);
  lines.push(`# TYPE app_series_count gauge`);
  lines.push(`app_series_count ${counters.size}`);
  return lines.join("\n") + "\n";
}

export function setFailRate(n) {
  failRate = n;
}

const server = http.createServer((req, res) => {
  if (req.url === "/metrics") {
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(renderMetrics());
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: "baseline", series: counters.size }));
    return;
  }
  if (req.url?.startsWith("/checkout")) {
    const url = new URL(req.url, "http://local");
    const userId = url.searchParams.get("user_id") || "anon";
    // High cardinality: unbounded user_id + full path label.
    const fail = Math.random() < failRate;
    inc("http_requests_total", {
      path: req.url,
      user_id: userId,
      status: fail ? "500" : "200",
    });
    if (fail) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_timeout", series: counters.size }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, series: counters.size }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  server.listen(PORT, () => {
    console.log(`baseline app on ${PORT} (high-cardinality labels)`);
  });
}

export { server, counters };
