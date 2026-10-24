/**
 * Better at the edge: evaluate flags locally from a bundled datafile with
 * @optimizely/optimizely-sdk. No per-request network hop.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInstance } from "@optimizely/optimizely-sdk";

const PORT = Number(process.env.PORT || 3072);
const here = path.dirname(fileURLToPath(import.meta.url));
const datafile = JSON.parse(
  fs.readFileSync(path.join(here, "..", "lib", "datafile.json"), "utf8")
);

const optly = createInstance({
  datafile,
  datafileOptions: { autoUpdate: false },
});

function decide(userId) {
  const user = optly.createUserContext(String(userId));
  const decision = user.decide("onboarding_checklist_experiment");
  return {
    variationKey: decision.variationKey || "checklist_v1",
    source: "local_datafile",
    enabled: decision.enabled,
  };
}

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, mode: "better", edge: true }));
      return;
    }
    if (req.url?.startsWith("/decide")) {
      const url = new URL(req.url, "http://local");
      const userId = url.searchParams.get("userId") || "anon";
      const t0 = performance.now();
      const body = decide(userId);
      const ms = performance.now() - t0;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...body, decide_ms: +ms.toFixed(2) }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  })
  .listen(PORT, () => {
    console.log(
      `better decide API on ${PORT} (Optimizely local datafile, edge-friendly)`
    );
  });
