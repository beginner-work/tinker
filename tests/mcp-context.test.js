/* MCP context pages for business / technical goals (mocked MCP). */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const libDir = path.resolve(root, "api", "_lib");
const apiDir = path.resolve(root, "api");

const ctx = require("../src/renderer/lib/mcp-context.js");
const classify = require("../src/renderer/lib/essay-classify.js");
const reconstruct = require("../src/renderer/lib/exercise-reconstruct.js");
const registry = require("../api/_lib/mcp-connectors-registry.js");
const { callMcpTool, toolResultText } = require("../api/_lib/mcp-client-call.js");

const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const connectionsHtml = fs.readFileSync(
  path.join(root, "src/renderer/connections/index.html"),
  "utf8"
);
const connectionsJs = fs.readFileSync(
  path.join(root, "src/renderer/connections/connections.js"),
  "utf8"
);
const connectionsCss = fs.readFileSync(
  path.join(root, "src/renderer/connections/connections.css"),
  "utf8"
);
const repoJs = fs.readFileSync(
  path.join(root, "src/renderer/repo/repo.js"),
  "utf8"
);

process.env.STYTCH_PROJECT_ID = "project-test-mcp-context";
process.env.STYTCH_SECRET = "secret-test-mcp-context-key";
process.env.TINKER_SECRETS_KEY = "test-field-secret-mcp-context";

let seq = 0;
const rows = [];
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  tinkerUserData: {
    rows,
    async create({ data }) {
      const now = new Date();
      const row = Object.assign({ id: "row_" + (++seq), createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      const pair = where.userId_kind;
      return pair
        ? rows.find((r) => r.userId === pair.userId && r.kind === pair.kind) || null
        : null;
    },
    async upsert({ where, create, update }) {
      const pair = where.userId_kind;
      const row = rows.find((r) => r.userId === pair.userId && r.kind === pair.kind);
      if (!row) return this.create({ data: create });
      Object.assign(row, update, { updatedAt: new Date() });
      return row;
    },
  },
};

function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}

for (const rel of [
  "db.js",
  "stytch.js",
  "mcp-keys.js",
  "log.js",
  "mcp-connection-store.js",
  "mcp-connectors-registry.js",
  "mcp-client-call.js",
  "mcp-context-pages.js",
]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(apiDir, "mcp-context.js")];

stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-ctx") {
      throw Object.assign(new Error("nope"), { status: 401 });
    }
    return { session: { user_id: token } };
  },
});
stubAt(path.join(libDir, "mcp-keys.js"), {
  isMcpApiKey: (t) => typeof t === "string" && t.startsWith("mcp_"),
  userIdFromSession: (s) => (s && s.session && s.session.user_id) || "",
});
stubAt(path.join(libDir, "log.js"), {
  withResponseLogging: (fn) => fn,
});
stubAt(path.join(libDir, "mcp-connection-store.js"), {
  getValidAccessToken: async ({ userId, connectorId }) => {
    if (userId === "user-ctx" && connectorId === "notion") {
      return { accessToken: "notion-access-token", connectorId: "notion" };
    }
    return null;
  },
});

const pages = require("../api/_lib/mcp-context-pages.js");
const mcpContextApi = require("../api/mcp-context.js");

function fakeRes() {
  const captured = { status: null, body: null, headers: {} };
  return {
    captured,
    setHeader(k, v) {
      captured.headers[k] = v;
    },
    status(code) {
      captured.status = code;
      return this;
    },
    json(body) {
      captured.body = body;
      return this;
    },
  };
}

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

test("exercise reconstruct prompt includes technical goals context", () => {
  const user = reconstruct.buildUserMessage({
    essays: [
      {
        id: "e1",
        title: "Payments",
        body: "Named GET /payment_intents/{id} and sketched the 200 shape.",
      },
    ],
    progress: { level: 20, goalTitle: "", currentPrompt: "" },
    technicalGoalsContext: "Prefer idiomatic OpenAPI error objects.",
  });
  assert.match(user, /TECH_CONTEXT/);
  assert.match(user, /Prefer idiomatic OpenAPI/);
});

test("marketplace catalog is Notion and GitHub only", () => {
  const ids = registry.listConnectors().map((c) => c.id);
  assert.deepEqual(ids, ["notion", "github"]);
  assert.match(connectionsHtml, /plugin marketplace/i);
  assert.match(connectionsHtml, /Notion or GitHub/);
  assert.doesNotMatch(connectionsHtml, /Linear/);
  assert.deepEqual(registry.getConnector("notion").defaultReadTools, [
    "notion-search",
    "notion-fetch",
  ]);
});

test("write page wires mcp-context script, indicator, and server sync", () => {
  assert.match(html, /mcp-context\.js/);
  assert.match(html, /id="repo-mcp-context"/);
  assert.match(html, /id="repo-new-essay"/);
  assert.match(html, /aria-label="Development"/);
  assert.match(html, /aria-label="Founder Source"/);
  assert.match(html, /Write in Development to get your first coding exercise/);
  assert.match(repoJs, /syncMcpContextFromServer/);
  assert.match(repoJs, /\/api\/mcp-context\?action=list/);
  assert.match(repoJs, /getBusinessContext/);
  assert.match(repoJs, /getTechnicalGoalsContext/);
});

test("connections UI searches Notion and paints hit list", () => {
  assert.match(connectionsHtml, /data-connections-context/);
  assert.match(connectionsHtml, /data-context-form/);
  assert.match(connectionsHtml, /data-context-results/);
  assert.match(connectionsHtml, /mcp-context\.js/);
  assert.match(connectionsJs, /action:\s*"search"/);
  assert.match(connectionsJs, /action:\s*"select"/);
  assert.match(connectionsJs, /pick-context/);
  assert.match(connectionsJs, /data-connections-context/);
  assert.match(connectionsCss, /\.connections__context-hit/);
});

test("toolResultText flattens MCP content blocks", () => {
  assert.equal(toolResultText({ content: [{ type: "text", text: "hello" }] }), "hello");
  assert.equal(toolResultText("plain"), "plain");
});

test("callMcpTool posts tools/call with mocked fetch", async () => {
  let saw = null;
  const out = await callMcpTool({
    url: "https://mcp.notion.com/mcp",
    accessToken: "tok",
    toolName: "notion-search",
    arguments: { query: "ICP" },
    fetchImpl: async (url, init) => {
      saw = { url, init };
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            jsonrpc: "2.0",
            id: "1",
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify([
                    { id: "page-1", title: "ICP notes", url: "https://notion.so/p1" },
                  ]),
                },
              ],
            },
          });
        },
      };
    },
  });
  assert.equal(saw.url, "https://mcp.notion.com/mcp");
  assert.match(saw.init.headers.Authorization, /Bearer tok/);
  const body = JSON.parse(saw.init.body);
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "notion-search");
  assert.match(toolResultText(out.result), /ICP notes/);
});

test("parseSearchHits accepts JSON array results", () => {
  const hits = pages.parseSearchHits(
    JSON.stringify([{ id: "abc", title: "Roadmap", url: "https://notion.so/abc" }])
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "abc");
  assert.equal(hits[0].title, "Roadmap");
});

test("searchPages uses mocked notion-search only", async () => {
  rows.length = 0;
  const calls = [];
  const result = await pages.searchPages({
    userId: "user-ctx",
    query: "ICP",
    callTool: async (args) => {
      calls.push(args);
      return {
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify([
                { id: "p-icp", title: "ICP notes", url: "https://notion.so/icp" },
              ]),
            },
          ],
        },
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "notion-search");
  assert.equal(result.results[0].title, "ICP notes");
});

test("selectPage fetches snippet via notion-fetch and persists", async () => {
  rows.length = 0;
  const tools = [];
  const ctxOut = await pages.selectPage({
    userId: "user-ctx",
    role: "business",
    pageId: "p-icp",
    title: "ICP notes",
    callTool: async (args) => {
      tools.push(args.toolName);
      assert.equal(args.toolName, "notion-fetch");
      return {
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: "ICP notes",
                body: "Sell to B2B founders who write.",
              }),
            },
          ],
        },
      };
    },
  });
  assert.deepEqual(tools, ["notion-fetch"]);
  assert.equal(ctxOut.business.length, 1);
  assert.match(ctxOut.business[0].snippet, /B2B founders/);
  const prompts = await pages.contextForPrompts("user-ctx");
  assert.match(prompts.businessContext, /ICP notes/);
  assert.match(prompts.businessContext, /B2B founders/);
});

test("selectPage technical role + clearRole", async () => {
  rows.length = 0;
  await pages.selectPage({
    userId: "user-ctx",
    role: "technical",
    pageId: "p-api",
    title: "API goals",
    snippet: "Ship OpenAPI by feel.",
  });
  let stored = await pages.readContext("user-ctx");
  assert.equal(stored.technical.length, 1);
  assert.equal(stored.business.length, 0);
  stored = await pages.clearRole({ userId: "user-ctx", role: "technical" });
  assert.equal(stored.technical.length, 0);
});

test("GET /api/mcp-context list returns joined snippets", async () => {
  rows.length = 0;
  await pages.writeContext("user-ctx", {
    business: [{ id: "b1", title: "ICP", snippet: "Founders." }],
    technical: [{ id: "t1", title: "Goals", snippet: "OpenAPI." }],
  });
  const res = fakeRes();
  await mcpContextApi(
    {
      method: "GET",
      headers: { authorization: "Bearer user-ctx" },
      query: { action: "list" },
    },
    res
  );
  assert.equal(res.captured.status, 200);
  assert.match(res.captured.body.businessContext, /Founders/);
  assert.match(res.captured.body.technicalGoalsContext, /OpenAPI/);
});

test("searchPages fails when Notion is not connected", async () => {
  await assert.rejects(
    () =>
      pages.searchPages({
        userId: "user-no-notion",
        query: "ICP",
        callTool: async () => {
          throw new Error("should not call MCP");
        },
      }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Connect Notion/i);
      return true;
    }
  );
});
