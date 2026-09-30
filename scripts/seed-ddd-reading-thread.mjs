#!/usr/bin/env node
/* Post-merge only: seed Tyler's Domain-Driven Design reading thread via MCP.
 *
 * Do NOT run against production until the reading-thread PR is merged and
 * /api/version shows the deploy. Creates a generic reading thread through
 * create_reading_thread (no DDD-specific app code).
 *
 * Usage (after merge, with a real mcp_ credential for Tyler):
 *   MCP_URL=https://tinker.beginner.work/api/mcp \
 *   MCP_TOKEN=mcp_… \
 *   node scripts/seed-ddd-reading-thread.mjs
 *
 * Suggested section order: Part I ch 1–3, then ch 14 (bounded contexts),
 * then the rest of Evans.
 */

const SECTIONS = [
  "Part I — Chapter 1: Crunching Knowledge",
  "Part I — Chapter 2: Communication and the Use of Language",
  "Part I — Chapter 3: Binding Model and Implementation",
  "Chapter 14: Maintaining Model Integrity (Bounded Contexts)",
  "Chapter 4: Isolating the Domain",
  "Chapter 5: A Model Expressed in Software",
  "Chapter 6: The Lifecycle of a Domain Object",
  "Chapter 7: Using the Language: An Extended Example",
  "Chapter 8: Breakthrough",
  "Chapter 9: Making Implicit Concepts Explicit",
  "Chapter 10: Supple Design",
  "Chapter 11: Applying Analysis Patterns",
  "Chapter 12: Relating Design Patterns to the Model",
  "Chapter 13: Refactoring Toward Deeper Insight",
  "Chapter 15: Distillation",
  "Chapter 16: Large-Scale Structure",
  "Chapter 17: Bringing the Strategy Together",
];

const url = process.env.MCP_URL || "https://tinker.beginner.work/api/mcp";
const token = process.env.MCP_TOKEN || "";

if (!token.startsWith("mcp_")) {
  console.error("Set MCP_TOKEN to a real mcp_ credential. Refusing to run.");
  process.exit(1);
}

const body = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "create_reading_thread",
    arguments: {
      title: "Domain-Driven Design",
      author: "Eric Evans",
      sections: SECTIONS,
    },
  },
};

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify({ status: res.status, body: json }, null, 2));
if (!res.ok || (json && json.result && json.result.isError)) process.exit(1);
