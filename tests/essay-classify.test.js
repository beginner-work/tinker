/* Essay technical vs business classifier (mocked Claude). */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const classify = require("../src/renderer/lib/essay-classify.js");
const models = require("../src/renderer/lib/claude-models.js");
const structured = require("../src/renderer/lib/claude-structured.js");

const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const page = fs.readFileSync(
  path.join(root, "src/renderer/repo/repo.js"),
  "utf8"
);
const harnessBiz = fs.readFileSync(
  path.join(root, "src/renderer/repo/harness/essays-sidebar-simple.html"),
  "utf8"
);
const harnessTech = fs.readFileSync(
  path.join(root, "src/renderer/repo/harness/technical-essays-sidebar.html"),
  "utf8"
);

const longTechnical =
  "We need to fix the webhook retry queue so failed Stripe signature " +
  "checks re-enqueue with exponential backoff and idempotent handlers.";
const longBusiness =
  "I met three customers this week and the pitch still does not land. " +
  "Fundraising momentum is soft and hiring feels early.";

test("essay-classify pins Haiku 4.5 via ESSAY_CLASSIFY", () => {
  assert.equal(models.ESSAY_CLASSIFY, models.FAST);
  assert.equal(models.ESSAY_CLASSIFY, "claude-haiku-4-5-20251001");
  assert.equal(classify.MODEL, models.ESSAY_CLASSIFY);
  assert.equal(classify.DEBOUNCE_MS, 1500);
  assert.ok(classify.MIN_CHARS >= 40);
});

test("normalizeKind maps legacy types to business", () => {
  assert.equal(classify.normalizeKind("technical"), "technical");
  assert.equal(classify.normalizeKind("business"), "business");
  assert.equal(classify.normalizeKind("stories"), "business");
  assert.equal(classify.normalizeKind("reflections"), "business");
  assert.equal(classify.normalizeKind("drafts"), "business");
  assert.equal(classify.normalizeKind("exercises"), "business");
  assert.equal(classify.isTechnicalKind("technical"), true);
  assert.equal(classify.isTechnicalKind("stories"), false);
});

test("needsBackfill requires body + missing classifiedAt", () => {
  assert.equal(classify.needsBackfill(null), false);
  assert.equal(
    classify.needsBackfill({ body: longTechnical, contentTypeClassifiedAt: "2026-01-01" }),
    false
  );
  assert.equal(classify.needsBackfill({ body: "short" }), false);
  assert.equal(classify.needsBackfill({ body: longBusiness }), true);
  assert.equal(classify.needsBackfill({ markdown: longTechnical }), true);
});

test("classifyEssay uses mocked callFn and returns technical", async () => {
  let sawModel = null;
  const result = await classify.classifyEssay({
    text: longTechnical,
    structuredApi: structured,
    callFn: async (payload) => {
      sawModel = payload.model;
      return {
        text: "",
        toolUse: {
          name: "submit_essay_kind",
          input: { kind: "technical" },
        },
      };
    },
  });
  assert.equal(result.kind, "technical");
  assert.equal(result.skipped, false);
  assert.equal(sawModel, models.ESSAY_CLASSIFY);
});

test("classifyEssay returns business from mocked tool payload", async () => {
  const result = await classify.classifyEssay({
    text: longBusiness,
    structuredApi: structured,
    callFn: async () => ({
      structured: { kind: "business" },
      text: JSON.stringify({ kind: "business" }),
    }),
  });
  assert.equal(result.kind, "business");
  assert.equal(result.skipped, false);
});

test("classifyEssay skips short text without calling Claude", async () => {
  let called = 0;
  const result = await classify.classifyEssay({
    text: "too short",
    structuredApi: structured,
    callFn: async () => {
      called += 1;
      return { text: "{}" };
    },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.kind, "business");
  assert.equal(called, 0);
});

test("createDebouncedClassifier fires once after wait", async () => {
  const hits = [];
  const debounced = classify.createDebouncedClassifier(function (arg) {
    hits.push(arg);
  }, 40);
  debounced.schedule("a");
  debounced.schedule("b");
  debounced.schedule("c");
  assert.equal(hits.length, 0);
  await new Promise(function (resolve) {
    setTimeout(resolve, 80);
  });
  assert.deepEqual(hits, ["c"]);
  debounced.cancel();
});

test("write page loads classifier and Founder Source / Development chrome", () => {
  assert.match(html, /essay-classify\.js/);
  assert.match(html, /aria-label="Development"/);
  assert.match(html, /aria-label="Founder Source"/);
  assert.match(html, />Founder Source</);
  assert.match(html, /No Founder Source essays yet/);
  assert.doesNotMatch(html, /aria-label="Past essays"/);
  assert.doesNotMatch(html, /aria-label="Essays"/);
  assert.doesNotMatch(html, />Essays</);
  assert.doesNotMatch(html, /aria-label="Technical essays"/);
  assert.doesNotMatch(html, />Technical essays</);
  assert.match(page, /scheduleEssayClassify|backfillEssayKinds/);
  assert.match(page, /contentTypeClassifiedAt/);
  assert.match(page, /tinkerEssayClassify/);
  assert.match(page, /draftContentType\(\)[\s\S]*KIND_BUSINESS|return "business"/);
});

test("visual harnesses show plain Development and Founder Source lists", () => {
  assert.match(harnessTech, /Development/);
  assert.match(harnessTech, /How the retry queue settles/);
  assert.doesNotMatch(harnessTech, /id="repo-new-folder"|id="repo-sidebar-new-piece"|id="repo-panel-close"/);
  assert.match(harnessBiz, /Founder Source/);
  assert.match(harnessBiz, /aria-label="Founder Source"/);
  assert.doesNotMatch(harnessBiz, /Business essays|aria-label="Essays"|>Essays</);
  assert.doesNotMatch(harnessBiz, /id="repo-new-folder"|id="repo-sidebar-new-piece"|id="repo-panel-close"/);
});
