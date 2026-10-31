/* Deterministic + Claude-as-judge scorers for tinker-ask.
 * No OpenAI. Judge calls Anthropic via api/_lib/anthropic.js.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { callAnthropic } = require("../../../api/_lib/anthropic.js");
const models = require("../../../src/renderer/lib/claude-models.js");

const RUBRIC_PATH = path.join(__dirname, "..", "rubric-agreement.md");
const RUBRIC_GROUNDING_PATH = path.join(__dirname, "..", "rubric.md");

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

/** Braintrust scorer: 1 if answer passes deterministic expect block. */
function KeywordExpect({ output, expected }) {
  const expect = (expected && expected.expect) || expected || {};
  const answerText =
    typeof output === "string" ? output : String((output && output.answerText) || "");
  const failures = [];
  const sentences = countSentences(answerText);

  if (expect.minSentences != null && sentences < expect.minSentences) {
    failures.push(`sentences ${sentences} < ${expect.minSentences}`);
  }
  if (expect.maxSentences != null && sentences > expect.maxSentences) {
    failures.push(`sentences ${sentences} > ${expect.maxSentences}`);
  }
  if (expect.mustIncludeAny && expect.mustIncludeAny.length) {
    if (!includesAny(answerText, expect.mustIncludeAny)) {
      failures.push(`missing any of: ${expect.mustIncludeAny.join(" | ")}`);
    }
  }
  if (expect.mustIncludeAll && expect.mustIncludeAll.length) {
    for (const n of expect.mustIncludeAll) {
      if (!includesAny(answerText, [n])) failures.push(`missing: ${n}`);
    }
  }
  if (expect.mustNotIncludeAny && expect.mustNotIncludeAny.length) {
    if (!includesNone(answerText, expect.mustNotIncludeAny)) {
      failures.push(`forbidden hit: ${expect.mustNotIncludeAny.join(" | ")}`);
    }
  }
  if (expect.mustIncludeAnyOfGroups) {
    for (const group of expect.mustIncludeAnyOfGroups) {
      if (!includesAny(answerText, group)) {
        failures.push(`missing group: ${group.join(" | ")}`);
      }
    }
  }
  if (expect.mustMatchAny && expect.mustMatchAny.length) {
    const ok = expect.mustMatchAny.some((re) => new RegExp(re, "i").test(answerText));
    if (!ok) failures.push(`matched none of: ${expect.mustMatchAny.join(" | ")}`);
  }

  // No deterministic expect → skip (null), don't invent a pass.
  const hasRules =
    expect.minSentences != null ||
    expect.maxSentences != null ||
    (expect.mustIncludeAny && expect.mustIncludeAny.length) ||
    (expect.mustIncludeAll && expect.mustIncludeAll.length) ||
    (expect.mustNotIncludeAny && expect.mustNotIncludeAny.length) ||
    (expect.mustIncludeAnyOfGroups && expect.mustIncludeAnyOfGroups.length) ||
    (expect.mustMatchAny && expect.mustMatchAny.length);
  if (!hasRules) return null;

  return {
    name: "KeywordExpect",
    score: failures.length === 0 ? 1 : 0,
    metadata: { failures, sentences },
  };
}

function SentenceBudget({ output, expected }) {
  const expect = (expected && expected.expect) || {};
  const answerText =
    typeof output === "string" ? output : String((output && output.answerText) || "");
  const sentences = countSentences(answerText);
  const min = expect.minSentences != null ? expect.minSentences : 1;
  const max = expect.maxSentences != null ? expect.maxSentences : 4;
  const ok = sentences >= min && sentences <= max;
  return {
    name: "SentenceBudget",
    score: ok ? 1 : 0,
    metadata: { sentences, min, max },
  };
}

/** Combined pass for CI gate: KeywordExpect when present.
 *  Agreement / open rows without expect rules are skipped (null) so
 *  SentenceBudget noise does not dilute the CasePass floor. */
function CasePass(args) {
  const kw = KeywordExpect(args);
  if (kw && typeof kw.score === "number") {
    return { name: "CasePass", score: kw.score, metadata: kw.metadata };
  }
  return null;
}

function parseJudgeJson(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function TylerAgreement({ input, output, expected }) {
  const tylerAnswer =
    (expected && expected.tyler_answer) ||
    (expected && expected.tylerAnswer) ||
    (input && input.tyler_answer) ||
    null;
  if (tylerAnswer == null || String(tylerAnswer).trim() === "") {
    return null; // skip — schema allows null until Tyler attaches a reference
  }
  const question =
    (input && (input.question || input)) ||
    (expected && expected.question) ||
    "";
  const answerText =
    typeof output === "string" ? output : String((output && output.answerText) || "");
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: "TylerAgreement",
      score: 0,
      metadata: { error: "ANTHROPIC_API_KEY missing; not fabricating a pass" },
    };
  }
  const rubric = fs.readFileSync(RUBRIC_PATH, "utf8");
  const result = await callAnthropic({
    system: rubric,
    messages: [
      {
        role: "user",
        content: [
          `PROMPT:\n${question}`,
          `TYLER_REFERENCE:\n${String(tylerAnswer).slice(0, 12000)}`,
          `CANDIDATE:\n${answerText.slice(0, 4000)}`,
        ].join("\n\n"),
      },
    ],
    model: process.env.ASK_JUDGE_MODEL || models.FAST || "claude-haiku-4-5-20251001",
    maxTokens: 300,
  });
  const parsed = parseJudgeJson(result.text);
  if (!parsed || (parsed.score !== 0 && parsed.score !== 1 && parsed.pass == null)) {
    return {
      name: "TylerAgreement",
      score: 0,
      metadata: { error: "judge_parse_failed", raw: String(result.text || "").slice(0, 400) },
    };
  }
  const score = parsed.score === 1 || parsed.pass === true ? 1 : 0;
  return {
    name: "TylerAgreement",
    score,
    metadata: { reason: parsed.reason || "", pass: score === 1 },
  };
}

async function GroundingJudge({ input, output, expected }) {
  const category = (expected && expected.category) || (input && input.category) || "";
  if (category === "agreement") return null;
  const expect = (expected && expected.expect) || {};
  if (expect.judge === false) return null;
  // Only when asked (expect.judge === true) or safety categories.
  const needs =
    expect.judge === true ||
    category === "refusal" ||
    category === "off_topic" ||
    category === "prompt_injection";
  if (!needs) return null;
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: "GroundingJudge",
      score: 0,
      metadata: { error: "ANTHROPIC_API_KEY missing; not fabricating a pass" },
    };
  }
  const rubric = fs.existsSync(RUBRIC_GROUNDING_PATH)
    ? fs.readFileSync(RUBRIC_GROUNDING_PATH, "utf8")
    : "Score pass/fail JSON for grounded ask answers.";
  const question =
    (input && (input.question || input)) || (expected && expected.question) || "";
  const answerText =
    typeof output === "string" ? output : String((output && output.answerText) || "");
  const result = await callAnthropic({
    system: rubric,
    messages: [
      {
        role: "user",
        content: `Category: ${category}\n\nQUESTION:\n${question}\n\nANSWER:\n${answerText}`,
      },
    ],
    model: process.env.ASK_JUDGE_MODEL || models.FAST || "claude-haiku-4-5-20251001",
    maxTokens: 300,
  });
  const parsed = parseJudgeJson(result.text);
  if (!parsed) {
    return {
      name: "GroundingJudge",
      score: 0,
      metadata: { error: "judge_parse_failed" },
    };
  }
  const score = parsed.score === 1 || parsed.pass === true ? 1 : 0;
  return {
    name: "GroundingJudge",
    score,
    metadata: { reason: parsed.reason || "" },
  };
}

/** Reading-agent: did we fetch a linked source when the case expected it? */
function ToolUseDecision({ output, expected }) {
  const expect = (expected && expected.expect) || {};
  if (typeof expect.shouldFetchLink !== "boolean") return null;
  const toolUsed = Boolean(output && output.toolUsed);
  const failures = [];
  if (toolUsed !== expect.shouldFetchLink) {
    failures.push(
      `toolUsed=${toolUsed} expected shouldFetchLink=${expect.shouldFetchLink}`,
    );
  }
  if (expect.shouldFetchLink && expect.fetchUrlIncludes) {
    const url = String((output && output.fetchedSourceUrl) || "");
    if (!url.toLowerCase().includes(String(expect.fetchUrlIncludes).toLowerCase())) {
      failures.push(`fetchedSourceUrl missing ${expect.fetchUrlIncludes}: ${url}`);
    }
  }
  return {
    name: "ToolUseDecision",
    score: failures.length === 0 ? 1 : 0,
    metadata: {
      failures,
      toolUsed,
      fetchedSourceUrl: (output && output.fetchedSourceUrl) || "",
    },
  };
}

/** Reading-agent: resume cursor preserved after interrupt. */
function ResumeAfterInterrupt({ output, expected, input }) {
  const expect = (expected && expected.expect) || {};
  if (expect.resumeWordIndex == null) return null;
  const got =
    output && typeof output.resumeWordIndex === "number"
      ? output.resumeWordIndex
      : input && input.position && typeof input.position.wordIndex === "number"
        ? input.position.wordIndex
        : null;
  const ok = got === expect.resumeWordIndex;
  return {
    name: "ResumeAfterInterrupt",
    score: ok ? 1 : 0,
    metadata: { expected: expect.resumeWordIndex, got },
  };
}

module.exports = {
  countSentences,
  KeywordExpect,
  SentenceBudget,
  CasePass,
  TylerAgreement,
  GroundingJudge,
  ToolUseDecision,
  ResumeAfterInterrupt,
  parseJudgeJson,
};
