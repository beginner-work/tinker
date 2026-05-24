/* Smoke tests for api/upload/pitch-video.js.
 *
 * The handler talks to Vercel Blob's HMAC-signed protocol and to
 * Stytch + Prisma — none of which we want to spin up in unit tests.
 * We stub stytch/db/@vercel/blob at the require cache so the handler
 * stays in-process and exercise (a) the standalone validation helpers
 * and (b) the auth + envelope dispatch in the request handler.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

let stytchUserId = "user-test-abc";
let stytchShouldThrow = null;
const stytchCalls = [];
const prismaCalls = [];
const blobCalls = [];

const stytchStub = {
  authenticateSession: async (token) => {
    stytchCalls.push(token);
    if (stytchShouldThrow) throw stytchShouldThrow;
    return { session: { user_id: stytchUserId } };
  },
};
const dbStub = {
  tinkerUserData: {
    upsert: async ({ where, create, update }) => {
      prismaCalls.push({ where, data: update.data ?? create.data });
      return { ...create, updatedAt: new Date() };
    },
  },
};

// Minimal @vercel/blob/client stub: handleUpload just routes the
// two event types through the supplied callbacks so we can assert
// our envelope dispatch + onBeforeGenerateToken validation without
// pulling in the real HMAC machinery.
const blobStub = {
  handleUpload: async ({ body, request, onBeforeGenerateToken, onUploadCompleted }) => {
    blobCalls.push({ type: body && body.type });
    if (body && body.type === "blob.generate-client-token") {
      const { pathname, clientPayload, multipart } = body.payload;
      const payload = await onBeforeGenerateToken(pathname, clientPayload, multipart);
      return { type: body.type, clientToken: `vercel_blob_client_storeXYZ_${Buffer.from(JSON.stringify(payload)).toString("base64")}` };
    }
    if (body && body.type === "blob.upload-completed") {
      if (onUploadCompleted) await onUploadCompleted(body.payload);
      return { type: body.type, response: "ok" };
    }
    throw new Error("Invalid event type");
  },
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
// @vercel/blob/client lives in node_modules — resolve it the same way
// the handler does so the cache key matches.
const blobClientPath = require.resolve("@vercel/blob/client");
stubAt(blobClientPath, blobStub);

const uploadModule = require("../api/upload/pitch-video.js");
const handler = uploadModule._raw;
const { _validatePathnameForPitch: validatePathname, _parseClientPayload: parseClientPayload } =
  uploadModule;

// Tiny req/res harness — Node's serverless function shape uses
// http-style req/res. We feed a JSON body via a Readable + ship a
// minimal res that records the status + JSON payload.
function makeReq({ method = "POST", body, headers = {}, url } = {}) {
  const payload = method === "GET" ? null : body;
  const stream = payload != null
    ? Readable.from([Buffer.from(JSON.stringify(payload))])
    : Readable.from([]);
  stream.method = method;
  stream.headers = headers;
  stream.url = url || "/api/upload/pitch-video";
  return stream;
}
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

// ── pure helpers ────────────────────────────────────────────────────

test("validatePathnameForPitch accepts a well-formed pathname", () => {
  assert.doesNotThrow(() => validatePathname("pitch-videos/p_abc123/1716000000000.webm", "p_abc123"));
});

test("validatePathnameForPitch rejects pathnames outside the prefix", () => {
  assert.throws(
    () => validatePathname("uploads/p_abc123/take.webm", "p_abc123"),
    /pitch-videos\//,
  );
});

test("validatePathnameForPitch rejects a pitchId mismatch", () => {
  assert.throws(
    () => validatePathname("pitch-videos/p_other/take.webm", "p_abc123"),
    /does not match/,
  );
});

test("validatePathnameForPitch rejects path traversal in the filename", () => {
  assert.throws(
    () => validatePathname("pitch-videos/p_abc123/../escape.webm", "p_abc123"),
    /invalid/i,
  );
});

test("validatePathnameForPitch rejects a missing filename", () => {
  assert.throws(
    () => validatePathname("pitch-videos/p_abc123/", "p_abc123"),
    /filename is invalid/,
  );
});

test("validatePathnameForPitch rejects an over-long pathname", () => {
  const long = "pitch-videos/p_abc123/" + "x".repeat(400) + ".webm";
  assert.throws(() => validatePathname(long, "p_abc123"), /too long/);
});

test("parseClientPayload requires a valid pitchId", () => {
  assert.throws(() => parseClientPayload("not-json"), /Invalid clientPayload/);
  assert.throws(() => parseClientPayload(""), /Invalid pitchId/);
  assert.throws(() => parseClientPayload(JSON.stringify({})), /Invalid pitchId/);
  assert.throws(() => parseClientPayload(JSON.stringify({ pitchId: "bad pitch id!" })), /Invalid pitchId/);
  assert.deepEqual(parseClientPayload(JSON.stringify({ pitchId: "p_abc123" })), { pitchId: "p_abc123" });
});

// ── handler dispatch ────────────────────────────────────────────────

test("handler rejects unsupported methods", async () => {
  const req = makeReq({ method: "DELETE", body: {} });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, POST");
});

test("GET requires a valid pitchId in the query string", async () => {
  const req = makeReq({
    method: "GET",
    headers: { authorization: "Bearer session-token-abc" },
    url: "/api/upload/pitch-video",
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /pitchId/);
});

test("GET returns the saved take when one exists", async () => {
  // Seed the fake store by going through the upload-completed leg.
  prismaCalls.length = 0;
  const savedRow = {
    url: "https://blob.example.com/pitch-videos/p_abc123/take.webm",
    downloadUrl: "https://blob.example.com/pitch-videos/p_abc123/take.webm?download=1",
    pathname: "pitch-videos/p_abc123/take.webm",
    contentType: "video/webm",
    uploadedAt: 1716000000000,
  };
  // Patch the stub for this one test so the GET sees a row.
  const origUpsert = dbStub.tinkerUserData.upsert;
  let upserted = null;
  dbStub.tinkerUserData.upsert = async (args) => {
    upserted = { args, row: { userId: "user-test-abc", kind: "pitch-video:p_abc123", data: savedRow, updatedAt: new Date() } };
    return upserted.row;
  };
  const origFindUnique = dbStub.tinkerUserData.findUnique;
  dbStub.tinkerUserData.findUnique = async ({ where: { userId_kind: { userId, kind } } }) => {
    if (upserted && userId === "user-test-abc" && kind === "pitch-video:p_abc123") {
      return upserted.row;
    }
    return null;
  };

  // Trigger an upload-completed first to populate the row.
  const postReq = makeReq({
    body: {
      type: "blob.upload-completed",
      payload: {
        blob: savedRow,
        tokenPayload: JSON.stringify({ userId: "user-test-abc", pitchId: "p_abc123" }),
      },
    },
  });
  await handler(postReq, makeRes());

  // Now GET.
  const getReq = makeReq({
    method: "GET",
    headers: { authorization: "Bearer session-token-abc" },
    url: "/api/upload/pitch-video?pitchId=p_abc123",
  });
  const getRes = makeRes();
  await handler(getReq, getRes);
  assert.equal(getRes.statusCode, 200, JSON.stringify(getRes.body));
  assert.equal(getRes.body.data.url, savedRow.url);
  assert.equal(getRes.body.data.contentType, "video/webm");

  // Restore stubs.
  dbStub.tinkerUserData.upsert = origUpsert;
  dbStub.tinkerUserData.findUnique = origFindUnique;
});

test("GET returns null when no take has been saved", async () => {
  const origFindUnique = dbStub.tinkerUserData.findUnique;
  dbStub.tinkerUserData.findUnique = async () => null;
  const req = makeReq({
    method: "GET",
    headers: { authorization: "Bearer session-token-abc" },
    url: "/api/upload/pitch-video?pitchId=p_neverr",
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data, null);
  dbStub.tinkerUserData.findUnique = origFindUnique;
});

test("handler requires a bearer token for blob.generate-client-token", async () => {
  stytchShouldThrow = Object.assign(new Error("Missing token."), { status: 401 });
  const req = makeReq({
    body: {
      type: "blob.generate-client-token",
      payload: { pathname: "pitch-videos/p_abc123/x.webm", clientPayload: JSON.stringify({ pitchId: "p_abc123" }), multipart: false },
    },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  stytchShouldThrow = null;
});

test("handler issues a client token when the envelope + auth check out", async () => {
  blobCalls.length = 0;
  const req = makeReq({
    headers: { authorization: "Bearer session-token-abc" },
    body: {
      type: "blob.generate-client-token",
      payload: {
        pathname: "pitch-videos/p_abc123/take-1.webm",
        clientPayload: JSON.stringify({ pitchId: "p_abc123" }),
        multipart: false,
      },
    },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.type, "blob.generate-client-token");
  assert.ok(String(res.body.clientToken).startsWith("vercel_blob_client_"));
  assert.deepEqual(blobCalls, [{ type: "blob.generate-client-token" }]);
});

test("handler rejects a token request whose pathname doesn't match the pitchId", async () => {
  const req = makeReq({
    headers: { authorization: "Bearer session-token-abc" },
    body: {
      type: "blob.generate-client-token",
      payload: {
        pathname: "pitch-videos/p_other/take.webm",
        clientPayload: JSON.stringify({ pitchId: "p_abc123" }),
        multipart: false,
      },
    },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /does not match/);
});

test("handler upserts a row on blob.upload-completed", async () => {
  prismaCalls.length = 0;
  const req = makeReq({
    body: {
      type: "blob.upload-completed",
      payload: {
        blob: {
          url: "https://blob.example.com/pitch-videos/p_abc123/take-1.webm",
          downloadUrl: "https://blob.example.com/pitch-videos/p_abc123/take-1.webm?download=1",
          pathname: "pitch-videos/p_abc123/take-1.webm",
          contentType: "video/webm",
        },
        tokenPayload: JSON.stringify({ userId: "user-test-abc", pitchId: "p_abc123" }),
      },
    },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(prismaCalls.length, 1);
  const call = prismaCalls[0];
  assert.equal(call.where.userId_kind.userId, "user-test-abc");
  assert.equal(call.where.userId_kind.kind, "pitch-video:p_abc123");
  assert.equal(call.data.url, "https://blob.example.com/pitch-videos/p_abc123/take-1.webm");
  assert.equal(call.data.contentType, "video/webm");
});
