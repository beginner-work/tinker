#!/usr/bin/env node
/**
 * Mint, list, and revoke durable MCP API keys.
 *
 * Uses the same library as POST /api/mcp-keys. Requires a Stytch session
 * for the owner (the tinker_jwt from the signed-in writing app), plus
 * DATABASE_URL, STYTCH_PROJECT_ID, STYTCH_SECRET, and MCP_KEY_OWNER_USER_ID.
 *
 *   node scripts/mcp-keys.js whoami --session <tinker_jwt>
 *   node scripts/mcp-keys.js mint --label clay --session <tinker_jwt>
 *   node scripts/mcp-keys.js list --session <tinker_jwt>
 *   node scripts/mcp-keys.js revoke --id <id> --session <tinker_jwt>
 *
 * Clay header, after mint:
 *   Authorization: Bearer mcp_...
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { authenticateSession } = require("../api/_lib/stytch.js");
const {
  assertOwner,
  mintMcpKey,
  revokeMcpKey,
  listMcpKeys,
  userIdFromSession,
  ownerStatus,
} = require("../api/_lib/mcp-keys.js");

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const filePath = path.resolve(__dirname, "..", name);
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] != null) continue;
      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--session") args.session = argv[++i];
    else if (flag === "--label") args.label = argv[++i];
    else if (flag === "--id") args.id = argv[++i];
    else if (flag === "-h" || flag === "--help") args.help = true;
    else if (flag.startsWith("-")) {
      throw new Error(`Unknown argument: ${flag}`);
    } else {
      args._.push(flag);
    }
  }
  args.command = args._[0] || "";
  return args;
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  node scripts/mcp-keys.js whoami --session <tinker_jwt>",
      "  node scripts/mcp-keys.js mint --label <label> --session <tinker_jwt>",
      "  node scripts/mcp-keys.js list --session <tinker_jwt>",
      "  node scripts/mcp-keys.js revoke --id <id> --session <tinker_jwt>",
      "",
      "Session: --session, or TINKER_SESSION.",
      "Copy the session from the signed-in site:",
      '  copy(localStorage.getItem("tinker_jwt"))',
      "",
      "Env: STYTCH_PROJECT_ID, STYTCH_SECRET, DATABASE_URL, MCP_KEY_OWNER_USER_ID",
      "",
      "Clay AddMcpServer header (the mcp_ key, not the session):",
      "  Authorization: Bearer mcp_...",
    ].join("\n"),
  );
}

function iso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function requireSession(sessionToken) {
  const token = sessionToken || process.env.TINKER_SESSION || "";
  if (!token) {
    throw new Error(
      'Pass the tinker session with --session or TINKER_SESSION. Copy it from the signed-in site: copy(localStorage.getItem("tinker_jwt"))',
    );
  }
  const session = await authenticateSession(token);
  const userId = userIdFromSession(session);
  if (!userId) throw new Error("Session missing user id.");
  return userId;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  if (args.help || !args.command) {
    printHelp();
    return;
  }

  const userId = await requireSession(args.session);

  if (args.command === "whoami") {
    const status = ownerStatus(userId);
    console.log(`user_id: ${userId}`);
    console.log(`owner_configured: ${status.configured ? "yes" : "no"}`);
    console.log(`is_owner: ${status.isOwner ? "yes" : "no"}`);
    if (!status.configured) {
      console.log("");
      console.log(
        "Set MCP_KEY_OWNER_USER_ID to this user_id in Vercel (Production and Preview), then mint.",
      );
    }
    return;
  }

  assertOwner(userId);

  if (args.command === "mint") {
    const minted = await mintMcpKey({ label: args.label });
    console.log(`id: ${minted.id}`);
    console.log(`label: ${minted.label}`);
    console.log(`createdAt: ${iso(minted.createdAt)}`);
    console.log("");
    console.log("Copy this key now. It will not be shown again.");
    console.log(minted.key);
    console.log("");
    console.log("Clay AddMcpServer header:");
    console.log(`Authorization: Bearer ${minted.key}`);
    return;
  }

  if (args.command === "list") {
    const keys = await listMcpKeys();
    if (!keys.length) {
      console.log("No MCP API keys yet.");
      return;
    }
    for (const row of keys) {
      const state = row.revokedAt ? `revoked ${iso(row.revokedAt)}` : "active";
      console.log(`${row.id}\t${state}\t${iso(row.createdAt)}\t${row.label}`);
    }
    return;
  }

  if (args.command === "revoke") {
    const revoked = await revokeMcpKey(args.id);
    console.log(`id: ${revoked.id}`);
    console.log(`label: ${revoked.label}`);
    console.log(`revokedAt: ${iso(revoked.revokedAt)}`);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
