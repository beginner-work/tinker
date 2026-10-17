/* GitHub polished-goal storage (mocked GitHub API). Attempts stay in Tinker. */
"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

process.env.STYTCH_PROJECT_ID = "project-test-github-exercises";
process.env.STYTCH_SECRET = "secret-test-github-exercises-key";
process.env.TINKER_SECRETS_KEY = "test-field-secret-github-exercises";

const rows = [];
const prismaMock = {
  tinkerUserData: {
    async findUnique({ where }) {
      const key = where.userId_kind;
      return (
        rows.find(
          (r) => r.userId === key.userId && r.kind === key.kind
        ) || null
      );
    },
    async upsert({ where, create, update }) {
      const key = where.userId_kind;
      const idx = rows.findIndex(
        (r) => r.userId === key.userId && r.kind === key.kind
      );
      if (idx >= 0) {
        rows[idx] = Object.assign({}, rows[idx], update, {
          data: update.data,
          updatedAt: new Date(),
        });
        return rows[idx];
      }
      const row = Object.assign({}, create, {
        updatedAt: new Date(),
        createdAt: new Date(),
      });
      rows.push(row);
      return row;
    },
  },
};

const apiDir = path.join(root, "api/_lib");
require.cache[require.resolve("../api/_lib/db.js")] = {
  id: require.resolve("../api/_lib/db.js"),
  filename: require.resolve("../api/_lib/db.js"),
  loaded: true,
  exports: prismaMock,
};

// Fresh load after db mock.
delete require.cache[path.join(apiDir, "github-exercise-repo.js")];
const github = require("../api/_lib/github-exercise-repo.js");

const connectionStore = require("../api/_lib/mcp-connection-store.js");
const origGetToken = connectionStore.getValidAccessToken;

after(() => {
  connectionStore.getValidAccessToken = origGetToken;
  rows.length = 0;
});

function mockFetchSequence(handlers) {
  let i = 0;
  return async (url, opts) => {
    const handler = handlers[i] || handlers[handlers.length - 1];
    i += 1;
    const result = await handler(String(url), opts || {});
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      async text() {
        return JSON.stringify(result.body == null ? {} : result.body);
      },
      async json() {
        return result.body == null ? {} : result.body;
      },
    };
  };
}

test("readme and goal paths stay attempt-free", () => {
  const progress = {
    goalId: "openapi-errors",
    goalTitle: "Name error responses",
    currentPrompt: "Add 404.",
    sourceEssayTitle: "Payment intents",
    practicePath: "payment-intent/api.md",
  };
  assert.match(github.readmeFor(progress), /polished goal code/i);
  assert.match(github.readmeFor(progress), /Attempts stay in Tinker/);
  assert.doesNotMatch(github.readmeFor(progress), /messy|intermediate|in-progress/i);
  assert.equal(github.goalDir(progress), "exercises/openapi-errors");
});

test("publish rejects scaffolds and requires confirm", async () => {
  connectionStore.getValidAccessToken = async () => ({
    accessToken: "ghs_test",
    writeAccess: true,
  });
  const noConfirm = await github.publishPolishedGoal({
    userId: "user-a",
    progress: { goalId: "g1", practicePath: "a.md" },
    polishedContent: "ok",
  });
  assert.equal(noConfirm.skipped, true);
  assert.equal(noConfirm.reason, "not_confirmed");

  await assert.rejects(
    () =>
      github.publishPolishedGoal({
        userId: "user-a",
        progress: { goalId: "g1", practicePath: "a.md" },
        polishedContent:
          "<!-- Document the payments API contract from a caller's perspective. -->\n",
      }).then(async (r) => {
        // Force confirmed meta then reject scaffold
        await github.writeMeta("user-a", {
          confirmed: true,
          owner: "tyler",
          repo: "tinker-exercises",
        });
        return github.publishPolishedGoal({
          userId: "user-a",
          progress: { goalId: "g1", practicePath: "a.md" },
          polishedContent:
            "<!-- Document the payments API contract from a caller's perspective. -->\n",
        });
      }),
    /scaffold/i
  );
});

test("confirmAndEnsureRepo creates private tinker-exercises once", async () => {
  connectionStore.getValidAccessToken = async () => ({
    accessToken: "ghs_test",
    writeAccess: true,
  });
  const fetchImpl = mockFetchSequence([
    () => ({ status: 200, body: { login: "tyler" } }),
    () => ({ status: 404, body: { message: "Not Found" } }),
    (_url, opts) => {
      const body = JSON.parse(opts.body);
      assert.equal(body.name, "tinker-exercises");
      assert.equal(body.private, true);
      return {
        status: 201,
        body: { html_url: "https://github.com/tyler/tinker-exercises", name: "tinker-exercises" },
      };
    },
  ]);
  const out = await github.confirmAndEnsureRepo({
    userId: "user-b",
    confirmed: true,
    fetchImpl,
  });
  assert.equal(out.ok, true);
  assert.equal(out.meta.owner, "tyler");
  assert.equal(out.meta.repo, "tinker-exercises");
  assert.equal(out.meta.confirmed, true);
});

test("publish writes README + polished goal only", async () => {
  connectionStore.getValidAccessToken = async () => ({
    accessToken: "ghs_test",
    writeAccess: true,
  });
  await github.writeMeta("user-c", {
    confirmed: true,
    owner: "tyler",
    repo: "tinker-exercises",
    htmlUrl: "https://github.com/tyler/tinker-exercises",
  });
  const puts = [];
  const fetchImpl = mockFetchSequence([
    // README get (missing)
    () => ({ status: 404, body: { message: "Not Found" } }),
    // README put
    (url, opts) => {
      puts.push({ url, body: JSON.parse(opts.body) });
      return { status: 201, body: { content: { path: "exercises/g1/README.md" } } };
    },
    // goal get (missing)
    () => ({ status: 404, body: { message: "Not Found" } }),
    // goal put
    (url, opts) => {
      puts.push({ url, body: JSON.parse(opts.body) });
      return { status: 201, body: { content: { path: "exercises/g1/api.md" } } };
    },
  ]);
  const polished = "# Payment Intent\n\n## GET /payment_intents/{id}\n";
  const out = await github.publishPolishedGoal({
    userId: "user-c",
    progress: {
      goalId: "g1",
      goalTitle: "Payment intents",
      practicePath: "api.md",
      currentPrompt: "Name the 200 shape.",
    },
    polishedContent: polished,
    fetchImpl,
  });
  assert.equal(out.ok, true);
  assert.equal(puts.length, 2);
  const decoded = puts.map((p) =>
    Buffer.from(p.body.content, "base64").toString("utf8")
  );
  assert.match(decoded[0], /# Payment intents/);
  assert.match(decoded[0], /Attempts stay in Tinker/);
  assert.equal(decoded[1], polished);
  assert.doesNotMatch(decoded[1], /TODO|<!--/);
});

test("loadPolishedGoal reads from GitHub or falls back to Tinker", async () => {
  connectionStore.getValidAccessToken = async () => ({
    accessToken: "ghs_test",
    writeAccess: false,
  });
  const missingMeta = await github.loadPolishedGoal({
    userId: "user-load",
    progress: { goalId: "g1", practicePath: "api.md" },
  });
  assert.equal(missingMeta.skipped, true);
  assert.equal(missingMeta.fallback, "tinker");

  await github.writeMeta("user-load", {
    confirmed: true,
    owner: "tyler",
    repo: "tinker-exercises",
    htmlUrl: "https://github.com/tyler/tinker-exercises",
  });
  const polished = "# Payment Intent\n\nid: string\n";
  const fetchImpl = mockFetchSequence([
    () => ({
      status: 200,
      body: {
        encoding: "base64",
        content: Buffer.from(polished, "utf8").toString("base64"),
        path: "exercises/g1/api.md",
      },
    }),
  ]);
  const loaded = await github.loadPolishedGoal({
    userId: "user-load",
    progress: { goalId: "g1", practicePath: "api.md" },
    fetchImpl,
  });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.source, "github");
  assert.equal(loaded.content, polished);
  assert.equal(loaded.fallback, "tinker");
});

test("API route and Connections catalog stay GitHub-ready", () => {
  const apiSrc = fs.readFileSync(
    path.join(root, "api/github-exercises.js"),
    "utf8"
  );
  const uiSrc = fs.readFileSync(
    path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
    "utf8"
  );
  const registry = require("../api/_lib/mcp-connectors-registry.js");
  assert.match(apiSrc, /confirmAndEnsureRepo/);
  assert.match(apiSrc, /publishPolishedGoal/);
  assert.match(apiSrc, /loadPolishedGoal/);
  assert.match(uiSrc, /hydratePracticeFromGithub/);
  assert.match(uiSrc, /action:\s*"load"/);
  assert.ok(registry.getConnector("github"));
  assert.equal(registry.getConnector("linear"), null);
});
