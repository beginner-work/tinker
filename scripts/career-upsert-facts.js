#!/usr/bin/env node
/* Upsert career facts into Redis for one user.
 *
 * Reads a JSON payload from stdin or --file. Does not embed owner
 * data. Env needs KV_REST_API_URL and KV_REST_API_TOKEN.
 *
 * Payload:
 *   { "userId": "...", "facts": [ ...employment or other facts ] }
 * or with --owner-lindow-labs, resolve userId from TargetCompany
 * "Lindow Labs" via DATABASE_URL.
 *
 * Example:
 *   cat payload.json | node scripts/career-upsert-facts.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

function readArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function resolveLindowOwner() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL is required to resolve the Lindow Labs owner.");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const row = await prisma.targetCompany.findFirst({
      where: { name: { equals: "Lindow Labs", mode: "insensitive" } },
      select: { userId: true, name: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!row || !row.userId) throw new Error("No TargetCompany named Lindow Labs.");
    return row.userId;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const file = readArg("--file");
  const raw = file
    ? fs.readFileSync(path.resolve(file), "utf8")
    : await readStdin();
  if (!String(raw || "").trim()) {
    throw new Error("Pass a JSON payload on stdin or with --file.");
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("Payload must be JSON.");
  }
  let userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (!userId && hasFlag("--owner-lindow-labs")) {
    userId = await resolveLindowOwner();
  }
  if (!userId) throw new Error("userId is required (or pass --owner-lindow-labs).");
  const facts = Array.isArray(payload.facts) ? payload.facts : null;
  if (!facts || !facts.length) throw new Error("facts must be a non-empty array.");

  if (!String(process.env.KV_REST_API_URL || "").trim() || !String(process.env.KV_REST_API_TOKEN || "").trim()) {
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are required.");
  }

  const career = require("../api/_lib/career.js");
  const record = await career.upsertFactsForUser(userId, facts);
  const employment = (record.facts || []).filter((fact) => fact.kind === "employment");
  process.stdout.write(JSON.stringify({
    ok: true,
    userId,
    fact_count: record.facts.length,
    rule_count: record.rules.length,
    employment_ids: employment.map((fact) => fact.id),
  }) + "\n");
}

main().catch((err) => {
  process.stderr.write((err && err.message ? err.message : String(err)) + "\n");
  process.exit(1);
});
