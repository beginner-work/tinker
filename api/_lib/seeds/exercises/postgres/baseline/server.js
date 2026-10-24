/**
 * Baseline at scale: open a new Postgres connection per request, query the
 * unpartitioned events table, and hold the connection until the query ends.
 * Under k6 this exhausts max_connections and starts failing.
 */
import http from "node:http";
import pg from "pg";

const PORT = Number(process.env.PORT || 5401);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://exercise:exercise@127.0.0.1:5433/events";

async function handleEvents(userId) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT user_id, COUNT(*)::int AS n
       FROM events
       WHERE user_id = $1
         AND created_at >= '2024-06-01'
         AND created_at < '2024-10-01'
       GROUP BY user_id`,
      [userId]
    );
    return rows[0] || { user_id: userId, n: 0 };
  } finally {
    await client.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, mode: "baseline" }));
      return;
    }
    if (req.url?.startsWith("/events")) {
      const url = new URL(req.url, "http://local");
      const userId = Number(url.searchParams.get("user_id") || 42);
      const body = await handleEvents(userId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (err) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "postgres_unavailable",
        message: String(err.message || err),
      })
    );
  }
});

server.listen(PORT, () => {
  console.log(
    `baseline listening on ${PORT} (direct Postgres, no pool, flat table)`
  );
});
