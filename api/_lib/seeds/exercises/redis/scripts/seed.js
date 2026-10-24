import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://exercise:exercise@127.0.0.1:5435/catalog";

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query(`
    DROP TABLE IF EXISTS products;
    CREATE TABLE products (
      id INT PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INT NOT NULL,
      inventory INT NOT NULL
    );
  `);
  const values = [];
  const params = [];
  let p = 1;
  for (let i = 1; i <= 200; i += 1) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(i, `Product ${i}`, 500 + i * 3, 100);
  }
  await client.query(
    `INSERT INTO products (id, name, price_cents, inventory) VALUES ${values.join(",")}`,
    params
  );
  console.log("Seeded 200 products (id=1 is the hot key).");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
