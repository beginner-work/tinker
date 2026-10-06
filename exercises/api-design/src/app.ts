import Fastify, { type FastifyInstance } from "fastify";
import { paymentsRoutes } from "./payments";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(paymentsRoutes);
  return app;
}
