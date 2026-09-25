/* Tests for api/_lib/log.js — the response-body logger that fires in
 * the preview environment. We don't have a real Vercel res object here,
 * so we stub the bits the wrapper touches (statusCode + .json).
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { withResponseLogging } = require("../api/_lib/log.js");

function fakeReq({ method = "GET", url = "/api/x" } = {}) {
  return { method, url, headers: {} };
}
function fakeRes() {
  const captured = { status: null, body: null };
  return {
    captured,
    statusCode: 200,
    status(s) {
      this.statusCode = s;
      captured.status = s;
      return this;
    },
    json(b) {
      captured.body = b;
      return this;
    },
  };
}

function captureConsole(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = orig;
    })
    .then(() => lines);
}

test("non-preview env does not log", async () => {
  const prev = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    const handler = withResponseLogging((req, res) => {
      res.status(200).json({ ok: true });
    });
    const lines = await captureConsole(() => handler(fakeReq(), fakeRes()));
    assert.equal(lines.length, 0);
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
});

test("preview env logs method, url, status, and body", async () => {
  const prev = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    const handler = withResponseLogging((req, res) => {
      res.status(201).json({ hello: "world" });
    });
    const lines = await captureConsole(() =>
      handler(fakeReq({ method: "POST", url: "/api/example" }), fakeRes()),
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[preview\] POST \/api\/example 201/);
    assert.match(lines[0], /\{"hello":"world"\}/);
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
});

test("preview env truncates very large bodies", async () => {
  const prev = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    const handler = withResponseLogging((req, res) => {
      res.status(200).json({ blob: "x".repeat(20 * 1024) });
    });
    const lines = await captureConsole(() => handler(fakeReq(), fakeRes()));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /…\[truncated\]$/);
    // Header + 8 KB body + suffix — well under 20 KB.
    assert.ok(lines[0].length < 12 * 1024);
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
});

test("preview logs omit your_user_id while the response keeps it", async () => {
  const prev = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    const res = fakeRes();
    const handler = withResponseLogging((req, r) => {
      r.status(403).json({
        error: "Not allowed to change autonomy.",
        your_user_id: "user-live-not-in-logs",
      });
    });
    const lines = await captureConsole(() => handler(fakeReq({ method: "PUT" }), res));
    assert.equal(lines.join("\n").includes("user-live-not-in-logs"), false);
    assert.deepEqual(res.captured.body, {
      error: "Not allowed to change autonomy.",
      your_user_id: "user-live-not-in-logs",
    });
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
});

test("preview logs redact career facts and checked text", async () => {
  const prev = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    const excerpt = "Grew the developer-support engineering function from 1 to 9 engineers";
    const draft = "I grew the team from 1 to 12.";
    const res = fakeRes();
    const handler = withResponseLogging((req, r) => {
      r.status(200).json({
        result: {
          content: [{ type: "text", text: JSON.stringify({ verified_facts: [{ excerpt }] }) }],
          structuredContent: {
            ready: false,
            claims: [{ text: draft, verdict: "mismatch", correct: "1 to 9" }],
          },
        },
      });
    });
    const lines = await captureConsole(() => handler(fakeReq({ method: "POST", url: "/api/mcp" }), res));
    assert.equal(lines.join("\n").includes(excerpt), false);
    assert.equal(lines.join("\n").includes(draft), false);
    assert.equal(lines.join("\n").includes("1 to 9"), false);
    assert.match(lines[0], /"redacted":"career"/);
    assert.equal(res.captured.body.result.structuredContent.claims[0].text, draft);
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
});

test("response body still reaches res.json (logging is a side effect)", async () => {
  const prev = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    const res = fakeRes();
    const handler = withResponseLogging((req, r) => {
      r.status(200).json({ ok: true });
    });
    await captureConsole(() => handler(fakeReq(), res));
    assert.deepEqual(res.captured.body, { ok: true });
    assert.equal(res.captured.status, 200);
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
});
