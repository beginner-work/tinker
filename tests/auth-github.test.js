/* Smoke tests for the GitHub developer sign-in flow —
 * api/auth/github/{start,callback,repos}.js. Stytch, Prisma, and the
 * GitHub client are stubbed so everything stays in-process (same
 * pattern as user-data.test.js).
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

// ── Stubs (installed before requiring the handlers) ────────────────────

let stytchUserId = "user-test-abc";
let oauthResult = null;
let oauthShouldThrow = null;
let githubRepos = [];
const fakeStore = new Map(); // `${userId}::${kind}` → row

const stytchStub = {
  baseUrlFor: (projectId) =>
    projectId.startsWith("project-test-")
      ? "https://test.stytch.com"
      : "https://api.stytch.com",
  authenticateSession: async () => ({
    session: { user_id: stytchUserId },
    user: { user_id: stytchUserId },
  }),
  authenticateOauth: async () => {
    if (oauthShouldThrow) throw oauthShouldThrow;
    return oauthResult;
  },
};
const dbStub = {
  tinkerUserData: {
    findUnique: async ({ where: { userId_kind: { userId, kind } } }) => {
      const key = `${userId}::${kind}`;
      return fakeStore.has(key) ? fakeStore.get(key) : null;
    },
    upsert: async ({ where: { userId_kind: { userId, kind } }, create, update }) => {
      const row = {
        userId,
        kind,
        data: update.data ?? create.data,
        updatedAt: new Date("2026-07-10T12:00:00Z"),
      };
      fakeStore.set(`${userId}::${kind}`, row);
      return row;
    },
  },
};
const githubStub = {
  listRepos: async () => githubRepos,
};

const libDir = path.resolve(__dirname, "..", "api", "_lib");
function stubAt(absPath, exports) {
  const m = new Module(absPath);
  m.filename = absPath;
  m.loaded = true;
  m.exports = exports;
  require.cache[absPath] = m;
}
stubAt(path.join(libDir, "stytch.js"), stytchStub);
stubAt(path.join(libDir, "db.js"), dbStub);
stubAt(path.join(libDir, "github.js"), githubStub);

const startHandler = require("../api/auth/github/start.js");
const callbackHandler = require("../api/auth/github/callback.js");
const reposHandler = require("../api/auth/github/repos.js");

// ── Helpers ────────────────────────────────────────────────────────────

function fakeReq({ method = "GET", url = "/", body, headers = {} } = {}) {
  const stream = Readable.from([]);
  Object.assign(stream, { headers, method, url, body });
  return stream;
}
function fakeRes() {
  const captured = { status: null, body: null, headers: {}, ended: false };
  return {
    captured,
    statusCode: 200,
    setHeader(k, v) { captured.headers[k] = v; },
    status(s) { captured.status = s; return this; },
    json(b) { captured.body = b; return this; },
    end() { captured.ended = true; captured.status = captured.status || this.statusCode; },
  };
}

function reset() {
  stytchUserId = "user-test-abc";
  oauthResult = null;
  oauthShouldThrow = null;
  githubRepos = [];
  fakeStore.clear();
  delete process.env.STYTCH_PROJECT_ID;
  delete process.env.STYTCH_PUBLIC_TOKEN;
}

// ── /start ─────────────────────────────────────────────────────────────

test("start: 503 when Stytch public token isn't configured", async () => {
  reset();
  process.env.STYTCH_PROJECT_ID = "project-test-123";
  const res = fakeRes();
  await startHandler(fakeReq({ headers: { host: "tinker.example" } }), res);
  assert.equal(res.captured.status, 503);
  assert.match(res.captured.body.error, /isn't configured/);
});

test("start: returns the Stytch-hosted GitHub start URL", async () => {
  reset();
  process.env.STYTCH_PROJECT_ID = "project-test-123";
  process.env.STYTCH_PUBLIC_TOKEN = "public-token-test-xyz";
  const res = fakeRes();
  await startHandler(
    fakeReq({
      headers: { host: "internal", "x-forwarded-host": "tinker.example", "x-forwarded-proto": "https" },
    }),
    res,
  );
  assert.equal(res.captured.status, 200);
  const url = new URL(res.captured.body.url);
  assert.equal(url.origin, "https://test.stytch.com");
  assert.equal(url.pathname, "/v1/public/oauth/github/start");
  assert.equal(url.searchParams.get("public_token"), "public-token-test-xyz");
  assert.equal(
    url.searchParams.get("login_redirect_url"),
    "https://tinker.example/api/auth/github/callback",
  );
  assert.match(url.searchParams.get("custom_scopes"), /\brepo\b/);
});

// ── /callback ──────────────────────────────────────────────────────────

test("callback: missing token redirects home with gh_error", async () => {
  reset();
  const res = fakeRes();
  await callbackHandler(fakeReq({ url: "/api/auth/github/callback" }), res);
  assert.equal(res.statusCode, 302);
  assert.match(res.captured.headers.Location, /^\/#gh_error=/);
});

test("callback: success stores the connection and redirects with the session token", async () => {
  reset();
  oauthResult = {
    session_token: "sess-token-1",
    user: { user_id: "user-test-abc", created_at: new Date().toISOString() },
    provider_subject: "octocat-id",
    provider_values: { access_token: "gho_secret", scopes: ["repo"] },
  };
  const res = fakeRes();
  await callbackHandler(
    fakeReq({ url: "/api/auth/github/callback?token=oauth-one-shot" }),
    res,
  );
  assert.equal(res.statusCode, 302);
  assert.equal(
    res.captured.headers.Location,
    "/#gh=sess-token-1&gh_new=1",
  );
  const row = fakeStore.get("user-test-abc::github");
  assert.equal(row.data.accessToken, "gho_secret");
  assert.deepEqual(row.data.selectedRepos, []);
  // The GitHub access token must never appear in the redirect.
  assert.ok(!res.captured.headers.Location.includes("gho_secret"));
});

test("callback: a returning user keeps their previous repo selection", async () => {
  reset();
  fakeStore.set("user-test-abc::github", {
    data: { accessToken: "gho_old", selectedRepos: ["octo/kept"] },
  });
  oauthResult = {
    session_token: "sess-token-2",
    user: { user_id: "user-test-abc", created_at: "2026-01-01T00:00:00Z" },
    provider_values: { access_token: "gho_new", scopes: ["repo"] },
  };
  const res = fakeRes();
  await callbackHandler(
    fakeReq({ url: "/api/auth/github/callback?token=oauth-two" }),
    res,
  );
  assert.equal(res.captured.headers.Location, "/#gh=sess-token-2&gh_new=0");
  const row = fakeStore.get("user-test-abc::github");
  assert.equal(row.data.accessToken, "gho_new");
  assert.deepEqual(row.data.selectedRepos, ["octo/kept"]);
});

test("callback: Stytch failure redirects home with gh_error", async () => {
  reset();
  oauthShouldThrow = Object.assign(new Error("Magic token invalid"), { status: 401 });
  const res = fakeRes();
  await callbackHandler(
    fakeReq({ url: "/api/auth/github/callback?token=bad" }),
    res,
  );
  assert.equal(res.statusCode, 302);
  assert.match(res.captured.headers.Location, /gh_error=Magic%20token%20invalid/);
});

// ── /repos ─────────────────────────────────────────────────────────────

test("repos GET: 409 when no GitHub connection exists", async () => {
  reset();
  const res = fakeRes();
  await reposHandler(
    fakeReq({ method: "GET", headers: { authorization: "Bearer t1" } }),
    res,
  );
  assert.equal(res.captured.status, 409);
});

test("repos GET: lists repos and the saved selection", async () => {
  reset();
  fakeStore.set("user-test-abc::github", {
    data: { accessToken: "gho_secret", selectedRepos: ["octo/site"] },
  });
  githubRepos = [
    { id: 1, fullName: "octo/site", private: false, description: "", updatedAt: null },
    { id: 2, fullName: "octo/app", private: true, description: "app", updatedAt: null },
  ];
  const res = fakeRes();
  await reposHandler(
    fakeReq({ method: "GET", headers: { authorization: "Bearer t1" } }),
    res,
  );
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.repos.length, 2);
  assert.deepEqual(res.captured.body.selected, ["octo/site"]);
});

test("repos PUT: saves a deduped selection", async () => {
  reset();
  fakeStore.set("user-test-abc::github", {
    data: { accessToken: "gho_secret", selectedRepos: [] },
  });
  const res = fakeRes();
  await reposHandler(
    fakeReq({
      method: "PUT",
      headers: { authorization: "Bearer t1" },
      body: { repos: ["octo/app", "octo/app", " octo/site ", ""] },
    }),
    res,
  );
  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body.selected, ["octo/app", "octo/site"]);
  const row = fakeStore.get("user-test-abc::github");
  assert.deepEqual(row.data.selectedRepos, ["octo/app", "octo/site"]);
  assert.equal(row.data.accessToken, "gho_secret");
});

test("repos PUT: rejects a non-array body", async () => {
  reset();
  fakeStore.set("user-test-abc::github", {
    data: { accessToken: "gho_secret", selectedRepos: [] },
  });
  const res = fakeRes();
  await reposHandler(
    fakeReq({
      method: "PUT",
      headers: { authorization: "Bearer t1" },
      body: { repos: "octo/app" },
    }),
    res,
  );
  assert.equal(res.captured.status, 400);
});
