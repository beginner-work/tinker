/* MCP context pages for business / technical goals (mocked selection). */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const ctx = require("../src/renderer/lib/mcp-context.js");
const classify = require("../src/renderer/lib/essay-classify.js");
const registry = require("../api/_lib/mcp-connectors-registry.js");
const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const connectionsHtml = fs.readFileSync(
  path.join(root, "src/renderer/connections/index.html"),
  "utf8"
);

test("normalize and indicator for business + technical pages", () => {
  const next = ctx.normalizeContext({
    business: [{ id: "b1", title: "ICP notes", snippet: "B2B founders." }],
    technical: [{ id: "t1", title: "API goals", snippet: "OpenAPI by feel." }],
  });
  assert.equal(next.business.length, 1);
  assert.equal(next.technical[0].title, "API goals");
  assert.match(ctx.indicatorLabel(next), /Business: ICP notes/);
  assert.match(ctx.indicatorLabel(next), /Technical: API goals/);
  const bizJoined = next.business
    .map((p) => p.title + "\n" + p.snippet)
    .join("");
  assert.match(bizJoined, /B2B founders/);
});

test("classify user message includes optional MCP context", () => {
  const msg = classify.buildClassifyUserMessage(
    "I am writing about payment intent error shapes and OpenAPI paths for our API.",
    {
      businessContext: "ICP: B2B founders",
      technicalGoalsContext: "Ship OpenAPI by feel",
    }
  );
  assert.match(msg, /BUSINESS_CONTEXT/);
  assert.match(msg, /TECH_CONTEXT/);
  assert.match(msg, /OpenAPI by feel/);
});

test("marketplace catalog is Notion and GitHub only", () => {
  const ids = registry.listConnectors().map((c) => c.id);
  assert.deepEqual(ids, ["notion", "github"]);
  assert.match(connectionsHtml, /plugin marketplace/i);
  assert.match(connectionsHtml, /Notion or GitHub/);
  assert.doesNotMatch(connectionsHtml, /Linear/);
});

test("write page wires mcp-context script and indicator", () => {
  assert.match(html, /mcp-context\.js/);
  assert.match(html, /id="repo-mcp-context"/);
  assert.match(html, /id="repo-new-essay"/);
  assert.match(html, /aria-label="Development"/);
  assert.match(html, /aria-label="Founder Source"/);
  assert.match(html, /Write in Development to get your first coding exercise/);
});
