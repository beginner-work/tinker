/* Unit tests for POST /api/ask and the grounded-answer helpers. */

"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ask = require("../api/_lib/ask.js");
const sources = require("../api/_lib/ask-sources/index.js");
const { createHandler } = require("../api/ask.js");

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    ended: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

describe("ask source corpus", () => {
  test("loads lindowlabs-minds-and-models with talk + writing", () => {
    const source = sources.loadSource("lindowlabs-minds-and-models");
    assert.ok(source);
    assert.equal(source.id, "lindowlabs-minds-and-models");
    assert.equal(source.voiceId, "JlYdFGRHWwlz51Zh5K2n");
    assert.match(source.label, /Tyler/i);
    assert.ok(source.docs.length >= 4);
    assert.ok(source.corpusText.includes("Minds and Models"));
    assert.ok(source.corpusText.includes("What would you build"));
    assert.ok(source.systemPrompt.includes("CORPUS"));
    assert.ok(source.systemPrompt.includes("LinkedIn"));
  });

  test("rejects unknown or path-traversal sourceIds", () => {
    assert.equal(sources.loadSource("nope"), null);
    assert.equal(sources.loadSource("../ask"), null);
    assert.equal(sources.loadSource(""), null);
  });
});

describe("ask helpers", () => {
  test("parseAskBody requires question, input, sourceId", () => {
    assert.throws(() => ask.parseAskBody({}), /question/);
    assert.throws(
      () => ask.parseAskBody({ question: "hi", input: "typed" }),
      /sourceId/,
    );
    assert.throws(
      () => ask.parseAskBody({ question: "hi", input: "chat", sourceId: "x" }),
      /voice|typed/,
    );
    const ok = ask.parseAskBody({
      question: " What is this? ",
      input: "voice",
      sourceId: "lindowlabs-minds-and-models",
      rawTranscript: "what is this",
      position: { wordIndex: 12, paragraph: 2, timestampMs: 1500 },
    });
    assert.equal(ok.question, "What is this?");
    assert.equal(ok.input, "voice");
    assert.deepEqual(ok.position, { wordIndex: 12, paragraph: 2, timestampMs: 1500 });
  });

  test("positionHint surfaces nearby talk paragraphs", () => {
    const source = sources.loadSource("lindowlabs-minds-and-models");
    const hint = ask.positionHint(source, { paragraph: 0 });
    assert.match(hint, /Tyler Lindow/);
    assert.match(hint, /Nearby talk/);
  });

  test("fallbackUnknownAnswer points at LinkedIn", () => {
    assert.match(ask.fallbackUnknownAnswer(), /linkedin\.com\/in\/tlindow/);
  });
});

describe("POST /api/ask route", () => {
  let prevToken;
  let prevAnthropic;
  let prevEleven;

  beforeEach(() => {
    prevToken = process.env.TINKER_SERVICE_TOKEN;
    prevAnthropic = process.env.ANTHROPIC_API_KEY;
    prevEleven = process.env.ELEVENLABS_API_KEY;
    process.env.TINKER_SERVICE_TOKEN = "test-service-token";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ELEVENLABS_API_KEY = "el_test_key";
  });

  afterEach(() => {
    if (prevToken == null) delete process.env.TINKER_SERVICE_TOKEN;
    else process.env.TINKER_SERVICE_TOKEN = prevToken;
    if (prevAnthropic == null) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    if (prevEleven == null) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = prevEleven;
  });

  test("rejects missing auth", async () => {
    const handler = createHandler({
      prisma: { askRequest: { create: async () => null } },
    });
    const res = mockRes();
    await handler({ method: "POST", headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 401);
  });

  test("happy path with service token, Claude + TTS mocks", async () => {
    const logs = [];
    const handler = createHandler({
      prisma: {
        askRequest: {
          create: async ({ data }) => {
            logs.push(data);
            return data;
          },
        },
      },
      answerWithClaude: async () => ({
        answerText: "I think we're under-investing in human learning today.",
        model: "claude-haiku-4-5-20251001",
      }),
      speakAnswer: async () => ({
        audioBase64: Buffer.from("fake-mp3").toString("base64"),
        contentType: "audio/mpeg",
        voiceId: "JlYdFGRHWwlz51Zh5K2n",
      }),
    });

    const res = mockRes();
    await handler(
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-service-token",
          "x-tinker-caller": "lindowlabs.dev",
          "content-type": "application/json",
        },
        body: {
          question: "Are we still learning?",
          input: "typed",
          sourceId: "lindowlabs-minds-and-models",
          position: { paragraph: 4 },
        },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.answerText, "I think we're under-investing in human learning today.");
    assert.ok(res.body.audio);
    assert.ok(res.body.requestId);
    assert.equal(typeof res.body.latencyMs, "number");
    assert.match(res.body.label, /Tyler/i);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].caller, "service:lindowlabs.dev");
    assert.equal(logs[0].status, "ok");
    assert.equal(logs[0].hasAudio, true);
    assert.equal(logs[0].sourceId, "lindowlabs-minds-and-models");
    assert.equal(logs[0].inputType, "typed");
    assert.equal(logs[0].editedTranscript, "Are we still learning?");
  });

  test("unknown sourceId returns 404 and logs error", async () => {
    const logs = [];
    const handler = createHandler({
      prisma: {
        askRequest: {
          create: async ({ data }) => {
            logs.push(data);
            return data;
          },
        },
      },
    });
    const res = mockRes();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer test-service-token" },
        body: {
          question: "hi",
          input: "typed",
          sourceId: "missing-source",
        },
      },
      res,
    );
    assert.equal(res.statusCode, 404);
    assert.equal(logs[0].status, "error");
    assert.match(logs[0].error, /Unknown sourceId/);
  });

  test("OPTIONS is allowed", async () => {
    const handler = createHandler({});
    const res = mockRes();
    await handler({ method: "OPTIONS", headers: {} }, res);
    assert.equal(res.statusCode, 204);
    assert.match(res.headers["Access-Control-Allow-Headers"], /X-Tinker-Caller/);
  });
});

describe("ask docs + eval contracts", () => {
  test("prisma schema includes AskRequest", () => {
    const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
    assert.match(schema, /model AskRequest/);
    assert.match(schema, /hasAudio/);
    assert.match(schema, /rawTranscript/);
  });

  test("ten eval cases exist and name the seeded source", () => {
    const dir = path.join(__dirname, "..", "evals", "ask", "cases");
    const files = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
    assert.equal(files.length, 10);
    for (const name of files) {
      const c = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      assert.equal(c.sourceId, "lindowlabs-minds-and-models");
      assert.ok(c.question);
      assert.ok(c.expect);
    }
  });

  test("README documents POST /api/ask", () => {
    const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
    assert.match(readme, /POST \/api\/ask/);
    assert.match(readme, /lindowlabs-minds-and-models/);
    assert.match(readme, /ANTHROPIC_API_KEY/);
    assert.match(readme, /JlYdFGRHWwlz51Zh5K2n/);
  });

  test(".env.example lists ASK_MODEL", () => {
    const env = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
    assert.match(env, /ASK_MODEL=/);
  });
});
