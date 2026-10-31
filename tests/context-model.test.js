"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const cm = require("../packages/context-model/src/index.js");
const { createHandler } = require("../api/context-model.js");
const label = require("../evals/ednet-zpd/lib/label.js");
const bkt = require("../evals/ednet-zpd/lib/bkt.js");
const { runEdnetZpd } = require("../evals/ednet-zpd/lib/run.js");
const { runSourceZpd } = require("../evals/source-zpd/lib/run.js");
const { loadCasesWithKey } = require("../evals/source-zpd/lib/load.js");
const { rocAuc } = require("../evals/ednet-zpd/lib/metrics.js");
const { loadEvalConfig, renderTemplate } = require("../evals/config/load.js");
const {
  assignSplit,
  splitByKey,
  activeSplit,
} = require("../evals/lib/splits.js");
const {
  appendExperiment,
  readTestEvalCount,
} = require("../evals/lib/experiment-log.js");
const {
  fitAndScore,
  probsFromJevScore,
} = require("../evals/lib/classical-on-jev.js");

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("context-model package surface", () => {
  test("exports graph, zpd, jev helpers", () => {
    assert.equal(typeof cm.ConceptGraph, "function");
    assert.equal(typeof cm.classifyZpdBand, "function");
    assert.equal(typeof cm.resolveJevConfig, "function");
    assert.equal(typeof cm.recommendSources, "function");
  });
});

describe("versioned eval config (public v0 baseline)", () => {
  test("loads v0 from public-baseline", () => {
    const pack = loadEvalConfig({ version: "v0", env: {} });
    assert.equal(pack.version, "v0");
    assert.equal(pack.agentModeling, false);
    assert.equal(pack.source, "public-baseline");
    assert.equal(pack.jevDepthScore.type, "score");
    assert.ok(pack.jevDepthScore.criteria.length >= 2);
    assert.equal(pack.jevSourceNoul.type, "noul");
    assert.match(pack.claudeZpdBand.system, /too_easy/);
  });

  test("renderTemplate substitutes placeholders", () => {
    assert.equal(
      renderTemplate("Hi {{name}}", { name: "Tyler" }),
      "Hi Tyler",
    );
  });
});

describe("train/dev/test splits", () => {
  test("assignSplit is deterministic for seed 42", () => {
    assert.equal(assignSplit("user-a::skill", { seed: 42 }), assignSplit("user-a::skill", { seed: 42 }));
    const splits = splitByKey(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ id })),
      (x) => x.id,
      { seed: 42 },
    );
    assert.ok(splits.train.length >= 1);
    assert.ok(splits.dev.length >= 1);
    assert.ok(splits.test.length >= 1);
    assert.equal(
      splits.train.length + splits.dev.length + splits.test.length,
      10,
    );
  });

  test("activeSplit defaults to dev; test only when requested", () => {
    assert.equal(activeSplit({}, []), "dev");
    assert.equal(activeSplit({ EVAL_SPLIT: "test" }, []), "test");
    assert.equal(activeSplit({}, ["--test"]), "test");
  });
});

describe("experiment log", () => {
  test("dryRun does not increment test count", () => {
    const before = readTestEvalCount();
    const result = appendExperiment({
      version: "v0",
      benchmark: "ednet-zpd",
      split: "test",
      testScore: { accuracy: 0 },
      dryRun: true,
    });
    assert.equal(result.wrote, false);
    assert.equal(readTestEvalCount(), before);
  });
});

describe("classical stretch on Jev-like probs", () => {
  test("softmax fits and scores", () => {
    const train = [
      { probs: [1, 0, 0, 0, 0], band: "too_hard" },
      { probs: [0, 1, 0, 0, 0], band: "too_hard" },
      { probs: [0, 0, 1, 0, 0], band: "in_zpd" },
      { probs: [0, 0, 0, 1, 0], band: "too_easy" },
      { probs: [0, 0, 0, 0, 1], band: "too_easy" },
      { probs: [0, 0, 0.9, 0.1, 0], band: "in_zpd" },
    ];
    const evalRows = [
      { probs: [0.95, 0.05, 0, 0, 0], band: "too_hard" },
      { probs: [0, 0, 0, 0.2, 0.8], band: "too_easy" },
      { probs: [0, 0, 1, 0, 0], band: "in_zpd" },
    ];
    const scored = fitAndScore(train, evalRows, { epochs: 60 });
    assert.equal(scored.stretch, true);
    assert.ok(scored.accuracy >= 2 / 3);
    assert.deepEqual(probsFromJevScore({ "0": 0.1, "2": 0.9 }, 4), [
      0.1, 0, 0.9, 0, 0,
    ]);
  });
});

describe("EdNet label + BKT (no keys, no data download)", () => {
  test("labels synthetic fixture into ZPD bands", () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../evals/ednet-zpd/fixtures/synthetic-kt3.json"),
        "utf8",
      ),
    );
    const probes = label.labelEvents(fixture.events, { minHistory: 2 });
    assert.ok(probes.length >= 1, `expected probes, got ${probes.length}`);
    const bands = new Set(probes.map((p) => p.band));
    for (const b of bands) {
      assert.ok(["too_easy", "in_zpd", "too_hard"].includes(b), b);
    }
  });

  test("BKT updates mastery and predicts", () => {
    const model = bkt.createBkt();
    const before = model.predictCorrect("skill");
    model.update("skill", true);
    model.update("skill", true);
    const after = model.predictCorrect("skill");
    assert.ok(after > before);
  });

  test("rocAuc ranks perfect scores at 1", () => {
    assert.equal(rocAuc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1);
  });

  test("runEdnetZpd offline report is baseline on dev", async () => {
    const report = await runEdnetZpd({
      env: {},
      argv: [],
      dryRun: true,
      skipLog: true,
    });
    assert.equal(report.baseline, true);
    assert.equal(report.agentModeling, false);
    assert.equal(report.version, "v0");
    assert.equal(report.split, "dev");
    assert.equal(report.baselines.tinker.skipped, false);
    assert.equal(report.baselines.bkt.skipped, false);
    assert.equal(report.baselines.claude.skipped, true);
    assert.ok(report.baselines.classicalOnJev);
  });
});

describe("source-zpd internal cases (no keys)", () => {
  test("cases and keys align", () => {
    const cases = loadCasesWithKey();
    assert.ok(cases.length >= 5);
    for (const c of cases) {
      assert.ok(c.inBandSourceIds.length >= 1, c.id);
    }
  });

  test("tinker hit rate on default (dev) split", async () => {
    const report = await runSourceZpd({
      env: {},
      argv: [],
      useJev: false,
      dryRun: true,
      skipLog: true,
    });
    assert.equal(report.internal, true);
    assert.equal(report.baseline, true);
    assert.equal(report.split, "dev");
    assert.ok(typeof report.tinker.hitRate === "number");
    assert.equal(report.claude.skipped, true);
  });
});

describe("GET/POST /api/context-model", () => {
  test("GET read returns beliefs for authenticated user", async () => {
    const beliefs = new Map();
    const concepts = new Map();
    const signals = [];

    const prisma = {
      concept: {
        async findMany() {
          return [...concepts.values()];
        },
        async findUnique({ where }) {
          if (where.id) return concepts.get(where.id) || null;
          if (where.slug) {
            return (
              [...concepts.values()].find((c) => c.slug === where.slug) || null
            );
          }
          return null;
        },
        async upsert({ where, create, update }) {
          const existing =
            [...concepts.values()].find((c) => c.slug === where.slug) || null;
          if (existing) {
            Object.assign(existing, update, { updatedAt: new Date() });
            return existing;
          }
          const row = {
            ...create,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          concepts.set(row.id, row);
          return row;
        },
      },
      conceptEdge: { async findMany() { return []; } },
      userConceptBelief: {
        async findMany({ where }) {
          return [...beliefs.values()].filter((b) => b.userId === where.userId);
        },
        async upsert({ where, create, update }) {
          const key = `${where.userId_conceptId.userId}:${where.userId_conceptId.conceptId}`;
          if (beliefs.has(key)) {
            const row = beliefs.get(key);
            Object.assign(row, update, { updatedAt: new Date() });
            return row;
          }
          const row = {
            id: key,
            ...create,
            updatedAt: new Date(),
            createdAt: new Date(),
          };
          beliefs.set(key, row);
          return row;
        },
      },
      contextSignal: {
        async create({ data }) {
          const row = {
            id: `sig_${signals.length + 1}`,
            ...data,
            concepts: ((data.concepts && data.concepts.create) || []).map(
              (c) => ({ conceptId: c.conceptId }),
            ),
            createdAt: new Date(),
          };
          signals.push(row);
          return row;
        },
        async findMany() {
          return signals.slice().reverse();
        },
      },
    };

    const handler = createHandler({
      prisma,
      authenticateSession: async () => ({
        session: { user_id: "user_test" },
      }),
      resolveJevConfig: () => ({ available: false }),
    });

    const getRes = mockRes();
    await handler(
      {
        method: "GET",
        url: "/api/context-model",
        headers: { authorization: "Bearer sess" },
        query: {},
      },
      getRes,
    );
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.userId, "user_test");

    const postRes = mockRes();
    await handler(
      {
        method: "POST",
        url: "/api/context-model?action=signal",
        headers: { authorization: "Bearer sess" },
        query: { action: "signal" },
        body: {
          signals: [
            {
              type: "honest_statement",
              text: "I am still shaky on Bayes rule.",
              conceptIds: ["bayes"],
            },
          ],
        },
      },
      postRes,
    );
    assert.equal(postRes.statusCode, 200, JSON.stringify(postRes.body));
    assert.equal(postRes.body.ok, true);
  });

  test("rejects unauthenticated read", async () => {
    const handler = createHandler({
      prisma: {},
      authenticateSession: async () => {
        throw Object.assign(new Error("nope"), { status: 401 });
      },
    });
    const res = mockRes();
    await handler(
      { method: "GET", url: "/api/context-model", headers: {}, query: {} },
      res,
    );
    assert.equal(res.statusCode, 401);
  });
});

describe("docs + CI wiring", () => {
  test("CONTEXT_MODEL.md covers baseline loop without em dashes", () => {
    const md = fs.readFileSync(
      path.join(__dirname, "../docs/CONTEXT_MODEL.md"),
      "utf8",
    );
    assert.match(md, /iteration loop/i);
    assert.match(md, /private-config/);
    assert.match(md, /experiment-log/);
    assert.match(md, /held-out/);
    assert.doesNotMatch(md, /\u2014/);
  });

  test("workflow skips when secrets missing", () => {
    const yml = fs.readFileSync(
      path.join(__dirname, "../.github/workflows/context-model-eval.yml"),
      "utf8",
    );
    assert.match(yml, /ANTHROPIC_API_KEY/);
    assert.match(yml, /BRAINTRUST_API_KEY/);
    assert.match(yml, /skip_keyed/);
  });
});
