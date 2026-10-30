#!/usr/bin/env node
/* Run the POST /api/ask grounded-answer eval set.
 *
 * Loads cases from evals/ask/cases/*.json, calls Claude with the same
 * prompt + corpus as production (no TTS — text-only scoring), and
 * checks sentence count + keyword expectations.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=… node scripts/eval-ask.js
 *   npm run eval:ask
 *
 * Options:
 *   --case <id>     run a single case id
 *   --dry-run       load cases + build prompts; no Anthropic call
 *   --json          print machine-readable summary
 *
 * Exit 0 only when every selected case passes.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ask = require("../api/_lib/ask.js");

const CASES_DIR = path.join(__dirname, "..", "evals", "ask", "cases");

function parseArgs(argv) {
  const out = { caseId: "", dryRun: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--case") out.caseId = String(argv[++i] || "").trim();
  }
  return out;
}

function loadCases(caseId) {
  const files = fs
    .readdirSync(CASES_DIR)
    .filter((n) => n.endsWith(".json"))
    .sort();
  const cases = files.map((name) => {
    const raw = fs.readFileSync(path.join(CASES_DIR, name), "utf8");
    return JSON.parse(raw);
  });
  if (!caseId) return cases;
  const filtered = cases.filter((c) => c.id === caseId || path.basename(c.id) === caseId);
  if (!filtered.length) {
    throw new Error(`No case matching --case ${caseId}`);
  }
  return filtered;
}

function countSentences(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  const parts = t.split(/(?<=[.!?])\s+/).filter((p) => p.trim().length > 0);
  return parts.length || 1;
}

function includesAny(haystack, needles) {
  const h = String(haystack || "").toLowerCase();
  return (needles || []).some((n) => h.includes(String(n).toLowerCase()));
}

function includesNone(haystack, needles) {
  const h = String(haystack || "").toLowerCase();
  return (needles || []).every((n) => !h.includes(String(n).toLowerCase()));
}

function scoreCase(c, answerText) {
  const expect = c.expect || {};
  const failures = [];
  const sentences = countSentences(answerText);

  if (expect.minSentences != null && sentences < expect.minSentences) {
    failures.push(`expected >= ${expect.minSentences} sentences, got ${sentences}`);
  }
  if (expect.maxSentences != null && sentences > expect.maxSentences) {
    failures.push(`expected <= ${expect.maxSentences} sentences, got ${sentences}`);
  }
  if (expect.mustIncludeAny && expect.mustIncludeAny.length) {
    if (!includesAny(answerText, expect.mustIncludeAny)) {
      failures.push(`missing any of: ${expect.mustIncludeAny.join(" | ")}`);
    }
  }
  if (expect.mustIncludeAll && expect.mustIncludeAll.length) {
    for (const n of expect.mustIncludeAll) {
      if (!includesAny(answerText, [n])) failures.push(`missing required: ${n}`);
    }
  }
  if (expect.mustNotIncludeAny && expect.mustNotIncludeAny.length) {
    if (!includesNone(answerText, expect.mustNotIncludeAny)) {
      failures.push(`contained forbidden: ${expect.mustNotIncludeAny.join(" | ")}`);
    }
  }
  if (expect.mustIncludeAnyOfGroups) {
    for (const group of expect.mustIncludeAnyOfGroups) {
      if (!includesAny(answerText, group)) {
        failures.push(`missing any of group: ${group.join(" | ")}`);
      }
    }
  }
  if (expect.mustMatchAny && expect.mustMatchAny.length) {
    const ok = expect.mustMatchAny.some((re) => new RegExp(re, "i").test(answerText));
    if (!ok) failures.push(`matched none of: ${expect.mustMatchAny.join(" | ")}`);
  }

  return { ok: failures.length === 0, failures, sentences };
}

async function runCase(c, { dryRun }) {
  const source = ask.loadSource(c.sourceId);
  if (!source) {
    return {
      id: c.id,
      ok: false,
      failures: [`unknown sourceId ${c.sourceId}`],
      answerText: "",
      latencyMs: 0,
    };
  }

  if (dryRun) {
    const user = ask.buildUserMessage({
      question: c.question,
      input: c.input || "typed",
      rawTranscript: c.rawTranscript || "",
      position: c.position || null,
      context: c.context || "",
      source,
    });
    return {
      id: c.id,
      ok: true,
      dryRun: true,
      failures: [],
      answerText: "",
      userChars: user.length,
      systemChars: source.systemPrompt.length,
      latencyMs: 0,
    };
  }

  const started = Date.now();
  const answered = await ask.answerWithClaude({
    source,
    question: c.question,
    input: c.input || "typed",
    rawTranscript: c.rawTranscript || "",
    position: c.position || null,
    context: c.context || "",
  });
  const latencyMs = Date.now() - started;
  const scored = scoreCase(c, answered.answerText);
  return {
    id: c.id,
    ok: scored.ok,
    failures: scored.failures,
    sentences: scored.sentences,
    answerText: answered.answerText,
    model: answered.model,
    latencyMs,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && !ask.anthropicApiKey()) {
    console.error("ANTHROPIC_API_KEY is not set. Use --dry-run to validate cases only.");
    process.exit(2);
  }

  const cases = loadCases(args.caseId);
  const results = [];
  for (const c of cases) {
    process.stderr.write(`→ ${c.id} … `);
    try {
      const r = await runCase(c, args);
      results.push(r);
      process.stderr.write(r.ok ? "pass\n" : "FAIL\n");
      if (!args.json && r.answerText) {
        console.log(`  answer: ${r.answerText}`);
      }
      if (!r.ok) {
        for (const f of r.failures) console.error(`  - ${f}`);
      }
    } catch (err) {
      const message = (err && err.message) || String(err);
      results.push({ id: c.id, ok: false, failures: [message], answerText: "", latencyMs: 0 });
      process.stderr.write("ERROR\n");
      console.error(`  - ${message}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const summary = {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\n${passed}/${results.length} passed`);
  }

  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
