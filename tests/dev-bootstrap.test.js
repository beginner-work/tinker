/* Tests for api/dev-bootstrap.js — the env-gated bootstrap that lets
 * Browserbase enter the preview past Vercel + Stytch in one navigation.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const handler = require("../api/dev-bootstrap.js");

function fakeReq({ method = "GET", query = {} } = {}) {
  return { method, url: "/api/dev-bootstrap", query, headers: {} };
}

function fakeRes() {
  const captured = { status: null, headers: {}, body: null };
  return {
    captured,
    statusCode: 200,
    status(s) {
      this.statusCode = s;
      captured.status = s;
      return this;
    },
    setHeader(k, v) {
      captured.headers[k] = v;
      return this;
    },
    send(b) {
      captured.body = b;
      return this;
    },
    json(b) {
      captured.body = b;
      return this;
    },
  };
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const k of Object.keys(overrides)) {
    previous[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(previous)) {
        if (previous[k] === undefined) delete process.env[k];
        else process.env[k] = previous[k];
      }
    });
}

test("404s when TEST_AUTH_TOKEN env is unset (production stays dormant)", async () => {
  await withEnv({ TEST_AUTH_TOKEN: undefined, TEST_SESSION_TOKEN: "stx-session" }, async () => {
    const res = fakeRes();
    await handler(fakeReq({ query: { test_auth: "anything" } }), res);
    assert.equal(res.captured.status, 404);
  });
});

test("404s on wrong test_auth (no signal that the endpoint exists)", async () => {
  await withEnv({ TEST_AUTH_TOKEN: "correct-token", TEST_SESSION_TOKEN: "stx-session" }, async () => {
    const res = fakeRes();
    await handler(fakeReq({ query: { test_auth: "wrong-token" } }), res);
    assert.equal(res.captured.status, 404);
  });
});

test("404s on missing test_auth even with the env gate open", async () => {
  await withEnv({ TEST_AUTH_TOKEN: "correct-token", TEST_SESSION_TOKEN: "stx-session" }, async () => {
    const res = fakeRes();
    await handler(fakeReq({ query: {} }), res);
    assert.equal(res.captured.status, 404);
  });
});

test("405s on non-GET", async () => {
  await withEnv({ TEST_AUTH_TOKEN: "correct-token", TEST_SESSION_TOKEN: "stx-session" }, async () => {
    const res = fakeRes();
    await handler(fakeReq({ method: "POST", query: { test_auth: "correct-token" } }), res);
    assert.equal(res.captured.status, 405);
  });
});

test("503s when the bootstrap is enabled but no session is provisioned", async () => {
  await withEnv({ TEST_AUTH_TOKEN: "correct-token", TEST_SESSION_TOKEN: undefined }, async () => {
    const res = fakeRes();
    await handler(fakeReq({ query: { test_auth: "correct-token" } }), res);
    assert.equal(res.captured.status, 503);
  });
});

test("happy path returns HTML that seeds localStorage and redirects to /", async () => {
  await withEnv({ TEST_AUTH_TOKEN: "correct-token", TEST_SESSION_TOKEN: "stx-session-abc" }, async () => {
    const res = fakeRes();
    await handler(fakeReq({ query: { test_auth: "correct-token" } }), res);
    assert.equal(res.captured.status, 200);
    assert.equal(res.captured.headers["Content-Type"], "text/html; charset=utf-8");
    assert.match(res.captured.body, /localStorage\.setItem\("tinker_jwt", "stx-session-abc"\)/);
    assert.match(res.captured.body, /location\.replace\("\/"\)/);
  });
});

test("respects a safe relative next param", async () => {
  await withEnv({ TEST_AUTH_TOKEN: "correct-token", TEST_SESSION_TOKEN: "stx-session" }, async () => {
    const res = fakeRes();
    await handler(fakeReq({ query: { test_auth: "correct-token", next: "/welcome" } }), res);
    assert.equal(res.captured.status, 200);
    assert.match(res.captured.body, /location\.replace\("\/welcome"\)/);
  });
});

test("rejects open-redirect attempts in next param", async () => {
  await withEnv({ TEST_AUTH_TOKEN: "correct-token", TEST_SESSION_TOKEN: "stx-session" }, async () => {
    for (const attack of ["//evil.example", "https://evil.example", "javascript:alert(1)", "evil"]) {
      const res = fakeRes();
      await handler(fakeReq({ query: { test_auth: "correct-token", next: attack } }), res);
      assert.equal(res.captured.status, 200, `status for next=${attack}`);
      assert.match(
        res.captured.body,
        /location\.replace\("\/"\)/,
        `next=${attack} should fall back to /`,
      );
    }
  });
});

test("escapes </script> in the seeded token so HTML can't break out", async () => {
  await withEnv(
    { TEST_AUTH_TOKEN: "correct-token", TEST_SESSION_TOKEN: "abc</script><script>alert(1)" },
    async () => {
      const res = fakeRes();
      await handler(fakeReq({ query: { test_auth: "correct-token" } }), res);
      assert.equal(res.captured.status, 200);
      // The token value, once inlined, must not contain the raw breakout
      // substring — the literal </script> from the token has to be escaped
      // (the legitimate closing </script> tag of our own inline block is
      // fine and is expected to appear elsewhere in the body).
      assert.ok(
        !res.captured.body.includes("</script><script>alert(1)"),
        "token-derived </script> breakout must be escaped",
      );
      assert.match(res.captured.body, /\\u003c\/script\\u003e\\u003cscript\\u003ealert\(1\)/);
    },
  );
});

test("constant-time compare rejects tokens of different length", async () => {
  await withEnv({ TEST_AUTH_TOKEN: "abcd", TEST_SESSION_TOKEN: "stx-session" }, async () => {
    const res = fakeRes();
    await handler(fakeReq({ query: { test_auth: "abcde" } }), res);
    assert.equal(res.captured.status, 404);
  });
});
