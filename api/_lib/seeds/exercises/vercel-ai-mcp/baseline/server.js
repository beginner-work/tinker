/**
 * Baseline at scale: AI SDK-shaped agent with MCP tools, but a global mutex
 * so only one request runs at a time. Under k6, wait time explodes.
 */
import http from "node:http";
import { runAgent } from "./agent.js";

const PORT = Number(process.env.PORT || 3081);
let busy = Promise.resolve();
let inflight = 0;
let completed = 0;

function enqueue(work) {
  const run = busy.then(async () => {
    inflight += 1;
    try {
      return await work();
    } finally {
      inflight -= 1;
      completed += 1;
    }
  });
  // Keep the chain alive even if a job fails.
  busy = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: "baseline", inflight, completed }));
    return;
  }
  if (req.url === "/agent" && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const t0 = performance.now();
    try {
      const result = await enqueue(() => runAgent(body.prompt || "status of ord_100"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ...result,
          wait_ms: +(performance.now() - t0).toFixed(2),
          mode: "serial",
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
  console.log(`baseline agent on ${PORT} (one request at a time)`);
});
