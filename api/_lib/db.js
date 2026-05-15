/* Prisma singleton.
 *
 * In Vercel's Node serverless runtime, each warm function invocation
 * shares a global object. Caching the PrismaClient there keeps us from
 * exhausting Postgres connections by spawning a fresh client on every
 * cold start. Pattern from Prisma's "Best practices for using Prisma
 * Client with serverless".
 */

"use strict";

const { PrismaClient } = require("@prisma/client");

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__tinkerWebPrisma ||
  new PrismaClient({ log: ["warn", "error"] });

if (!globalForPrisma.__tinkerWebPrisma) {
  globalForPrisma.__tinkerWebPrisma = prisma;
}

module.exports = prisma;
