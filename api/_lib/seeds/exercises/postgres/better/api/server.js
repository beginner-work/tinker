/**
 * Better at scale:
 * - writes / admin through PgBouncer (transaction pooling)
 * - reads from the replica
 * - queries partitioned events_part (prunes old partitions)
 */
import http from "node:http";
import pg from "pg";

const PORT = Number(process.env.PORT || 5402);
const WRITE_URL =
  process.env.PGBOUNCER_URL ||
  "postgres://exercise:exercise@127.0.0.1:6432/events";
const READ_URL =
  process.env.REPLICA_URL ||
  "postgres://exercise:exercise@127.0.0.1:5434/events";

const writePool = new pg.Pool({
  connectionString: WRITE_URL,
  max: 20,
});
const readPool = new pg.Pool({
  connectionString: READ_URL,
  max: 20,
});

async function readEvents(userId) {
  const { rows } = await readPool.query(
    `SELECT user_id, COUNT(*)::int AS n
     FROM events_part
     WHERE user_id = $1
       AND created_at >= '2024-06-01'
       AND created_at < '2024-10-01'
     GROUP BY user_id`,
    [userId]
  );
  return rows[0] || { user_id: userId, n: 0 };
}

async function explainRead(userId) {
  const { rows } = await readPool.query(
    `EXPLAIN (FORMAT TEXT)
     SELECT user_id, COUNT(*)::int AS n
     FROM events_part
     WHERE user_id = $1
       AND created_at >= '2024-06-01'
       AND created_at < '2024-10-01'
     GROUP BY user_id`,
    [userId]
  );
  return rows.map((r) => r["QUERY PLAN"]);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      await writePool.query("SELECT 1");
      await readPool.query("SELECT 1");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          mode: "better",
          write: "pgbouncer",
          read: "replica",
          table: "events_part",
        })
      );
      return;
    }
    if (req.url?.startsWith("/events")) {
      const url = new URL(req.url, "http://local");
      const userId = Number(url.searchParams.get("user_id") || 42);
      if (url.searchParams.get("explain") === "1") {
        const plan = await explainRead(userId);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ plan }));
        return;
      }
      const body = await readEvents(userId);
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
    `better listening on ${PORT} (PgBouncer writes, replica reads, partitioned)`
  );
});
