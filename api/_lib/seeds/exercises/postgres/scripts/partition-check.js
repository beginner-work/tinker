import pg from "pg";

const READ_URL =
  process.env.REPLICA_URL ||
  "postgres://exercise:exercise@127.0.0.1:5434/events";

const client = new pg.Client({ connectionString: READ_URL });
await client.connect();
const { rows } = await client.query(`
  EXPLAIN (FORMAT TEXT)
  SELECT user_id, COUNT(*)::int AS n
  FROM events_part
  WHERE user_id = 42
    AND created_at >= '2024-06-01'
    AND created_at < '2024-10-01'
  GROUP BY user_id
`);
console.log(rows.map((r) => r["QUERY PLAN"]).join("\n"));
const text = rows.map((r) => r["QUERY PLAN"]).join("\n");
console.log(
  text.includes("events_part_2024_h2") || text.includes("Partition")
    ? "partition_prune=likely"
    : "partition_prune=check_plan"
);
await client.end();
