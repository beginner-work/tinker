/* Email interface contract (api/email/send.js + email.js wiring).
 *
 * Two halves, matching the repo's conventions:
 *
 *  1. Handler smoke tests for /api/email/send — Stytch is stubbed via the
 *     module cache (same trick as user-data.test.js) and the upstream mcp
 *     Worker via global.fetch, so everything stays in-process. The handler
 *     must gate on config + session, validate input, relay to the Worker
 *     with the server-side bearer, and pass actionable errors through.
 *
 *  2. Source-level contract tests for the renderer composer (the sandbox
 *     has only a no-op DOM), matching open-beginner.test.js: email.js
 *     exposes window.tinkerEmail, posts with the founder's session token,
 *     and the profile menu wires the entry point.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// ── Stytch stub (installed before requiring send.js) ───────────────────
let stytchUserId = "user-test-abc";
let stytchShouldThrow = null;

const libDir = path.resolve(__dirname, "..", "api", "_lib");
function stubAt(absPath, exports) {
  const m = new Module(absPath);
  m.filename = absPath;
  m.loaded = true;
  m.exports = exports;
  require.cache[absPath] = m;
}
stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async () => {
    if (stytchShouldThrow) throw stytchShouldThrow;
    return { session: { user_id: stytchUserId } };
  },
});

const handler = require("../api/email/send.js");

// ── Upstream (mcp Worker) stub ──────────────────────────────────────────
const fetchCalls = [];
let fetchResponse = null;
const realFetch = global.fetch;
function stubFetch() {
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    if (fetchResponse instanceof Error) throw fetchResponse;
    return fetchResponse;
  };
}
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ── Helpers ─────────────────────────────────────────────────────────────
function fakeReq({ method = "POST", body, headers = {} } = {}) {
  const stream = Readable.from([]);
  Object.assign(stream, { headers, method, body });
  return stream;
}
function fakeRes() {
  const captured = { status: null, body: null, headers: {} };
  return {
    captured,
    setHeader(k, v) { captured.headers[k] = v; },
    status(s) { captured.status = s; return this; },
    json(b) { captured.body = b; return this; },
  };
}
function reset({ configured = true } = {}) {
  stytchShouldThrow = null;
  fetchCalls.length = 0;
  fetchResponse = jsonResponse(200, {
    sent: true, from: "tyler.lindow@beginner.work", to: "friend@example.com", subject: "hi",
  });
  if (configured) {
    process.env.BEGINNER_MCP_URL = "https://beginner-mcp.example.workers.dev";
    process.env.BEGINNER_MCP_TOKEN = "test-mcp-token";
  } else {
    delete process.env.BEGINNER_MCP_URL;
    delete process.env.BEGINNER_MCP_TOKEN;
  }
  stubFetch();
}
const GOOD_BODY = { to: "friend@example.com", subject: "hi", text: "hello there" };
const AUTHED = { authorization: "Bearer session-token-1" };

test.after(() => { global.fetch = realFetch; });

// ── 1. Handler ─────────────────────────────────────────────────────────

test("rejects non-POST methods", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ method: "GET", headers: AUTHED }), res);
  assert.equal(res.captured.status, 405);
});

test("503s with a friendly error when the mcp Worker isn't configured", async () => {
  reset({ configured: false });
  const res = fakeRes();
  await handler(fakeReq({ body: GOOD_BODY, headers: AUTHED }), res);
  assert.equal(res.captured.status, 503);
  assert.match(res.captured.body.error, /isn't configured/);
  assert.equal(fetchCalls.length, 0, "must not call upstream");
});

test("401s when the session doesn't validate", async () => {
  reset();
  stytchShouldThrow = Object.assign(new Error("Invalid session"), { status: 401 });
  const res = fakeRes();
  await handler(fakeReq({ body: GOOD_BODY, headers: AUTHED }), res);
  assert.equal(res.captured.status, 401);
  assert.equal(fetchCalls.length, 0, "must not call upstream");
});

test("400s on a missing or invalid recipient / subject / message", async () => {
  for (const body of [
    { ...GOOD_BODY, to: "not-an-email" },
    { ...GOOD_BODY, subject: "" },
    { ...GOOD_BODY, text: "  " },
  ]) {
    reset();
    const res = fakeRes();
    await handler(fakeReq({ body, headers: AUTHED }), res);
    assert.equal(res.captured.status, 400, JSON.stringify(body));
    assert.equal(fetchCalls.length, 0, "must not call upstream");
  }
});

test("relays to the Worker's /email/send with the server-side bearer", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({
    body: { ...GOOD_BODY, fromName: "Tyler", replyTo: "tyler.lindow@gmail.com" },
    headers: AUTHED,
  }), res);

  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.sent, true);
  assert.equal(res.captured.body.from, "tyler.lindow@beginner.work");

  assert.equal(fetchCalls.length, 1);
  const call = fetchCalls[0];
  assert.equal(call.url, "https://beginner-mcp.example.workers.dev/email/send");
  assert.equal(call.opts.headers.authorization, "Bearer test-mcp-token");
  const sent = JSON.parse(call.opts.body);
  assert.equal(sent.to, GOOD_BODY.to);
  assert.equal(sent.fromName, "Tyler");
  assert.equal(sent.replyTo, "tyler.lindow@gmail.com");
  assert.equal(sent.from, undefined, "the From address is never the client's to choose");
});

test("passes the Worker's actionable error through on a rejected send", async () => {
  reset();
  fetchResponse = jsonResponse(400, {
    error: "Send failed: recipient must be a verified Email Routing destination.",
  });
  const res = fakeRes();
  await handler(fakeReq({ body: GOOD_BODY, headers: AUTHED }), res);
  assert.equal(res.captured.status, 400);
  assert.match(res.captured.body.error, /verified Email Routing destination/);
});

test("maps Worker outages to a 502, not a founder-input error", async () => {
  reset();
  fetchResponse = new Error("connect ECONNREFUSED");
  const res = fakeRes();
  await handler(fakeReq({ body: GOOD_BODY, headers: AUTHED }), res);
  assert.equal(res.captured.status, 502);
});

// ── 2. Renderer wiring ─────────────────────────────────────────────────

const SRC_DIR = path.resolve(__dirname, "..", "src", "renderer");
const read = (p) => fs.readFileSync(path.join(SRC_DIR, p), "utf8");

const SRC = read("email.js");
const INDEX_HTML = read("index.html");
const PROFILE_SRC = read("profile.js");
const PROFILE_CSS = read("profile.css");

test("email.js exposes a shared composer on window", () => {
  assert.match(
    SRC,
    /window\.tinkerEmail\s*=\s*\{[^}]*open[^}]*\}/,
    "must expose window.tinkerEmail with an open()",
  );
});

test("the composer sends through the server with the founder's session token", () => {
  assert.match(SRC, /fetch\("\/api\/email\/send"/, "posts to /api/email/send");
  assert.match(SRC, /localStorage\.getItem\(TOKEN_KEY\)/, "reads the session token");
  assert.match(SRC, /"tinker_jwt"/, "uses the shared token key");
  assert.doesNotMatch(SRC, /workers\.dev|BEGINNER_MCP/, "never talks to the Worker directly");
});

test("index.html ships the entry point and the module", () => {
  assert.match(INDEX_HTML, /id="profile-email"/, "profile menu has the Send an email action");
  assert.match(INDEX_HTML, /<script src="\.\/email\.js" defer><\/script>/, "email.js is loaded");
});

test("profile.js wires the menu action to the composer", () => {
  assert.match(PROFILE_SRC, /getElementById\("profile-email"\)/);
  assert.match(PROFILE_SRC, /window\.tinkerEmail[\s\S]{0,80}\.open/, "opens via the shared global");
});

test("profile.css styles the compose overlay", () => {
  assert.match(PROFILE_CSS, /\.email-overlay\s*\{/);
  assert.match(PROFILE_CSS, /\.email-compose__send/);
});
