/**
 * INTERNAL Braintrust eval for source-ZPD recommendation hit rate.
 * Cases + hidden keys live in-repo. Marked internal in metadata.
 */
import { Eval } from "braintrust";
import { createRequire } from "node:module";

const require = createRequire(__filename);
const { loadCasesWithKey } = require("./lib/load.js");
const { runTinkerCase, runClaudeCase } = require("./lib/runners.js");

const cases = loadCasesWithKey();

Eval("tinker-source-zpd", {
  experimentName: "source-zpd-hit-rate",
  maxConcurrency: 2,
  metadata: {
    internal: true,
    caseCount: cases.length,
  },
  data: () =>
    cases.map((c: { id: string; inBandSourceIds: string[] }, i: number) => ({
      input: { index: i, id: c.id },
      expected: { inBandSourceIds: c.inBandSourceIds },
    })),
  task: async (input) => {
    const c = cases[input.index];
    const tinker = await runTinkerCase(c, { useJev: false });
    let claude;
    if (
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.ANTHROPIC_API_KEY
    ) {
      claude = await runClaudeCase(c);
    } else {
      claude = {
        skipped: true,
        reason: "AI_GATEWAY_API_KEY|ANTHROPIC_API_KEY missing",
        hit: false,
      };
    }
    return { tinker, claude };
  },
  scores: [
    (args) => ({
      name: "TinkerHit",
      score: args.output?.tinker?.hit ? 1 : 0,
    }),
    (args) => {
      if (args.output?.claude?.skipped) {
        return { name: "ClaudeHit", score: null, metadata: { skipped: true } };
      }
      return {
        name: "ClaudeHit",
        score: args.output?.claude?.hit ? 1 : 0,
      };
    },
  ],
});

console.error(
  `[source-zpd] internal cases=${cases.length} (keys hidden from model prompts)`,
);
