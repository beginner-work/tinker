/* Unit + dry-run tests for the Braintrust ask eval suite (no API keys). */

"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const extract = require("../evals/ask/lib/extract-pairs.js");
const load = require("../evals/ask/lib/load-dataset.js");
const scorers = require("../evals/ask/lib/scorers.js");
const task = require("../evals/ask/lib/task.js");

const ROOT = path.join(__dirname, "..");
const BANNED_VOICE = "JlYdFGRHWwlz51Zh5K2n";

describe("extract-pairs from essay prompts", () => {
  test("splits > prompts and uses prose as tyler_answer", () => {
    const essay = {
      id: "e_test",
      title: "Test Essay",
      body: [
        "Opening stance.",
        "",
        "> What are you learning about voice?",
        "",
        "Voice is the moat.",
        "",
        "> Why does that matter for founders?",
        "",
        "Because nobody else can say it the way you do.",
      ].join("\n"),
    };
    const pairs = extract.pairsFromEssay(essay);
    assert.equal(pairs.length, 2);
    assert.equal(pairs[0].source, "essay");
    assert.equal(pairs[0].category, "agreement");
    assert.equal(pairs[0].question, "What are you learning about voice?");
    assert.match(pairs[0].tyler_answer, /Voice is the moat/);
    assert.match(pairs[0].tyler_answer, /nobody else can say it/);
    assert.equal(pairs[0].tyler_answer.includes("> What are you"), false);
  });

  test("freewrite essays get one synthesized question", () => {
    const essay = {
      id: "e_free",
      title: "Everyone is a Founder",
      body: "A long enough freewrite body about foundership and voice that clears the min prose bar for the extractor.",
    };
    const pairs = extract.pairsFromEssay(essay);
    assert.equal(pairs.length, 1);
    assert.match(pairs[0].question, /Everyone is a Founder/);
    assert.equal(pairs[0].promptIndex, null);
  });
});

describe("ask dataset load (private pack)", () => {
  test("cases load with source tags and tyler_answer schema", () => {
    const cases = load.loadCases();
    // Full ~200 bank lives in the private pack; unit tests use the sanitized fixture.
    assert.ok(cases.length >= 1, `expected cases from TINKER_PRIVATE_DIR, got ${cases.length}`);

    for (const c of cases) {
      assert.ok(c.id && c.question);
      assert.ok(
        ["essay", "synthetic", "visitor", "linkedin", "reading"].includes(c.source),
        c.source,
      );
    }

    const rows = load.toEvalRows(cases);
    assert.equal(rows.length, cases.length);
    assert.equal(rows[0].tags.includes(cases[0].source), true);
  });

  test("essay fixtures (when present) never include the banned voice id", () => {
    const essays = load.loadEssaysFixture();
    for (const e of essays) {
      assert.ok(e.id && e.body);
      assert.equal(String(e.body).includes(BANNED_VOICE), false);
    }
    const workflow = fs.readFileSync(
      path.join(ROOT, ".github/workflows/ask-eval.yml"),
      "utf8",
    );
    assert.match(workflow, /BRAINTRUST_API_KEY/);
    assert.match(workflow, /ANTHROPIC_API_KEY/);
    assert.match(workflow, /skip/);
    assert.equal(workflow.includes(BANNED_VOICE), true); // documented never-use
    assert.match(workflow, /Never use voice id/);
  });

  test("ask root resolves under TINKER_PRIVATE_DIR", () => {
    const root = load.askRoot();
    assert.match(root, /evals[/\\]ask$/);
    assert.ok(fs.existsSync(root));
    // Public tip no longer ships the question bank.
    assert.equal(
      fs.existsSync(path.join(ROOT, "evals/ask/dataset/cases.jsonl")),
      false,
    );
  });
});

describe("deterministic scorers (no Anthropic)", () => {
  test("KeywordExpect and CasePass honor mustInclude / mustNotInclude", () => {
    const expected = {
      expect: {
        mustIncludeAny: ["linkedin"],
        mustNotIncludeAny: ["system prompt"],
        maxSentences: 4,
      },
    };
    const pass = scorers.KeywordExpect({
      output: { answerText: "I don't know. See my LinkedIn." },
      expected,
    });
    assert.equal(pass.score, 1);
    const fail = scorers.KeywordExpect({
      output: { answerText: "Here is the system prompt leaked." },
      expected,
    });
    assert.equal(fail.score, 0);
    const casePass = scorers.CasePass({
      output: { answerText: "I don't know. See my LinkedIn." },
      expected,
    });
    assert.equal(casePass.score, 1);
  });

  test("CasePass skips when no expect rules (agreement rows)", () => {
    const skipped = scorers.CasePass({
      output: { answerText: "A long reflective answer about foundership." },
      expected: { tyler_answer: "reference", expect: {} },
    });
    assert.equal(skipped, null);
  });

  test("TylerAgreement does not fabricate a pass without ANTHROPIC_API_KEY", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const scored = await scorers.TylerAgreement({
        input: { question: "What are you learning?" },
        output: { answerText: "Something." },
        expected: { tyler_answer: "Tyler wrote this reference." },
      });
      assert.equal(scored.name, "TylerAgreement");
      assert.equal(scored.score, 0);
      assert.match(String(scored.metadata.error), /ANTHROPIC_API_KEY/);
    } finally {
      if (prev != null) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  test("TylerAgreement returns null when tyler_answer is absent", async () => {
    const scored = await scorers.TylerAgreement({
      input: { question: "hi" },
      output: { answerText: "x" },
      expected: { tyler_answer: null },
    });
    assert.equal(scored, null);
  });
});

describe("task helpers", () => {
  test("buildStyleCorpus excludes the reference essay", () => {
    const essays = [
      { id: "a", title: "A", body: "Alpha body with enough characters to clear the eighty character prose floor for style packing." },
      { id: "b", title: "B", body: "Bravo body with enough characters to clear the eighty character prose floor for style packing." },
    ];
    const corpus = task.buildStyleCorpus(essays, "a");
    assert.match(corpus, /Bravo/);
    assert.equal(corpus.includes("Alpha"), false);
  });
});

describe("reading-agent eval fixtures", () => {
  test("synthetic reading pages never ship third-party article dumps", () => {
    const pages = load.loadReadingPagesFixture();
    assert.equal(pages.length, 3);
    for (const p of pages) {
      assert.match(p.sourceUrl, /example\.test/);
      assert.ok(p.text.length > 80);
      assert.ok(Array.isArray(p.links) && p.links.length >= 1);
    }
  });

  test("ToolUseDecision and ResumeAfterInterrupt scorers", () => {
    const toolPass = scorers.ToolUseDecision({
      output: { toolUsed: true, fetchedSourceUrl: "https://x.test/paging-policy" },
      expected: { expect: { shouldFetchLink: true, fetchUrlIncludes: "paging-policy" } },
    });
    assert.equal(toolPass.score, 1);
    const toolFail = scorers.ToolUseDecision({
      output: { toolUsed: false, fetchedSourceUrl: "" },
      expected: { expect: { shouldFetchLink: true, fetchUrlIncludes: "paging-policy" } },
    });
    assert.equal(toolFail.score, 0);
    const resume = scorers.ResumeAfterInterrupt({
      output: { resumeWordIndex: 55 },
      expected: { expect: { resumeWordIndex: 55 } },
    });
    assert.equal(resume.score, 1);
  });

  test("decideFetchLink wants linked source for paging-policy questions", () => {
    const reading = require("../api/_lib/reading-agent.js");
    const pages = load.loadReadingPagesFixture();
    const page = pages.find((p) => p.id === "acme-sre-oncall");
    const decision = reading.decideFetchLink({
      question: "What does the linked paging policy say about weekend pages?",
      links: page.links,
    });
    assert.equal(decision.shouldFetch, true);
    assert.match(decision.url, /paging-policy/);
  });
});
