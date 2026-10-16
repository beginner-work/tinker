/* In-flight Cursor agents view + API filtering/progress. */
"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const inflight = require("../api/_lib/inflight-agents.js");
const apiSrc = fs.readFileSync(path.join(root, "api/inflight.js"), "utf8");
const pageHtml = fs.readFileSync(path.join(root, "src/renderer/inflight/index.html"), "utf8");
const pageJs = fs.readFileSync(path.join(root, "src/renderer/inflight/inflight.js"), "utf8");
const pageCss = fs.readFileSync(path.join(root, "src/renderer/inflight/inflight.css"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const redirect = fs.readFileSync(path.join(root, "src/renderer/repo-redirect.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const repoHtml = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const releaseNotes = fs.readFileSync(path.join(root, ".release-notes"), "utf8");

const prevKey = process.env.CURSOR_API_KEY;

beforeEach(() => {
  delete process.env.CURSOR_API_KEY;
});

afterEach(() => {
  if (prevKey == null) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = prevKey;
});

test("title filter accepts Tinker/Learning/Site prefixes only", () => {
  assert.equal(inflight.titleMatches("Tinker: Blob seed"), true);
  assert.equal(inflight.titleMatches("Learning: OpenAPI"), true);
  assert.equal(inflight.titleMatches("Site: landing"), true);
  assert.equal(inflight.titleMatches("Other: nope"), false);
  assert.equal(inflight.titleMatches("Random agent"), false);
});

test("archived and expired agents are hidden", () => {
  assert.equal(inflight.isArchived({ name: "Tinker: x", status: "RUNNING" }), false);
  assert.equal(inflight.isArchived({ name: "Tinker: x", status: "ARCHIVED" }), true);
  assert.equal(inflight.isArchived({ name: "Tinker: x", status: "EXPIRED" }), true);
  assert.equal(inflight.isArchived({ name: "Tinker: x", archived: true }), true);
});

test("progress derives from status and PR link", () => {
  assert.equal(inflight.progressFor({ status: "CREATING" }).percent, 15);
  assert.equal(inflight.progressFor({ status: "RUNNING" }).state, "running");
  assert.equal(inflight.progressFor({ status: "ACTIVE" }).state, "running");
  assert.equal(inflight.progressFor({ status: "FINISHED" }).state, "finished");
  assert.equal(
    inflight.progressFor({
      status: "FINISHED",
      target: { prUrl: "https://github.com/a/b/pull/1" },
    }).state,
    "pr_open"
  );
  assert.equal(
    inflight.progressFor({
      status: "FINISHED",
      target: { prUrl: "https://github.com/a/b/pull/1", prMerged: true },
    }).state,
    "merged"
  );
});

test("filterInflight keeps matching active agents and sorts newest first", () => {
  const rows = inflight.filterInflight([
    {
      id: "1",
      name: "Other: skip",
      status: "RUNNING",
      createdAt: "2026-01-01T00:00:00Z",
      source: { repository: "https://github.com/beginner-work/tinker" },
      target: {},
    },
    {
      id: "2",
      name: "Tinker: older",
      status: "RUNNING",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      source: { repository: "https://github.com/beginner-work/tinker" },
      target: { url: "https://cursor.com/agents?id=2" },
    },
    {
      id: "3",
      name: "Learning: newer",
      status: "FINISHED",
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-01-03T00:00:00Z",
      source: { repository: "https://github.com/beginner-work/tinker" },
      target: { prUrl: "https://github.com/beginner-work/tinker/pull/9" },
    },
    {
      id: "4",
      name: "Site: archived",
      status: "FINISHED",
      archived: true,
      createdAt: "2026-01-04T00:00:00Z",
      source: { repository: "https://github.com/beginner-work/site" },
      target: {},
    },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["3", "2"]);
  assert.equal(rows[0].repo, "beginner-work/tinker");
  assert.equal(rows[0].prUrl, "https://github.com/beginner-work/tinker/pull/9");
  assert.equal(rows[0].state, "pr_open");
});

test("missing CURSOR_API_KEY returns empty configured:false (not an error)", async () => {
  const payload = await inflight.listInflightAgents();
  assert.equal(payload.configured, false);
  assert.deepEqual(payload.agents, []);
  assert.equal(payload.pollMs, 30000);
});

test("API route never returns the Cursor key; surfaces upstream errors", () => {
  assert.match(apiSrc, /CURSOR_API_KEY|listInflightAgents/);
  assert.match(apiSrc, /authenticateSession/);
  assert.doesNotMatch(apiSrc, /process\.env\.CURSOR_API_KEY/);
  assert.match(apiSrc, /listInflightAgents/);
  assert.match(apiSrc, /504|502/);
  assert.match(apiSrc, /catch \(err\)/);
});

test("inflight page has Write escape hatch, progress bar, poll, timeout, and retry", () => {
  assert.match(pageHtml, /id="inflight-write"/);
  assert.match(pageHtml, />Write</);
  assert.match(pageHtml, /In flight/);
  assert.match(pageHtml, /id="inflight-error"/);
  assert.match(pageHtml, /id="inflight-retry"/);
  assert.match(pageJs, /30000|pollMs/);
  assert.match(pageJs, /FETCH_TIMEOUT_MS\s*=\s*8000/);
  assert.match(pageJs, /AbortController/);
  assert.match(pageJs, /Timed out loading in-flight work/);
  assert.match(pageJs, /renderError|inflight-retry/);
  assert.match(pageJs, /goWriting|\/repo/);
  assert.match(pageJs, /progressbar|inflight__bar/);
  assert.match(pageCss, /\.inflight__bar/);
  assert.match(pageCss, /\.inflight__retry/);
  assert.match(pageCss, /\.inflight__error/);
  assert.doesNotMatch(pageHtml + pageJs, /\u2014/); // em dash
  assert.doesNotMatch(pageHtml + pageJs, /\b(free|real|quietly)\b/i);
});

test("mobile landing prefers /inflight; desktop optional entry on /repo", () => {
  assert.match(redirect, /\/inflight/);
  assert.match(redirect, /max-width:\s*720px/);
  assert.match(redirect, /\/repo/);
  assert.match(repoHtml, /repo-inflight-link|repo-top__inflight/);
  assert.match(repoHtml, /\/inflight\?stay=1/);
});

test("vercel rewrite and SW bypass cover /inflight", () => {
  assert.match(vercel, /"\/inflight"/);
  assert.match(sw, /\/inflight/);
});

test("release notes first line is no-download web update", () => {
  const first = releaseNotes.split(/\r?\n/, 1)[0].trim();
  assert.equal(first, "No download needed, updates on next launch");
});

test("Cursor auth uses Basic with API key as username on v0/agents", async () => {
  process.env.CURSOR_API_KEY = "test-key";
  let sawAuth = "";
  let sawUrl = "";
  await inflight.fetchAgentsPage({
    fetchImpl: async (url, opts) => {
      sawUrl = String(url);
      sawAuth = opts.headers.Authorization;
      return {
        ok: true,
        async json() {
          return { agents: [] };
        },
      };
    },
  });
  assert.match(sawUrl, /api\.cursor\.com\/v0\/agents/);
  assert.match(sawAuth, /^Basic /);
  const decoded = Buffer.from(sawAuth.replace(/^Basic\s+/i, ""), "base64").toString("utf8");
  assert.equal(decoded, "test-key:");
});

test("listInflightAgents uses mocked Cursor v0 agents list", async () => {
  process.env.CURSOR_API_KEY = "test-key";
  const payload = await inflight.listInflightAgents({
    fetchImpl: async (url, opts) => {
      assert.match(String(url), /api\.cursor\.com\/v0\/agents/);
      assert.match(opts.headers.Authorization, /^Basic /);
      assert.ok(opts.signal, "shared abort signal required");
      return {
        ok: true,
        async json() {
          return {
            agents: [
              {
                id: "bc_1",
                name: "Tinker: demo",
                status: "RUNNING",
                createdAt: "2026-01-01T00:00:00Z",
                source: { repository: "https://github.com/beginner-work/tinker" },
                target: { url: "https://cursor.com/agents?id=bc_1" },
              },
              {
                id: "bc_2",
                name: "Ignore me",
                status: "RUNNING",
                createdAt: "2026-01-01T00:00:00Z",
                source: { repository: "https://github.com/beginner-work/tinker" },
                target: {},
              },
              {
                id: "bc_3",
                name: "Site: landing",
                status: "CREATING",
                createdAt: "2026-01-02T00:00:00Z",
                source: { repository: "https://github.com/beginner-work/site" },
                target: {},
              },
            ],
          };
        },
      };
    },
  });
  assert.equal(payload.configured, true);
  assert.equal(payload.agents.length, 2);
  assert.equal(payload.agents[0].title, "Site: landing");
  assert.equal(payload.agents[0].state, "creating");
  assert.equal(payload.agents[1].title, "Tinker: demo");
  assert.equal(payload.agents[1].state, "running");
});

test("hung Cursor list aborts within FETCH_TIMEOUT_MS budget", async () => {
  process.env.CURSOR_API_KEY = "test-key";
  const started = Date.now();
  await assert.rejects(
    () => inflight.listInflightAgents({
      timeoutMs: 80,
      fetchImpl: (_url, opts) => new Promise((_resolve, reject) => {
        const signal = opts && opts.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }),
    }),
    (err) => {
      assert.equal(err.code, "timeout");
      assert.equal(err.status, 504);
      return true;
    }
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, "timeout should not hang (elapsed=" + elapsed + "ms)");
});

test("upstream Cursor failure propagates as 502 (not silent empty)", async () => {
  process.env.CURSOR_API_KEY = "test-key";
  await assert.rejects(
    () => inflight.listInflightAgents({
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        async text() { return "unauthorized"; },
      }),
    }),
    (err) => {
      assert.equal(err.status, 502);
      assert.equal(err.upstreamStatus, 401);
      return true;
    }
  );
});

test("pagination follows nextCursor and stops without repeat loops", async () => {
  process.env.CURSOR_API_KEY = "test-key";
  const calls = [];
  const payload = await inflight.listInflightAgents({
    fetchImpl: async (url) => {
      const u = new URL(String(url));
      calls.push(u.searchParams.get("cursor") || "");
      if (calls.length === 1) {
        return {
          ok: true,
          async json() {
            return {
              agents: [{
                id: "a",
                name: "Tinker: page1",
                status: "RUNNING",
                createdAt: "2026-01-01T00:00:00Z",
                source: { repository: "https://github.com/beginner-work/tinker" },
                target: {},
              }],
              nextCursor: "cur_2",
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            agents: [{
              id: "b",
              name: "Learning: page2",
              status: "RUNNING",
              createdAt: "2026-01-02T00:00:00Z",
              source: { repository: "https://github.com/beginner-work/tinker" },
              target: {},
            }],
            nextCursor: "cur_2", // repeat would loop; code must stop
          };
        },
      };
    },
  });
  assert.deepEqual(calls, ["", "cur_2"]);
  assert.equal(payload.agents.length, 2);
});

test("FETCH_TIMEOUT_MS is eight seconds", () => {
  assert.equal(inflight.FETCH_TIMEOUT_MS, 8000);
});

test("client empty mobile path still routes to /repo; errors do not", () => {
  assert.match(pageJs, /isMobileFront\(\)\s*&&\s*configured/);
  assert.match(pageJs, /goWriting/);
  // Errors must call renderError, not applyPayload with empty agents.
  assert.match(pageJs, /renderError\(/);
  assert.doesNotMatch(
    pageJs,
    /if\s*\(!res\.ok\)\s*\{[^}]*applyPayload\(\{\s*configured:\s*true,\s*agents:\s*\[\s*\]\s*\}\)/s
  );
});
