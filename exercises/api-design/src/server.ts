import { buildApp } from "./app";

const port = Number(process.env.PORT || 3030);

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port, host: "127.0.0.1" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
