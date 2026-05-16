#!/usr/bin/env node
// Eval harness for the product-spec skill.
// For each test case under cases/, builds a single-shot prompt that includes
// SKILL.md plus a simulated set of user answers, calls the Anthropic API to
// produce a build-prompt.md, then runs assertions against the output.
//
// Run from repo root: `npm run eval:product-spec`
// Auth: prefers CLAUDE_CODE_OAUTH_TOKEN (from the Claude Code GitHub App), falls
//       back to ANTHROPIC_API_KEY. One of them must be set.
// Optional: EVAL_DUMP_FAILURES=1 prints the full build prompt for any failed case.
// Optional: EVAL_MODEL=claude-... overrides the model.
// Optional: EVAL_CASE=01-... runs a single case by filename prefix.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(__dirname, "..", "SKILL.md");
const CASES_DIR = join(__dirname, "cases");
const FIXTURES_DIR = join(__dirname, "fixtures");
const MODEL = process.env.EVAL_MODEL || "claude-sonnet-4-6";

const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const apiKey = process.env.ANTHROPIC_API_KEY;

if (!oauthToken && !apiKey) {
  console.error("Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set. Export one before running.");
  process.exit(2);
}

const client = oauthToken
  ? new Anthropic({ authToken: oauthToken, apiKey: null })
  : new Anthropic({ apiKey });

console.log(`Auth: ${oauthToken ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY"}`);

function loadFixtures(names) {
  if (!names || names.length === 0) return "(none)";
  return names
    .map((name) => {
      const path = join(FIXTURES_DIR, name);
      if (!existsSync(path)) return `--- ${name} (missing) ---`;
      return `--- ${name} ---\n${readFileSync(path, "utf8")}`;
    })
    .join("\n\n");
}

function buildPrompt(skillContent, testCase) {
  const fixtures = loadFixtures(testCase.context_files);
  const phase1 = Object.entries(testCase.phase1 || {})
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");
  const phase2 = Object.entries(testCase.phase2 || {})
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(" | ") : v}`)
    .join("\n");

  return `You are running the product-spec skill defined below. The user's situation, their answers to all questions, and any context files are provided. Run the skill as if you'd just finished Phase 1 and Phase 2 with the user — then produce Phase 3's build-prompt.md output.

The skill instructs you to organize the answers into an internal 13-section scaffold (do NOT write that scaffold), then synthesize the build prompt from it. Assume there is no prior build-prompt.md in the working directory, so the version is v0.100.

Output ONLY the markdown of build-prompt.md. No preamble, no closing remarks, no fenced code block wrapping. Start with "# Build ".

==== SKILL ====
${skillContent}

==== USER IDEA ====
${testCase.user_idea}

==== USER ANSWERS ====
Platform target (Phase 1 prelude): ${testCase.platform_target || "[not asked]"}

Phase 1 (foundation):
${phase1}

Phase 2 (narrowing):
${phase2}

==== CONTEXT FILES (working directory) ====
${fixtures}

Now produce build-prompt.md. Begin with "# Build ".`;
}

async function runCase(testCase) {
  const skillContent = readFileSync(SKILL_PATH, "utf8");
  const prompt = buildPrompt(skillContent, testCase);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "text");
  return block ? block.text : "";
}

const ASSERTION_HANDLERS = {
  contains: (spec, a) => {
    const found = spec.includes(a.value);
    return { pass: found, detail: found ? `contains "${a.value}"` : `missing "${a.value}"` };
  },
  contains_ci: (spec, a) => {
    const found = spec.toLowerCase().includes(a.value.toLowerCase());
    return { pass: found, detail: found ? `contains "${a.value}" (ci)` : `missing "${a.value}" (ci)` };
  },
  not_contains: (spec, a) => {
    const found = spec.includes(a.value);
    return { pass: !found, detail: found ? `should not contain "${a.value}"` : `correctly absent: "${a.value}"` };
  },
  not_contains_ci: (spec, a) => {
    const found = spec.toLowerCase().includes(a.value.toLowerCase());
    return { pass: !found, detail: found ? `should not contain "${a.value}" (ci)` : `correctly absent: "${a.value}" (ci)` };
  },
  regex: (spec, a) => {
    const re = new RegExp(a.value, a.flags || "");
    const found = re.test(spec);
    return { pass: found, detail: found ? `matched /${a.value}/${a.flags || ""}` : `no match for /${a.value}/${a.flags || ""}` };
  },
  regex_no_match: (spec, a) => {
    const re = new RegExp(a.value, a.flags || "");
    const found = re.test(spec);
    return { pass: !found, detail: found ? `should not match /${a.value}/${a.flags || ""}` : `correctly no match: /${a.value}/${a.flags || ""}` };
  },
  any_of: (spec, a) => {
    const matches = a.values.filter((v) => spec.toLowerCase().includes(v.toLowerCase()));
    return {
      pass: matches.length > 0,
      detail: matches.length > 0 ? `matched any-of: ${matches.join(", ")}` : `none of: ${a.values.join(", ")}`,
    };
  },
};

function runAssertions(spec, assertions) {
  return assertions.map((a) => {
    const handler = ASSERTION_HANDLERS[a.type];
    if (!handler) return { pass: false, type: a.type, label: a.label, detail: `unknown assertion type: ${a.type}` };
    const r = handler(spec, a);
    return { pass: r.pass, type: a.type, label: a.label, detail: r.detail };
  });
}

async function main() {
  const filter = process.env.EVAL_CASE;
  let cases = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json")).sort();
  if (filter) cases = cases.filter((f) => f.startsWith(filter));

  if (cases.length === 0) {
    console.error(`No test cases found${filter ? ` matching "${filter}"` : ""}.`);
    process.exit(2);
  }

  console.log(`Running ${cases.length} case${cases.length === 1 ? "" : "s"} against model ${MODEL}\n`);

  let totalPass = 0;
  let totalFail = 0;
  const failedCases = [];

  for (const caseFile of cases) {
    const fullPath = join(CASES_DIR, caseFile);
    const testCase = JSON.parse(readFileSync(fullPath, "utf8"));
    console.log(`=== ${testCase.name}  (${caseFile}) ===`);

    let spec;
    try {
      spec = await runCase(testCase);
    } catch (err) {
      console.error(`  RUN ERROR: ${err.message}\n`);
      totalFail += testCase.assertions.length;
      failedCases.push({ name: testCase.name, error: err.message });
      continue;
    }

    const results = runAssertions(spec, testCase.assertions);
    let casePass = 0;
    let caseFail = 0;

    for (const r of results) {
      const symbol = r.pass ? "PASS" : "FAIL";
      const label = r.label ? ` ${r.label}` : "";
      console.log(`  [${symbol}]${label}  (${r.type}) ${r.detail}`);
      if (r.pass) {
        totalPass++;
        casePass++;
      } else {
        totalFail++;
        caseFail++;
      }
    }
    console.log(`  -- ${casePass}/${casePass + caseFail} passed\n`);

    if (caseFail > 0) failedCases.push({ name: testCase.name, casePass, caseFail, spec });
  }

  console.log(`=== SUMMARY: ${totalPass} pass, ${totalFail} fail across ${cases.length} case${cases.length === 1 ? "" : "s"} ===`);

  if (process.env.EVAL_DUMP_FAILURES === "1") {
    for (const fc of failedCases) {
      if (!fc.spec) continue;
      console.log(`\n=== FAILED SPEC: ${fc.name} ===\n${fc.spec}\n`);
    }
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
