/**
 * Braintrust Eval for project `tinker-ask`.
 *
 * Core metric: TylerAgreement — how often Tinker answers the way Tyler would,
 * judged against tyler_answer (essay prose). Schema also carries synthetic /
 * visitor rows with tyler_answer null for later gold attachment.
 *
 * Run: npx braintrust eval evals/ask/ask.eval.ts
 * Requires: BRAINTRUST_API_KEY, ANTHROPIC_API_KEY
 * Never uses OpenAI. Never uses voice id JlYdFGRHWwlz51Zh5K2n.
 */
import { Eval } from "braintrust";
import { createRequire } from "node:module";
import "./ask.reporter";

const require = createRequire(__filename);
const load = require("./lib/load-dataset.js") as typeof import("./lib/load-dataset.js");
const taskLib = require("./lib/task.js") as typeof import("./lib/task.js");
const scorers = require("./lib/scorers.js") as typeof import("./lib/scorers.js");

const essays = load.loadEssaysFixture();
const cases = load.loadCases();
const rows = load.toEvalRows(cases);

Eval("tinker-ask", {
  experimentName: "ask-tyler-agreement",
  maxConcurrency: 4,
  metadata: {
    caseCount: cases.length,
    essayFixtureCount: essays.length,
    sources: {
      essay: cases.filter((c) => c.source === "essay").length,
      synthetic: cases.filter((c) => c.source === "synthetic").length,
      visitor: cases.filter((c) => c.source === "visitor").length,
    },
    withTylerAnswer: cases.filter((c) => c.tyler_answer != null).length,
    gate: "ask.reporter.ts / THRESHOLDS.md",
  },
  data: () => rows,
  task: async (input, hooks) => {
    const caseRow = {
      ...input,
      tyler_answer: hooks.expected?.tyler_answer ?? null,
      expect: hooks.expected?.expect || {},
      category: input.category || hooks.expected?.category || "agreement",
    };
    const result = await taskLib.runTask(caseRow, { essays });
    hooks.span.log({
      metrics: { latency_ms: result.latencyMs },
      metadata: { path: result.path, model: result.model },
    });
    return result;
  },
  scores: [
    scorers.TylerAgreement,
    scorers.CasePass,
    scorers.KeywordExpect,
    scorers.SentenceBudget,
    scorers.GroundingJudge,
  ],
}, "tinker-ask-gate");

console.error(
  `[tinker-ask] loaded ${cases.length} cases ` +
    `(essay=${cases.filter((c) => c.source === "essay").length}, ` +
    `synthetic=${cases.filter((c) => c.source === "synthetic").length}, ` +
    `visitor=${cases.filter((c) => c.source === "visitor").length}; ` +
    `with tyler_answer=${cases.filter((c) => c.tyler_answer != null).length}; ` +
    `essay fixtures=${essays.length})`,
);
