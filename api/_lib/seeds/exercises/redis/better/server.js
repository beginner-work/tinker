/**
 * Better at scale: Redis cache-aside, TTL, invalidate-on-write,
 * stampede protection on hot keys.
 */
import http from "node:http";
import pg from "pg";
import Redis from "ioredis";
import { createCache } from "./cache.js";

const PORT = Number(process.env.PORT || 5202);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://exercise:exercise@127.0.0.1:5435/catalog";
const CACHE_ADDR = process.env.CACHE_ADDR || "redis://127.0.0.1:6379";
const QUERY_DELAY_MS = Number(process.env.QUERY_DELAY_MS || 50);

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
const redis = new Redis(CACHE_ADDR, { maxRetriesPerRequest: 1 });
const cache = createCache(redis, { ttlSeconds: 30, lockTtlMs: 2000 });
let dbQueries = 0;

async function loadProduct(id) {
  dbQueries += 1;
  await new Promise((r) => setTimeout(r, QUERY_DELAY_MS));
  const { rows } = await pool.query(
    "SELECT id, name, price_cents, inventory FROM products WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          mode: "better",
          dbQueries,
          cache: cache.stats(),
        })
      );
      return;
    }
    if (req.url?.startsWith("/products/") && req.method === "GET") {
      const id = Number(req.url.slice("/products/".length));
      const t0 = performance.now();
      const { value, cache: cacheMode } = await cache.getOrLoad(id, loadProduct);
      if (!value) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ...value,
          cache: cacheMode,
          dbQueries,
          cacheStats: cache.stats(),
          ms: +(performance.now() - t0).toFixed(2),
        })
      );
      return;
    }
    if (req.url?.startsWith("/products/") && req.method === "POST") {
      const id = Number(req.url.slice("/products/".length));
      const body = JSON.parse((await readBody(req)) || "{}");
      await pool.query(
        "UPDATE products SET inventory = $2 WHERE id = $1",
        [id, Number(body.inventory)]
      );
      await cache.invalidate(id);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          id,
          inventory: Number(body.inventory),
          invalidated: true,
        })
      );
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

server.listen(PORT, () => {
  console.log(
    `better catalog on ${PORT} (Redis cache-aside + TTL + invalidate + stampede lock)`
  );
});
