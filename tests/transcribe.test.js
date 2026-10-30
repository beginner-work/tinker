/* Unit tests for POST /api/transcribe and the TinkerVoice widget. */

"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const transcribe = require("../api/_lib/transcribe.js");
const { createHandler } = require("../api/transcribe.js");
const TinkerVoice = require("../src/renderer/voice/tinker-voice.js");

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
    end() { this.ended = true; return this; },
  };
}

function buildMultipart(fields) {
  const boundary = "----tinkerTestBoundary7MA4YWxk";
  const chunks = [];
  for (const field of fields) {
    chunks.push(`--${boundary}\r\n`);
    if (field.filename) {
      chunks.push(
        `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n`,
      );
      chunks.push(`Content-Type: ${field.contentType || "application/octet-stream"}\r\n\r\n`);
      chunks.push(field.body);
      chunks.push("\r\n");
    } else {
      chunks.push(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n`);
      chunks.push(String(field.body));
      chunks.push("\r\n");
    }
  }
  chunks.push(`--${boundary}--\r\n`);
  const parts = chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c, "utf8")));
  return {
    buffer: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("transcribe helpers", () => {
  test("normalizeWords keeps timestamps and drops junk", () => {
    assert.deepEqual(
      transcribe.normalizeWords([
        { text: "hi", start: 0, end: 0.2, type: "word" },
        { text: " ", start: 0.2, end: 0.25, type: "spacing" },
        null,
        "nope",
      ]),
      [
        { text: "hi", start: 0, end: 0.2, type: "word" },
        { text: " ", start: 0.2, end: 0.25, type: "spacing" },
      ],
    );
  });

  test("durationMsFromWords uses the last end time", () => {
    assert.equal(transcribe.durationMsFromWords([]), null);
    assert.equal(
      transcribe.durationMsFromWords([
        { text: "a", start: 0, end: 0.4 },
        { text: "b", start: 0.4, end: 1.25 },
      ]),
      1250,
    );
  });

  test("parseMultipart extracts the audio file field", async () => {
    const audio = Buffer.from([1, 2, 3, 4, 5]);
    const { buffer, contentType } = buildMultipart([
      {
        name: "audio",
        filename: "clip.webm",
        contentType: "audio/webm",
        body: audio,
      },
    ]);
    const req = {
      headers: { "content-type": contentType },
      body: buffer,
    };
    const parsed = await transcribe.parseAudioUpload(req);
    assert.equal(parsed.mimeType, "audio/webm");
    assert.equal(parsed.byteLength, 5);
    assert.ok(Buffer.compare(parsed.buffer, audio) === 0);
  });

  test("parseAudioUpload rejects unsupported types", async () => {
    const req = {
      headers: { "content-type": "text/plain" },
      body: Buffer.from("hello"),
    };
    await assert.rejects(() => transcribe.parseAudioUpload(req), /Unsupported/);
  });

  test("callElevenLabsStt posts multipart and returns shaped result", async () => {
    const prev = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = "el_test_key";
    let seenUrl = "";
    let seenKey = "";
    const fetchFn = async (url, opts) => {
      seenUrl = url;
      seenKey = opts.headers["xi-api-key"];
      assert.ok(opts.body);
      return {
        ok: true,
        headers: { get: (name) => (name === "request-id" ? "el-req-1" : null) },
        json: async () => ({
          text: "hello there",
          words: [
            { text: "hello", start: 0, end: 0.3, type: "word" },
            { text: " ", start: 0.3, end: 0.35, type: "spacing" },
            { text: "there", start: 0.35, end: 0.7, type: "word" },
          ],
        }),
      };
    };
    const out = await transcribe.callElevenLabsStt({
      buffer: Buffer.from([0, 1, 2]),
      mimeType: "audio/webm",
      fetchFn,
    });
    assert.equal(seenUrl, "https://api.elevenlabs.io/v1/speech-to-text");
    assert.equal(seenKey, "el_test_key");
    assert.equal(out.text, "hello there");
    assert.equal(out.durationMs, 700);
    assert.equal(out.elevenLabsRequestId, "el-req-1");
    assert.equal(out.words.length, 3);
    if (prev == null) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = prev;
  });

  test("logTranscription writes a usage row", async () => {
    const rows = [];
    const fakePrisma = {
      transcriptionRequest: {
        create: async ({ data }) => {
          rows.push(data);
          return data;
        },
      },
    };
    await transcribe.logTranscription(fakePrisma, {
      id: "req-1",
      caller: "service:lindowlabs.dev",
      status: "ok",
      latencyMs: 42,
      durationMs: 700,
      mimeType: "audio/webm",
      byteLength: 12,
      text: "hello",
      words: [{ text: "hello", start: 0, end: 0.3 }],
      error: "",
      elevenLabsRequestId: "el-1",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "req-1");
    assert.equal(rows[0].caller, "service:lindowlabs.dev");
    assert.equal(rows[0].text, "hello");
  });
});

describe("POST /api/transcribe route", () => {
  let prevToken;
  let prevKey;

  beforeEach(() => {
    prevToken = process.env.TINKER_SERVICE_TOKEN;
    prevKey = process.env.ELEVENLABS_API_KEY;
    process.env.TINKER_SERVICE_TOKEN = "test-service-token";
    process.env.ELEVENLABS_API_KEY = "el_test_key";
  });

  afterEach(() => {
    if (prevToken == null) delete process.env.TINKER_SERVICE_TOKEN;
    else process.env.TINKER_SERVICE_TOKEN = prevToken;
    if (prevKey == null) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = prevKey;
  });

  test("rejects missing auth with 401", async () => {
    const handler = createHandler({
      logTranscription: async () => null,
      parseAudioUpload: async () => ({ buffer: Buffer.from([1]), mimeType: "audio/webm", byteLength: 1 }),
      callElevenLabsStt: async () => ({ text: "x", words: [], durationMs: 1, elevenLabsRequestId: "" }),
    });
    const res = mockRes();
    await handler({ method: "POST", headers: {}, url: "/api/transcribe" }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "Unauthorized");
    assert.ok(res.body.requestId);
  });

  test("rejects wrong service token", async () => {
    const handler = createHandler({
      logTranscription: async () => null,
    });
    const res = mockRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
      url: "/api/transcribe",
    }, res);
    assert.equal(res.statusCode, 401);
  });

  test("503 when TINKER_SERVICE_TOKEN unset and no session", async () => {
    delete process.env.TINKER_SERVICE_TOKEN;
    const handler = createHandler({
      logTranscription: async () => null,
      authenticateSession: async () => { throw new Error("bad"); },
    });
    const res = mockRes();
    await handler({ method: "POST", headers: {}, url: "/api/transcribe" }, res);
    assert.equal(res.statusCode, 503);
    assert.match(String(res.body.error), /TINKER_SERVICE_TOKEN/);
  });

  test("happy path with service token mocks ElevenLabs and logs", async () => {
    const logs = [];
    const audio = Buffer.from([9, 9, 9]);
    const { buffer, contentType } = buildMultipart([
      { name: "audio", filename: "a.webm", contentType: "audio/webm", body: audio },
    ]);
    const handler = createHandler({
      newRequestId: () => "fixed-request-id",
      callElevenLabsStt: async ({ buffer: buf, mimeType }) => {
        assert.equal(mimeType, "audio/webm");
        assert.equal(buf.length, 3);
        return {
          text: "spoken question",
          words: [{ text: "spoken", start: 0, end: 0.4, type: "word" }],
          durationMs: 400,
          elevenLabsRequestId: "el-abc",
        };
      },
      logTranscription: async (_prisma, row) => { logs.push(row); },
      authenticateSession: async () => { throw new Error("should not use session"); },
    });
    const res = mockRes();
    await handler({
      method: "POST",
      headers: {
        authorization: "Bearer test-service-token",
        "content-type": contentType,
        "x-tinker-caller": "lindowlabs.dev",
      },
      body: buffer,
      url: "/api/transcribe",
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, "spoken question");
    assert.equal(res.body.requestId, "fixed-request-id");
    assert.equal(res.body.durationMs, 400);
    assert.equal(res.body.words.length, 1);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, "ok");
    assert.equal(logs[0].caller, "service:lindowlabs.dev");
    assert.equal(logs[0].text, "spoken question");
    assert.equal(logs[0].elevenLabsRequestId, "el-abc");
  });

  test("accepts X-Tinker-Service-Token header", async () => {
    const handler = createHandler({
      newRequestId: () => "hdr-id",
      parseAudioUpload: async () => ({
        buffer: Buffer.from([1]),
        mimeType: "audio/wav",
        byteLength: 1,
      }),
      callElevenLabsStt: async () => ({
        text: "ok",
        words: [],
        durationMs: null,
        elevenLabsRequestId: "",
      }),
      logTranscription: async () => null,
    });
    const res = mockRes();
    await handler({
      method: "POST",
      headers: { "x-tinker-service-token": "test-service-token" },
      url: "/api/transcribe",
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, "ok");
  });

  test("accepts Stytch session for Tinker UI", async () => {
    const logs = [];
    const handler = createHandler({
      newRequestId: () => "session-id",
      authenticateSession: async (token) => {
        assert.equal(token, "stytch-session-jwt");
        return { session: { user_id: "user-live-abc" } };
      },
      parseAudioUpload: async () => ({
        buffer: Buffer.from([1]),
        mimeType: "audio/webm",
        byteLength: 1,
      }),
      callElevenLabsStt: async () => ({
        text: "from ui",
        words: [],
        durationMs: 100,
        elevenLabsRequestId: "",
      }),
      logTranscription: async (_p, row) => { logs.push(row); },
    });
    const res = mockRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer stytch-session-jwt" },
      url: "/api/transcribe",
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, "from ui");
    assert.equal(logs[0].caller, "user:user-live-abc");
  });

  test("logs error rows when ElevenLabs fails", async () => {
    const logs = [];
    const handler = createHandler({
      newRequestId: () => "err-id",
      parseAudioUpload: async () => ({
        buffer: Buffer.from([1]),
        mimeType: "audio/webm",
        byteLength: 1,
      }),
      callElevenLabsStt: async () => {
        const err = new Error("ElevenLabs STT 500");
        err.status = 502;
        err.elevenLabsRequestId = "el-fail";
        throw err;
      },
      logTranscription: async (_p, row) => { logs.push(row); },
    });
    const res = mockRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer test-service-token" },
      url: "/api/transcribe",
    }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.requestId, "err-id");
    assert.equal(logs[0].status, "error");
    assert.equal(logs[0].elevenLabsRequestId, "el-fail");
  });

  test("GET is method not allowed", async () => {
    const handler = createHandler({ logTranscription: async () => null });
    const res = mockRes();
    await handler({ method: "GET", headers: {}, url: "/api/transcribe" }, res);
    assert.equal(res.statusCode, 405);
  });
});

describe("TinkerVoice widget", () => {
  test("create requires onTranscript and endpoint", () => {
    assert.throws(() => TinkerVoice.create({ endpoint: "/x" }), /onTranscript/);
    assert.throws(
      () => TinkerVoice.create({ onTranscript() {}, endpoint: "" }),
      /endpoint/,
    );
  });

  test("create returns start/stop/destroy/getState", () => {
    const rec = TinkerVoice.create({
      endpoint: "/api/voice-proxy",
      onTranscript() {},
    });
    assert.equal(typeof rec.start, "function");
    assert.equal(typeof rec.stop, "function");
    assert.equal(typeof rec.destroy, "function");
    assert.equal(rec.getState(), "idle");
    rec.destroy();
  });

  test("extension helper maps mime types", () => {
    assert.equal(TinkerVoice._extensionForMime("audio/webm;codecs=opus"), "webm");
    assert.equal(TinkerVoice._extensionForMime("audio/ogg"), "ogg");
    assert.equal(TinkerVoice._extensionForMime("audio/mp4"), "mp4");
  });

  test("settings page mounts the widget script and section", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "../src/renderer/settings/index.html"),
      "utf8",
    );
    const js = fs.readFileSync(
      path.join(__dirname, "../src/renderer/settings/settings.js"),
      "utf8",
    );
    assert.match(html, /voice\/tinker-voice\.js/);
    assert.match(html, /data-tinker-voice-mount/);
    assert.match(js, /TinkerVoice\.create/);
    assert.match(js, /\/api\/transcribe/);
    const voiceSection = html.slice(html.indexOf("settings-voice-heading"));
    const voiceBlock = voiceSection.slice(0, voiceSection.indexOf("settings-webhook-heading"));
    assert.equal(/[—–]/.test(voiceBlock), false, "no em dashes in voice settings copy");
  });

  test("README documents endpoint, env vars, and embed API", () => {
    const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
    const start = readme.indexOf("## Voice transcription");
    const end = readme.indexOf("## Grounded ask");
    const section = readme.slice(start, end > start ? end : readme.indexOf("## Debugging preview deploys"));
    assert.match(section, /POST \/api\/transcribe/);
    assert.match(section, /TINKER_SERVICE_TOKEN/);
    assert.match(section, /ELEVENLABS_API_KEY/);
    assert.match(section, /TinkerVoice\.create/);
    assert.match(section, /lindowlabs\.dev/);
    assert.equal(/[—–]/.test(section), false, "no em dashes in voice README section");
  });

  test("env example lists the new vars", () => {
    const env = fs.readFileSync(path.join(__dirname, "../.env.example"), "utf8");
    assert.match(env, /TINKER_SERVICE_TOKEN=/);
    assert.match(env, /ELEVENLABS_STT_MODEL=/);
  });

  test("prisma schema includes TranscriptionRequest", () => {
    const schema = fs.readFileSync(path.join(__dirname, "../prisma/schema.prisma"), "utf8");
    assert.match(schema, /model TranscriptionRequest/);
  });
});
