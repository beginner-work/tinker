/**
 * Baseline at scale: every flag decision makes a network call to a stub
 * "Optimizely CDN / decide API". That latency multiplies under k6 and is
 * hostile to edge runtimes.
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 3071);
const CDN_PORT = Number(process.env.CDN_PORT || 3070);
const CDN_DELAY_MS = Number(process.env.CDN_DELAY_MS || 40);

// Stub remote decide API (simulates Optimizely network hop).
http
  .createServer(async (req, res) => {
    await new Promise((r) => setTimeout(r, CDN_DELAY_MS));
    if (!req.url?.startsWith("/v1/decide")) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const url = new URL(req.url, "http://cdn");
    const userId = url.searchParams.get("userId") || "anon";
    // Stable but remote: hash user id into two buckets.
    let h = 0;
    for (let i = 0; i < userId.length; i += 1) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
    const variation = h % 100 < 50 ? "checklist_v1" : "checklist_v2";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ variationKey: variation, source: "network" }));
  })
  .listen(CDN_PORT, () => {
    console.log(`stub Optimizely CDN on ${CDN_PORT} delay=${CDN_DELAY_MS}ms`);
  });

http
  .createServer(async (req, res) => {
    try {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, mode: "baseline" }));
        return;
      }
      if (req.url?.startsWith("/decide")) {
        const url = new URL(req.url, "http://local");
        const userId = url.searchParams.get("userId") || "anon";
        const t0 = performance.now();
        const remote = await fetch(
          `http://127.0.0.1:${CDN_PORT}/v1/decide?userId=${encodeURIComponent(userId)}`
        );
        const body = await remote.json();
        const ms = performance.now() - t0;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...body, decide_ms: +ms.toFixed(2) }));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
  })
  .listen(PORT, () => {
    console.log(`baseline decide API on ${PORT} (network call per decision)`);
  });
