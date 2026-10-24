/**
 * Better at scale: queue with concurrency, rate limit, and response cache.
 */
import http from "node:http";
import { runAgent } from "./agent.js";
import { createQueue } from "./queue/worker.js";

const PORT = Number(process.env.PORT || 3082);
const queue = createQueue({ concurrency: 4, minIntervalMs: 20, cacheTtlMs: 15_000 });

const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: "better", queue: queue.stats() }));
    return;
  }
  if (req.url === "/agent" && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const prompt = body.prompt || "status of ord_100";
    const t0 = performance.now();
    try {
      const result = await queue.enqueue(prompt, () => runAgent(prompt));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ...result,
          wait_ms: +(performance.now() - t0).toFixed(2),
          mode: "queued",
          queue: queue.stats(),
        })
      );
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`better agent on ${PORT} (queue + rate limit + cache + MCP SDK)`);
});
