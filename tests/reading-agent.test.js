/* Unit tests for the reading agent: page fetch helpers, session/speak/ask
 * routes, tool-use allowlist, resume cursor, and metrics aggregation.
 * No live network; fetch and Claude/TTS are injected.
 */

"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fetchPage = require("../api/_lib/fetch-page.js");
const reading = require("../api/_lib/reading-agent.js");
const { createHandler } = require("../api/reading.js");

const BANNED = "JlYdFGRHWwlz51Zh5K2n";
const SAMPLE_HTML = `<!doctype html><html><head>
<title>How Acme Redesigned On-Call</title>
<meta name="author" content="Jordan Lee" />
<meta property="og:title" content="How Acme Redesigned On-Call" />
</head><body>
<article>
<p>Acme's platform team rebuilt on-call around three rules. First, every page must name a single owner service.</p>
<p>Second, runbooks live next to the service repo. Third, handoff notes are written before the shift ends.</p>
<p>See the <a href="/blog/paging-policy">paging policy</a> for weekend rules.</p>
</article>
</body></html>`;

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

function mockFetchHtml(html, finalUrl) {
  return async () => ({
    ok: true,
    status: 200,
    url: finalUrl || "https://engineering.acme-example.test/blog/oncall-rotation",
    headers: { get: () => "text/html; charset=utf-8" },
    arrayBuffer: async () => Buffer.from(html, "utf8"),
  });
}

describe("fetch-page helpers", () => {
  test("assertPublicHttpUrl blocks localhost and credentials", () => {
    assert.throws(() => fetchPage.assertPublicHttpUrl("http://localhost/x"), /not allowed|valid/);
    assert.throws(
      () => fetchPage.assertPublicHttpUrl("https://user:pass@example.com/"),
      /credentials/,
    );
    assert.throws(() => fetchPage.assertPublicHttpUrl("ftp://example.com/"), /http/);
    const ok = fetchPage.assertPublicHttpUrl("https://engineering.acme-example.test/a");
    assert.equal(ok.hostname, "engineering.acme-example.test");
  });

  test("extracts title, author, text, and links from HTML", async () => {
    const page = await fetchPage.fetchPage(
      "https://engineering.acme-example.test/blog/oncall-rotation",
      {
        fetchFn: mockFetchHtml(SAMPLE_HTML),
        lookupFn: async () => {},
      },
    );
    assert.equal(page.title, "How Acme Redesigned On-Call");
    assert.equal(page.author, "Jordan Lee");
    assert.match(page.text, /three rules/);
    assert.ok(page.links.some((l) => /paging-policy/.test(l.url)));
    assert.ok(page.wordCount > 20);
  });

  test("isPrivateIp covers RFC1918 and link-local", () => {
    assert.equal(fetchPage.isPrivateIp("10.0.0.1"), true);
    assert.equal(fetchPage.isPrivateIp("192.168.1.1"), true);
    assert.equal(fetchPage.isPrivateIp("172.16.0.1"), true);
    assert.equal(fetchPage.isPrivateIp("169.254.1.1"), true);
    assert.equal(fetchPage.isPrivateIp("8.8.8.8"), false);
  });
});

describe("reading-agent helpers", () => {
  test("readingVoiceId never returns Tyler's personal voice", () => {
    const prev = process.env.READING_VOICE_ID;
    process.env.READING_VOICE_ID = BANNED;
    try {
      assert.notEqual(reading.readingVoiceId(), BANNED);
      assert.equal(reading.readingVoiceId(), reading.DEFAULT_VOICE_ID);
    } finally {
      if (prev == null) delete process.env.READING_VOICE_ID;
      else process.env.READING_VOICE_ID = prev;
    }
  });

  test("chunkTextFromWord resumes from a word index", () => {
    const words = [];
    for (let i = 0; i < 80; i++) words.push(`word${i}`);
    const text = words.join(" ");
    const a = reading.chunkTextFromWord(text, 0, 40);
    assert.equal(a.fromWordIndex, 0);
    assert.ok(a.toWordIndex > 0);
    assert.ok(a.toWordIndex < 80);
    const b = reading.chunkTextFromWord(text, a.toWordIndex, 40);
    assert.equal(b.fromWordIndex, a.toWordIndex);
    assert.ok(b.chunkText.length > 0);
  });

  test("linkAllowed only permits outbound article links", () => {
    const links = [{ url: "https://example.test/a", text: "a" }];
    assert.equal(reading.linkAllowed(links, "https://example.test/a"), true);
    assert.equal(reading.linkAllowed(links, "https://evil.test/x"), false);
  });

  test("answerReadingQuestion can fetch a linked source via tool use", async () => {
    const calls = [];
    const answered = await reading.answerReadingQuestion({
      title: "How Acme Redesigned On-Call",
      author: "Jordan Lee",
      sourceUrl: "https://engineering.acme-example.test/blog/oncall-rotation",
      text: "Acme rebuilt on-call. See the paging policy link for weekend rules.",
      links: [
        {
          url: "https://engineering.acme-example.test/blog/paging-policy",
          text: "paging policy",
        },
      ],
      question: "What does the linked paging policy say about weekend pages?",
      input: "typed",
      position: { wordIndex: 10 },
      callClaude: async (args) => {
        calls.push(args);
        if (calls.length === 1) {
          return {
            text: "",
            toolUse: {
              id: "toolu_1",
              name: "fetch_linked_source",
              input: {
                url: "https://engineering.acme-example.test/blog/paging-policy",
              },
            },
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "fetch_linked_source",
                input: {
                  url: "https://engineering.acme-example.test/blog/paging-policy",
                },
              },
            ],
          };
        }
        return {
          text: "Weekend pages need a customer impact tag, according to the paging policy.",
          toolUse: null,
          content: [
            {
              type: "text",
              text: "Weekend pages need a customer impact tag, according to the paging policy.",
            },
          ],
        };
      },
      fetchPageFn: async (url) => ({
        sourceUrl: url,
        title: "Paging Policy",
        author: "Sam Ortiz",
        text: "Weekend pages require a customer impact tag.",
        paragraphs: [],
        wordCount: 7,
        links: [],
      }),
    });
    assert.equal(answered.toolUsed, true);
    assert.match(answered.fetchedSourceUrl, /paging-policy/);
    assert.match(answered.answerText, /customer impact/i);
    assert.equal(answered.answerText.includes("\u2014"), false);
    assert.equal(calls.length, 2);
  });
});

describe("POST /api/reading route", () => {
  let prevToken;
  let prevAnthropic;
  let prevEleven;
  let prevPublic;

  beforeEach(() => {
    prevToken = process.env.TINKER_SERVICE_TOKEN;
    prevAnthropic = process.env.ANTHROPIC_API_KEY;
    prevEleven = process.env.ELEVENLABS_API_KEY;
    prevPublic = process.env.READING_PUBLIC_SESSIONS;
    process.env.TINKER_SERVICE_TOKEN = "test-reading-token";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    process.env.ELEVENLABS_API_KEY = "test-eleven";
    process.env.READING_PUBLIC_SESSIONS = "1";
  });

  afterEach(() => {
    if (prevToken == null) delete process.env.TINKER_SERVICE_TOKEN;
    else process.env.TINKER_SERVICE_TOKEN = prevToken;
    if (prevAnthropic == null) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    if (prevEleven == null) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = prevEleven;
    if (prevPublic == null) delete process.env.READING_PUBLIC_SESSIONS;
    else process.env.READING_PUBLIC_SESSIONS = prevPublic;
    reading.clearCachedText && reading.clearCachedText();
  });

  function memoryPrisma() {
    const sessions = new Map();
    const questions = [];
    const clicks = [];
    return {
      readingSession: {
        async create({ data }) {
          sessions.set(data.id, { ...data });
          return data;
        },
        async findUnique({ where }) {
          return sessions.get(where.id) || null;
        },
        async update({ where, data }) {
          const row = sessions.get(where.id);
          Object.assign(row, data);
          return row;
        },
        async count() {
          return sessions.size;
        },
        async groupBy() {
          const by = {};
          for (const s of sessions.values()) {
            by[s.companyHost] = (by[s.companyHost] || 0) + 1;
          }
          return Object.entries(by).map(([companyHost, n]) => ({
            companyHost,
            _count: { _all: n },
          }));
        },
      },
      readingQuestion: {
        async create({ data }) {
          questions.push(data);
          return data;
        },
        async count(args) {
          if (args && args.where && args.where.fetchedSource) {
            return questions.filter((q) => q.fetchedSource).length;
          }
          return questions.length;
        },
        async aggregate() {
          if (!questions.length) return { _avg: { latencyMs: 0 } };
          const sum = questions.reduce((a, q) => a + (q.latencyMs || 0), 0);
          return { _avg: { latencyMs: sum / questions.length } };
        },
      },
      readingClick: {
        async create({ data }) {
          clicks.push(data);
          return data;
        },
        async groupBy() {
          const by = {};
          for (const c of clicks) by[c.target] = (by[c.target] || 0) + 1;
          return Object.entries(by).map(([target, n]) => ({
            target,
            _count: { _all: n },
          }));
        },
      },
      __sessions: sessions,
      __questions: questions,
      __clicks: clicks,
    };
  }

  test("session → speak → ask → event → metrics", async () => {
    const prisma = memoryPrisma();
    const handler = createHandler({
      prisma,
      createSession: (p, args) =>
        reading.createSession(p, {
          ...args,
          fetchPageFn: async () => ({
            sourceUrl: "https://engineering.acme-example.test/blog/oncall-rotation",
            requestedUrl: args.url,
            title: "How Acme Redesigned On-Call",
            author: "Jordan Lee",
            text: SAMPLE_HTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() +
              " Acme rebuilt on-call around three rules with runbooks and handoff notes.",
            paragraphs: [
              "Acme rebuilt on-call around three rules.",
              "Runbooks live next to the service repo.",
            ],
            wordCount: 40,
            links: [
              {
                url: "https://engineering.acme-example.test/blog/paging-policy",
                text: "paging policy",
              },
            ],
          }),
        }),
      answerReadingQuestion: async () => ({
        answerText: "The first rule is a single owner service per page.",
        model: "test-model",
        toolUsed: false,
        fetchedSourceUrl: "",
        fetchedSourceOk: false,
      }),
      speakChunk: async ({ text }) => ({
        audioBase64: Buffer.from(`audio:${text.slice(0, 12)}`).toString("base64"),
        contentType: "audio/mpeg",
        voiceId: reading.DEFAULT_VOICE_ID,
      }),
      authenticateSession: async () => {
        throw new Error("no session");
      },
    });

    // session (public bootstrap)
    {
      const req = {
        method: "POST",
        url: "/api/reading?action=session",
        headers: {},
        body: { url: "https://engineering.acme-example.test/blog/oncall-rotation" },
      };
      const res = mockRes();
      await handler(req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.ok(res.body.sessionId);
      assert.equal(res.body.companyHost, "engineering.acme-example.test");
      assert.ok(!("text" in res.body) || !res.body.text);
      var sessionId = res.body.sessionId;
    }

    // speak
    {
      const req = {
        method: "POST",
        url: "/api/reading?action=speak",
        headers: {},
        body: { sessionId, fromWordIndex: 0 },
      };
      const res = mockRes();
      await handler(req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.ok(res.body.audio);
      assert.notEqual(res.body.voiceId, BANNED);
      assert.ok(res.body.toWordIndex > 0);
    }

    // ask
    {
      const req = {
        method: "POST",
        url: "/api/reading?action=ask",
        headers: {},
        body: {
          sessionId,
          question: "What is the first rule?",
          input: "typed",
          position: { wordIndex: 12 },
        },
      };
      const res = mockRes();
      await handler(req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.match(res.body.answerText, /owner/i);
      assert.equal(res.body.resumeWordIndex, 12);
      assert.equal(res.body.fetchedSource, false);
      assert.equal(prisma.__questions.length, 1);
    }

    // event linkedin
    {
      const req = {
        method: "POST",
        url: "/api/reading?action=event",
        headers: {},
        body: { sessionId, target: "linkedin" },
      };
      const res = mockRes();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(prisma.__clicks.length, 1);
      assert.equal(prisma.__clicks[0].target, "linkedin");
    }

    // metrics (needs strong auth)
    {
      const req = {
        method: "GET",
        url: "/api/reading?action=metrics",
        headers: { authorization: "Bearer test-reading-token" },
      };
      const res = mockRes();
      await handler(req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.sessions, 1);
      assert.equal(res.body.questions, 1);
      assert.equal(res.body.clicksLinkedIn, 1);
      assert.ok(res.body.byCompanyHost.some((r) => r.companyHost.includes("acme-example")));
    }
  });

  test("session create requires auth when READING_PUBLIC_SESSIONS=0", async () => {
    process.env.READING_PUBLIC_SESSIONS = "0";
    const handler = createHandler({
      prisma: memoryPrisma(),
      authenticateSession: async () => {
        throw new Error("nope");
      },
    });
    const req = {
      method: "POST",
      url: "/api/reading?action=session",
      headers: {},
      body: { url: "https://example.com/a" },
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  });
});

describe("embed + docs ship", () => {
  test("widget files and embed doc exist without em dashes in UI copy", () => {
    const root = path.join(__dirname, "..");
    const files = [
      "src/renderer/reading-widget/index.html",
      "src/renderer/reading-widget/widget.js",
      "src/renderer/reading-widget/widget.css",
      "src/renderer/reading-widget/embed.js",
      "docs/reading-agent-embed.md",
    ];
    for (const f of files) {
      const abs = path.join(root, f);
      assert.equal(fs.existsSync(abs), true, f);
      const text = fs.readFileSync(abs, "utf8");
      // User-facing widget strings should not use em dashes.
      if (f.endsWith("widget.js") || f.endsWith("index.html") || f.endsWith("embed.js")) {
        assert.equal(text.includes("\u2014"), false, f);
      }
    }
    const doc = fs.readFileSync(path.join(root, "docs/reading-agent-embed.md"), "utf8");
    assert.ok(doc.includes(BANNED));
    assert.match(doc, /data-url/);
    assert.match(doc, /lindowlabs/);
    assert.match(doc, /Do not open the lindowlabs/);
    assert.match(doc, /companyHost/);
  });

  test("prisma migration and schema include ReadingSession", () => {
    const schema = fs.readFileSync(
      path.join(__dirname, "..", "prisma", "schema.prisma"),
      "utf8",
    );
    assert.match(schema, /model ReadingSession/);
    assert.match(schema, /model ReadingQuestion/);
    assert.match(schema, /model ReadingClick/);
    assert.match(schema, /companyHost/);
    const mig = path.join(
      __dirname,
      "..",
      "prisma",
      "migrations",
      "20261031020000_reading_agent",
      "migration.sql",
    );
    assert.equal(fs.existsSync(mig), true);
  });
});
