#!/usr/bin/env node
/* Fill missing autonomy Edge Config items.
 *
 * Safe to run more than once. An item that is already present is left
 * alone, including a value Tyler has changed. Only linkedin_profile_edits
 * is seeded autonomous. Requires EDGE_CONFIG, EDGE_CONFIG_ID, and
 * EDGE_CONFIG_WRITE_TOKEN. VERCEL_TEAM_ID is optional.
 */

"use strict";

const { getAll } = require("@vercel/edge-config");
const { AUTONOMY_ITEMS } = require("../api/_lib/autonomy.js");
const { edgeKey, upsertEdgeItem } = require("../api/_lib/autonomy-edge.js");

function seedValue(key) {
  return {
    autonomous: key === "linkedin_profile_edits",
    note: "",
    updated_by: null,
    updated_at: null,
  };
}

async function seedMissing(deps = {}) {
  const read = deps.getAll || getAll;
  const write = deps.upsert || upsertEdgeItem;
  const names = AUTONOMY_ITEMS.map((item) => edgeKey(item.key));
  const current = await read(names);
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error("Could not read Edge Config.");
  }
  const written = [];
  for (const item of AUTONOMY_ITEMS) {
    const name = edgeKey(item.key);
    if (Object.prototype.hasOwnProperty.call(current, name) && current[name] != null) {
      continue;
    }
    await write(name, seedValue(item.key));
    written.push(name);
  }
  return written;
}

function scrub(message) {
  const token = String(process.env.EDGE_CONFIG_WRITE_TOKEN || "");
  let text = message || "Seed failed.";
  if (token && text.includes(token)) text = text.split(token).join("[redacted]");
  return text;
}

async function main() {
  const missing = ["EDGE_CONFIG", "EDGE_CONFIG_ID", "EDGE_CONFIG_WRITE_TOKEN"].filter(
    (name) => !String(process.env[name] || "").trim(),
  );
  if (missing.length) {
    console.error("Missing " + missing.join(", "));
    process.exitCode = 1;
    return;
  }
  const written = await seedMissing();
  if (!written.length) {
    console.log("Every autonomy item is already in Edge Config.");
    return;
  }
  console.log("Seeded " + written.join(", "));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(scrub(err && err.message));
    process.exitCode = 1;
  });
}

module.exports = { seedMissing, seedValue };
