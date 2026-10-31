"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const cm = require("../src/index.js");

describe("concept graph schema", () => {
  test("upserts concepts, edges, and beliefs", () => {
    const g = new cm.ConceptGraph();
    g.upsertConcept({
      id: "bayes",
      slug: "bayes",
      title: "Bayes rule",
      targetDepth: 0.6,
    });
    g.addEdge({
      fromId: "probability",
      toId: "bayes",
      type: "prerequisite",
    });
    g.setBelief("u1", "bayes", { depth: 0.4, confidence: 0.5 });
    const b = g.getBelief("u1", "bayes");
    assert.equal(b.depth, 0.4);
    assert.equal(b.confidence, 0.5);
    const json = g.toJSON();
    const g2 = cm.ConceptGraph.fromJSON(json);
    assert.equal(g2.getBelief("u1", "bayes").depth, 0.4);
    assert.equal(g2.concepts.get("bayes").title, "Bayes rule");
  });

  test("levelToDepth / depthToLevel round trip extremes", () => {
    assert.equal(cm.levelToDepth(0), 0);
    assert.equal(cm.levelToDepth(cm.DEPTH_MAX_LEVEL), 1);
    assert.equal(cm.depthToLevel(0), 0);
    assert.equal(cm.depthToLevel(1), cm.DEPTH_MAX_LEVEL);
  });
});

describe("signal ingestion", () => {
  test("normalizes honest_statement and response", () => {
    const s = cm.normalizeSignal({
      type: "honest_statement",
      text: "I can derive Bayes rule from first principles.",
      conceptIds: ["bayes"],
    });
    assert.equal(s.type, "honest_statement");
    assert.match(s.text, /Bayes/);

    const r = cm.normalizeSignal({
      type: "response",
      conceptId: "bayes",
      correct: true,
      aided: false,
    });
    assert.equal(r.correct, true);
    assert.deepEqual(r.conceptIds, ["bayes"]);
  });

  test("rejects unknown types", () => {
    assert.throws(
      () => cm.normalizeSignal({ type: "telepathy", conceptIds: ["x"] }),
      /unknown signal type/,
    );
  });
});

describe("update logic", () => {
  test("correct unaided raises depth; wrong lowers it", () => {
    const g = new cm.ConceptGraph();
    g.upsertConcept({ id: "c1", title: "C1" });
    g.setBelief("u", "c1", { depth: 0.4, confidence: 0.4 });

    cm.applySignal(g, "u", {
      type: "response",
      conceptIds: ["c1"],
      correct: true,
      aided: false,
    });
    const up = g.getBelief("u", "c1");
    assert.ok(up.depth > 0.4);

    cm.applySignal(g, "u", {
      type: "response",
      conceptIds: ["c1"],
      correct: false,
      aided: false,
    });
    const down = g.getBelief("u", "c1");
    assert.ok(down.depth < up.depth);
  });

  test("depthFromJevScore maps Score range onto [0,1]", () => {
    assert.equal(cm.depthFromJevScore(0), 0);
    assert.equal(cm.depthFromJevScore(cm.DEPTH_MAX_LEVEL), 1);
    assert.ok(cm.depthFromJevScore(2) > 0.4 && cm.depthFromJevScore(2) < 0.6);
  });
});

describe("ZPD classifier", () => {
  test("bands too_easy / in_zpd / too_hard", () => {
    assert.equal(cm.classifyZpdBand(0.9, 0.3).band, "too_easy");
    assert.equal(cm.classifyZpdBand(0.5, 0.5).band, "in_zpd");
    assert.equal(cm.classifyZpdBand(0.1, 0.7).band, "too_hard");
  });

  test("scoreZpdBands accuracy and macro-F1", () => {
    const yTrue = ["too_easy", "in_zpd", "too_hard", "in_zpd"];
    const yPred = ["too_easy", "in_zpd", "in_zpd", "in_zpd"];
    const s = cm.scoreZpdBands(yTrue, yPred);
    assert.equal(s.n, 4);
    assert.equal(s.accuracy, 0.75);
    assert.ok(s.macroF1 > 0.5);
    assert.ok(s.f1ByBand.in_zpd > 0);
  });

  test("rankSourcesForZpd prefers in-band material", () => {
    const ranked = cm.rankSourcesForZpd(
      [
        { id: "easy", depth: 0.1 },
        { id: "fit", depth: 0.55 },
        { id: "hard", depth: 0.95 },
      ],
      () => 0.5,
    );
    assert.equal(ranked[0].source.id, "fit");
    assert.equal(ranked[0].band, "in_zpd");
  });
});

describe("Jev config resolution (no network)", () => {
  test("unavailable without keys", () => {
    const cfg = cm.resolveJevConfig({});
    assert.equal(cfg.available, false);
  });

  test("prefers TypeSafe over OpenRouter", () => {
    const cfg = cm.resolveJevConfig({
      TYPESAFE_API_KEY: "ts_key",
      OPENROUTER_API_KEY: "or_key",
    });
    assert.equal(cfg.provider, "typesafe");
    assert.equal(cfg.apiKey, "ts_key");
  });

  test("falls back to OpenRouter", () => {
    const cfg = cm.resolveJevConfig({ OPENROUTER_API_KEY: "or_key" });
    assert.equal(cfg.provider, "openrouter");
    assert.match(cfg.model, /jev/);
  });
});
