/**
 * Seed unpartitioned events on primary (baseline) and partitioned events
 * on primary + replica (better). Keeps data volume modest but enough to hurt
 * under connection storms.
 */
import pg from "pg";

const PRIMARY =
  process.env.PRIMARY_URL ||
  "postgres://exercise:exercise@127.0.0.1:5433/events";
const REPLICA =
  process.env.REPLICA_URL ||
  "postgres://exercise:exercise@127.0.0.1:5434/events";

const USERS = 200;
const EVENTS_PER_USER = 100;

async function seedFlat(client) {
  await client.query(`
    DROP TABLE IF EXISTS events CASCADE;
    CREATE TABLE events (
      id BIGSERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      kind TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
  await insertEvents(client, "events");
  await client.query("ANALYZE events");
}

async function seedPartitioned(client) {
  await client.query(`
    DROP TABLE IF EXISTS events_part CASCADE;
    CREATE TABLE events_part (
      id BIGSERIAL,
      user_id INT NOT NULL,
      kind TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (id, created_at)
    ) PARTITION BY RANGE (created_at);

    CREATE TABLE events_part_2024_h1 PARTITION OF events_part
      FOR VALUES FROM ('2024-01-01') TO ('2024-07-01');
    CREATE TABLE events_part_2024_h2 PARTITION OF events_part
      FOR VALUES FROM ('2024-07-01') TO ('2025-01-01');
    CREATE TABLE events_part_2025_h1 PARTITION OF events_part
      FOR VALUES FROM ('2025-01-01') TO ('2025-07-01');

    CREATE INDEX events_part_user_created_idx
      ON events_part (user_id, created_at);
  `);
  await insertEvents(client, "events_part");
  await client.query("ANALYZE events_part");
}

async function insertEvents(client, table) {
  const start = Date.UTC(2024, 0, 1);
  const dayMs = 86400000;
  const kinds = ["page_view", "click", "signup", "purchase"];
  for (let u = 1; u <= USERS; u += 1) {
    const values = [];
    const params = [];
    let p = 1;
    for (let i = 0; i < EVENTS_PER_USER; i += 1) {
      const created = new Date(start + ((u * 11 + i * 5) % 400) * dayMs);
      values.push(`($${p++}, $${p++}, $${p++})`);
      params.push(u, kinds[i % kinds.length], created.toISOString());
    }
    await client.query(
      `INSERT INTO ${table} (user_id, kind, created_at) VALUES ${values.join(",")}`,
      params
    );
  }
}

async function main() {
  const primary = new pg.Client({ connectionString: PRIMARY });
  await primary.connect();
  console.log("Seeding primary (flat + partitioned)...");
  await seedFlat(primary);
  await seedPartitioned(primary);
  const { rows } = await primary.query("SELECT COUNT(*)::int AS n FROM events");
  console.log(`primary events=${rows[0].n}`);
  await primary.end();

  const replica = new pg.Client({ connectionString: REPLICA });
  await replica.connect();
  console.log("Seeding replica (read copy of partitioned table)...");
  await seedPartitioned(replica);
  const r = await replica.query("SELECT COUNT(*)::int AS n FROM events_part");
  console.log(`replica events_part=${r.rows[0].n}`);
  await replica.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
