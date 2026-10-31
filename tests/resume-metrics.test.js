/* Resume metrics contract: event emission paths + RESUME_METRICS.md drift.
 *
 * Fails when:
 * - RESUME_METRICS.md and src/renderer/lib/metrics/events.js disagree on
 *   event names
 * - session / ask / sdk / answer-link paths stop emitting through the
 *   typed module
 * - GET /api/metrics shape regresses
 */

"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const events = require("../src/renderer/lib/metrics/events.js");
const clientTrack = require("../src/renderer/lib/metrics/client-track.js");
const emit = require("../api/_lib/metrics/emit.js");
const resume = require("../api/_lib/metrics/resume.js");
const { createHandler: createReadingHandler } = require("../api/reading.js");
const { createHandler: createMetricsHandler } = require("../api/metrics.js");
const reading = require("../api/_lib/reading-agent.js");

const CONTRACT = path.join(root, "RESUME_METRICS.md");
const EVENTS_MOD = path.join(root, "src/renderer/lib/metrics/events.js");

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

describe("RESUME_METRICS.md ↔ events.js contract", () => {
  test("contract file exists at repo root (not evals/METRICS.md)", () => {
    assert.equal(fs.existsSync(CONTRACT), true, "RESUME_METRICS.md missing");
    assert.equal(
      fs.existsSync(path.join(root, "evals/METRICS.md")),
      false,
      "Do not put resume definitions in evals/METRICS.md",
    );
  });

  test("every EVENT_NAMES entry is documented in RESUME_METRICS.md", () => {
    const md = fs.readFileSync(CONTRACT, "utf8");
    for (const name of events.EVENT_NAMES) {
      assert.ok(
        md.includes("`" + name + "`") || md.includes(name),
        `RESUME_METRICS.md missing event ${name}`,
      );
    }
    // Drift guard: backtick-quoted snake_case tokens in the doc that look
    // like events must be in EVENT_NAMES (rename/remove without doc update).
    const mentioned = new Set();
    const re = /`([a-z]+_[a-z_]+)`/g;
    let m;
    while ((m = re.exec(md))) {
      const token = m[1];
      if (
        token.endsWith("_start") ||
        token.endsWith("_asked") ||
        token.endsWith("_loaded") ||
        token.endsWith("_click") ||
        token.endsWith("_event")
      ) {
        mentioned.add(token);
      }
    }
    for (const token of mentioned) {
      assert.ok(
        events.EVENT_NAMES.includes(token),
        `RESUME_METRICS.md mentions ${token} but events.js does not export it`,
      );
    }
    assert.deepEqual(
      [...events.EVENT_NAMES].sort(),
      [
        "answer_link_click",
        "question_asked",
        "sdk_loaded",
        "session_start",
      ],
    );
  });

  test("three rules are stated", () => {
    const md = fs.readFileSync(CONTRACT, "utf8");
    assert.match(md, /Event names are a contract/i);
    assert.match(md, /DO_NOT_PUBLISH|private pack|goal numbers/i);
    assert.match(md, /Owner traffic is always excluded/i);
  });

  test("README and AGENTS.md reference RESUME_METRICS.md", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    assert.match(readme, /RESUME_METRICS\.md/);
    assert.match(agents, /RESUME_METRICS\.md/);
  });

  test("events module path matches contract pointer", () => {
    assert.equal(fs.existsSync(EVENTS_MOD), true);
    const md = fs.readFileSync(CONTRACT, "utf8");
    assert.match(md, /src\/renderer\/lib\/metrics\/events\.js/);
  });
});

describe("typed emit helpers", () => {
  test("assertKnownEvent rejects ad-hoc names", () => {
    assert.throws(() => events.assertKnownEvent("page_view"), /Unknown/);
    assert.equal(events.assertKnownEvent("session_start"), "session_start");
  });

  test("owner traffic skipped on server emit", async () => {
    const calls = [];
    const result = await emit.emitSessionStart(
      { sessionId: "s1", anonymousId: "ra_abc" },
      {
        isOwner: true,
        trackFn: async (name, props) => {
          calls.push({ name, props });
        },
      },
    );
    assert.equal(result.skipped, "owner");
    assert.equal(calls.length, 0);
  });

  test("non-owner emit goes through trackFn with contract name", async () => {
    const calls = [];
    await emit.emitQuestionAsked(
      { sessionId: "s1", anonymousId: "ra_abc", input: "typed" },
      {
        isOwner: false,
        trackFn: async (name, props) => {
          calls.push({ name, props });
        },
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "question_asked");
    assert.equal(calls[0].props.input, "typed");
  });

  test("isExcludedEmbedHost drops lindowlabs, localhost, vercel, tinker", () => {
    assert.equal(events.isExcludedEmbedHost("lindowlabs.dev"), true);
    assert.equal(events.isExcludedEmbedHost("localhost"), true);
    assert.equal(events.isExcludedEmbedHost("my-app-git-main.vercel.app"), true);
    assert.equal(events.isExcludedEmbedHost("tinker.beginner.work"), true);
    assert.equal(events.isExcludedEmbedHost("customer.example.com"), false);
  });

  test("isOwnerTraffic only true for ?owner=1", () => {
    assert.equal(events.isOwnerTraffic("?owner=1"), true);
    assert.equal(events.isOwnerTraffic("?foo=1"), false);
    assert.equal(events.isOwnerTraffic(""), false);
    assert.equal(events.isOwnerTraffic(true), true);
  });

  test("client track helpers exist for every event", () => {
    assert.equal(typeof clientTrack.trackSessionStart, "function");
    assert.equal(typeof clientTrack.trackQuestionAsked, "function");
    assert.equal(typeof clientTrack.trackSdkLoaded, "function");
    assert.equal(typeof clientTrack.trackAnswerLinkClick, "function");
    assert.deepEqual(
      Object.keys(clientTrack.EVENTS).sort(),
      Object.keys(events.EVENTS).sort(),
    );
  });
});

describe("emission paths stay wired", () => {
  let prevToken;
  let prevAnthropic;
  let prevEleven;
  let prevPublic;

  beforeEach(() => {
    prevToken = process.env.TINKER_SERVICE_TOKEN;
    prevAnthropic = process.env.ANTHROPIC_API_KEY;
    prevEleven = process.env.ELEVENLABS_API_KEY;
    prevPublic = process.env.READING_PUBLIC_SESSIONS;
    process.env.TINKER_SERVICE_TOKEN = "test-resume-metrics-token";
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
    const embedHosts = new Map();
    const evalRuns = [];
    return {
      readingSession: {
        async create({ data }) {
          sessions.set(data.id, { ...data, questionCount: data.questionCount || 0 });
          return data;
        },
        async findUnique({ where }) {
          return sessions.get(where.id) || null;
        },
        async findMany({ where } = {}) {
          let rows = [...sessions.values()];
          if (where && where.isOwner === false) {
            rows = rows.filter((r) => !r.isOwner);
          }
          if (where && where.anonymousId && where.anonymousId.not === "") {
            rows = rows.filter((r) => r.anonymousId);
          }
          return rows.map((r) => ({
            id: r.id,
            anonymousId: r.anonymousId,
            createdAt: r.createdAt || new Date(),
            questionCount: r.questionCount || 0,
          }));
        },
        async update({ where, data }) {
          const row = sessions.get(where.id);
          if (data.questionCount && typeof data.questionCount === "object" && data.questionCount.increment) {
            row.questionCount = (row.questionCount || 0) + data.questionCount.increment;
            const { questionCount, ...rest } = data;
            Object.assign(row, rest);
          } else {
            Object.assign(row, data);
          }
          return row;
        },
        async count() {
          return sessions.size;
        },
        async groupBy() {
          return [];
        },
      },
      readingQuestion: {
        async create({ data }) {
          questions.push({ ...data, createdAt: data.createdAt || new Date() });
          return data;
        },
        async findMany({ where } = {}) {
          let rows = questions.slice();
          if (where && where.isOwner === false) rows = rows.filter((r) => !r.isOwner);
          if (where && where.status) rows = rows.filter((r) => r.status === where.status);
          return rows;
        },
        async count() {
          return questions.length;
        },
        async aggregate() {
          return { _avg: { latencyMs: 0 } };
        },
      },
      readingClick: {
        async create({ data }) {
          clicks.push(data);
          return data;
        },
        async groupBy() {
          return [];
        },
      },
      readingEmbedHost: {
        async upsert({ where, create, update }) {
          const existing = embedHosts.get(where.host);
          if (!existing) {
            const row = { ...create };
            embedHosts.set(where.host, row);
            return row;
          }
          existing.lastSeenAt = update.lastSeenAt;
          existing.loadCount = (existing.loadCount || 0) + (update.loadCount?.increment || 0);
          return existing;
        },
        async findMany() {
          return [...embedHosts.values()];
        },
      },
      evalRun: {
        async create({ data }) {
          const row = { ...data, createdAt: new Date() };
          evalRuns.push(row);
          return row;
        },
        async findFirst() {
          return evalRuns[evalRuns.length - 1] || null;
        },
      },
      __sessions: sessions,
      __questions: questions,
      __clicks: clicks,
      __embedHosts: embedHosts,
      __evalRuns: evalRuns,
    };
  }

  test("session + ask + link click emit contract events (not owner)", async () => {
    const prisma = memoryPrisma();
    const emitted = [];
    const trackFn = async (name, props) => {
      emitted.push({ name, props });
    };
    const handler = createReadingHandler({
      prisma,
      emitSessionStart: (p, o) => emit.emitSessionStart(p, { ...o, trackFn }),
      emitQuestionAsked: (p, o) => emit.emitQuestionAsked(p, { ...o, trackFn }),
      emitSdkLoaded: (p, o) => emit.emitSdkLoaded(p, { ...o, trackFn }),
      emitAnswerLinkClick: (p, o) => emit.emitAnswerLinkClick(p, { ...o, trackFn }),
      createSession: (p, args) =>
        reading.createSession(p, {
          ...args,
          fetchPageFn: async () => ({
            sourceUrl: "https://engineering.acme-example.test/blog/oncall",
            requestedUrl: args.url,
            title: "On-call",
            author: "Jordan",
            text: "Acme rebuilt on-call around three rules with runbooks and handoff notes for every shift.",
            paragraphs: ["Acme rebuilt on-call around three rules."],
            wordCount: 20,
            links: [],
          }),
        }),
      answerReadingQuestion: async () => ({
        answerText: "A single owner service.",
        model: "test",
        toolUsed: false,
        fetchedSourceUrl: "",
      }),
      speakChunk: async ({ text }) => ({
        audioBase64: Buffer.from(text.slice(0, 8)).toString("base64"),
        contentType: "audio/mpeg",
        voiceId: reading.DEFAULT_VOICE_ID,
      }),
      authenticateSession: async () => {
        throw new Error("no session");
      },
    });

    const sessionRes = mockRes();
    await handler(
      {
        method: "POST",
        url: "/api/reading?action=session",
        headers: {},
        body: {
          url: "https://engineering.acme-example.test/blog/oncall",
          anonymousId: "ra_aaaaaaaaaaaaaaaa",
          embedHost: "customer.example.com",
        },
      },
      sessionRes,
    );
    assert.equal(sessionRes.statusCode, 200, JSON.stringify(sessionRes.body));
    const sessionId = sessionRes.body.sessionId;

    const askRes = mockRes();
    await handler(
      {
        method: "POST",
        url: "/api/reading?action=ask",
        headers: {},
        body: {
          sessionId,
          question: "What is the first rule?",
          input: "typed",
          anonymousId: "ra_aaaaaaaaaaaaaaaa",
        },
      },
      askRes,
    );
    assert.equal(askRes.statusCode, 200, JSON.stringify(askRes.body));

    const clickRes = mockRes();
    await handler(
      {
        method: "POST",
        url: "/api/reading?action=event",
        headers: {},
        body: {
          sessionId,
          target: "linkedin",
          anonymousId: "ra_aaaaaaaaaaaaaaaa",
        },
      },
      clickRes,
    );
    assert.equal(clickRes.statusCode, 200);

    const names = emitted.map((e) => e.name);
    assert.ok(names.includes("session_start"), JSON.stringify(names));
    assert.ok(names.includes("sdk_loaded"), JSON.stringify(names));
    assert.ok(names.includes("question_asked"), JSON.stringify(names));
    assert.ok(names.includes("answer_link_click"), JSON.stringify(names));
    assert.equal(prisma.__embedHosts.has("customer.example.com"), true);
  });

  test("owner session does not emit vercel events", async () => {
    const prisma = memoryPrisma();
    const emitted = [];
    const trackFn = async (name, props) => {
      emitted.push({ name, props });
    };
    const handler = createReadingHandler({
      prisma,
      emitSessionStart: (p, o) => emit.emitSessionStart(p, { ...o, trackFn }),
      emitQuestionAsked: (p, o) => emit.emitQuestionAsked(p, { ...o, trackFn }),
      emitSdkLoaded: (p, o) => emit.emitSdkLoaded(p, { ...o, trackFn }),
      emitAnswerLinkClick: (p, o) => emit.emitAnswerLinkClick(p, { ...o, trackFn }),
      createSession: (p, args) =>
        reading.createSession(p, {
          ...args,
          fetchPageFn: async () => ({
            sourceUrl: "https://engineering.acme-example.test/blog/oncall",
            requestedUrl: args.url,
            title: "On-call",
            author: "Jordan",
            text: "Acme rebuilt on-call around three rules with runbooks and handoff notes for every shift.",
            paragraphs: ["Acme rebuilt on-call around three rules."],
            wordCount: 20,
            links: [],
          }),
        }),
      authenticateSession: async () => {
        throw new Error("no session");
      },
    });

    const res = mockRes();
    await handler(
      {
        method: "POST",
        url: "/api/reading?action=session",
        headers: {},
        body: {
          url: "https://engineering.acme-example.test/blog/oncall",
          anonymousId: "ra_bbbbbbbbbbbbbbbb",
          owner: "1",
          embedHost: "customer.example.com",
        },
      },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(emitted.length, 0);
    const row = [...prisma.__sessions.values()][0];
    assert.equal(row.isOwner, true);
  });

  test("widget + reading API source still call emit helpers", () => {
    const readingSrc = fs.readFileSync(path.join(root, "api/reading.js"), "utf8");
    assert.match(readingSrc, /emitSessionStart/);
    assert.match(readingSrc, /emitQuestionAsked/);
    assert.match(readingSrc, /emitSdkLoaded/);
    assert.match(readingSrc, /emitAnswerLinkClick/);

    const widgetSrc = fs.readFileSync(
      path.join(root, "src/renderer/reading-widget/widget.js"),
      "utf8",
    );
    assert.match(widgetSrc, /trackSessionStart/);
    assert.match(widgetSrc, /trackQuestionAsked/);
    assert.match(widgetSrc, /trackAnswerLinkClick/);
    assert.match(widgetSrc, /clientMeta/);

    const embedSrc = fs.readFileSync(
      path.join(root, "src/renderer/reading-widget/embed.js"),
      "utf8",
    );
    assert.match(embedSrc, /embedHost/);

    const indexHtml = fs.readFileSync(
      path.join(root, "src/renderer/reading-widget/index.html"),
      "utf8",
    );
    assert.match(indexHtml, /lib\/metrics\/events\.js/);
    assert.match(indexHtml, /lib\/metrics\/client-track\.js/);
  });
});

describe("GET /api/metrics + collectResumeMetrics", () => {
  test("aggregates users, questions, repeat, embeds, eval, month vs 30d", async () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    const day10 = new Date("2026-10-21T12:00:00.000Z");
    const day40 = new Date("2026-09-20T12:00:00.000Z");

    const sessions = [
      { id: "s1", anonymousId: "ra_u1", isOwner: false, createdAt: day10, questionCount: 1 },
      { id: "s2", anonymousId: "ra_u1", isOwner: false, createdAt: day10, questionCount: 1 },
      { id: "s3", anonymousId: "ra_u2", isOwner: false, createdAt: day40, questionCount: 1 },
      { id: "s4", anonymousId: "ra_owner", isOwner: true, createdAt: day10, questionCount: 5 },
    ];
    const questions = [
      { sessionId: "s1", anonymousId: "ra_u1", isOwner: false, status: "ok", createdAt: day10 },
      { sessionId: "s2", anonymousId: "ra_u1", isOwner: false, status: "ok", createdAt: day10 },
      { sessionId: "s3", anonymousId: "ra_u2", isOwner: false, status: "ok", createdAt: day40 },
      { sessionId: "s4", anonymousId: "ra_owner", isOwner: true, status: "ok", createdAt: day10 },
    ];
    const prisma = {
      readingSession: {
        async findMany() {
          return sessions.filter((s) => !s.isOwner && s.anonymousId);
        },
      },
      readingQuestion: {
        async findMany() {
          return questions.filter((q) => !q.isOwner && q.status === "ok");
        },
      },
      readingEmbedHost: {
        async findMany() {
          return [
            { host: "customer.example.com" },
            { host: "localhost" },
            { host: "tinker.beginner.work" },
          ];
        },
      },
      evalRun: {
        async findFirst() {
          return {
            passRate: 0.91,
            caseCount: 9,
            passedCount: 8,
            failedCount: 1,
            project: "tinker-ask",
            createdAt: now,
            experimentUrl: "https://www.braintrust.dev/app/example",
          };
        },
      },
    };

    const payload = await resume.collectResumeMetrics(prisma, { now });
    assert.equal(payload.users, 2);
    assert.equal(payload.questions, 3);
    assert.equal(payload.repeatUsers, 1);
    assert.equal(payload.usersLast30Days, 1); // only ra_u1 in last 30d
    assert.ok(payload.usersPerMonth.some((r) => r.month === "2026-10" && r.users === 1));
    assert.ok(payload.usersPerMonth.some((r) => r.month === "2026-09" && r.users === 1));
    assert.deepEqual(payload.embedHosts, ["customer.example.com"]);
    assert.equal(payload.latestEvalPassRate.passRate, 0.91);
    assert.equal(payload.latestEvalPassRate.caseCount, 9);
    assert.ok(payload.questionsPerSession > 0);
  });

  test("GET /api/metrics requires auth and returns resume fields", async () => {
    process.env.TINKER_SERVICE_TOKEN = "metrics-token";
    const handler = createMetricsHandler({
      prisma: {},
      collectResumeMetrics: async () => ({
        users: 1,
        questions: 2,
        questionsPerSession: 2,
        repeatUsers: 0,
        embedHosts: [],
        latestEvalPassRate: null,
        usersPerMonth: [],
        usersLast30Days: 1,
        generatedAt: new Date().toISOString(),
      }),
      authenticateSession: async () => {
        throw new Error("nope");
      },
      isOwnerUser: () => false,
    });

    const denied = mockRes();
    await handler({ method: "GET", url: "/api/metrics", headers: {} }, denied);
    assert.equal(denied.statusCode, 401);

    const ok = mockRes();
    await handler(
      {
        method: "GET",
        url: "/api/metrics",
        headers: { authorization: "Bearer metrics-token" },
      },
      ok,
    );
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.users, 1);
    assert.equal(ok.body.questions, 2);
    assert.ok("usersLast30Days" in ok.body);
    assert.ok("usersPerMonth" in ok.body);
    assert.ok("embedHosts" in ok.body);
    assert.ok("latestEvalPassRate" in ok.body);
  });

  test("POST record_eval persists EvalRun", async () => {
    process.env.TINKER_SERVICE_TOKEN = "metrics-token";
    const evalRuns = [];
    const handler = createMetricsHandler({
      prisma: {
        evalRun: {
          async create({ data }) {
            const row = { ...data, createdAt: new Date() };
            evalRuns.push(row);
            return row;
          },
        },
      },
      authenticateSession: async () => {
        throw new Error("nope");
      },
      isOwnerUser: () => false,
    });

    const res = mockRes();
    await handler(
      {
        method: "POST",
        url: "/api/metrics?action=record_eval",
        headers: { authorization: "Bearer metrics-token" },
        body: {
          passRate: 0.88,
          caseCount: 9,
          passedCount: 8,
          failedCount: 1,
          experimentUrl: "https://example.test/exp",
        },
      },
      res,
    );
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(evalRuns.length, 1);
    assert.equal(evalRuns[0].passRate, 0.88);
    assert.equal(evalRuns[0].caseCount, 9);
  });
});
