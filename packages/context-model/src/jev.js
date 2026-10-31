"use strict";

const { DEPTH_LEVELS, DEPTH_MAX_LEVEL } = require("./schema.js");
const { depthFromJevScore } = require("./update.js");

const OPENROUTER_SYSTEMONE = "https://openrouter.ai/api/v1/systemone";
const TYPESAFE_SYSTEMONE = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const OPENROUTER_MODEL = "typesafe/jev-latest";

/**
 * Resolve which System One endpoint and key to use.
 * Prefers TYPESAFE_API_KEY → api.typesafe.ai; else OPENROUTER_API_KEY.
 */
function resolveJevConfig(env) {
  const e = env || process.env;
  const typesafeKey = String(e.TYPESAFE_API_KEY || "").trim();
  const openRouterKey = String(e.OPENROUTER_API_KEY || "").trim();
  if (typesafeKey) {
    return {
      available: true,
      baseUrl: String(e.TYPESAFE_SYSTEMONE_URL || TYPESAFE_SYSTEMONE).trim(),
      apiKey: typesafeKey,
      model: String(e.JEV_MODEL || DEFAULT_MODEL).trim(),
      provider: "typesafe",
    };
  }
  if (openRouterKey) {
    return {
      available: true,
      baseUrl: String(e.OPENROUTER_SYSTEMONE_URL || OPENROUTER_SYSTEMONE).trim(),
      apiKey: openRouterKey,
      model: String(e.JEV_MODEL || OPENROUTER_MODEL).trim(),
      provider: "openrouter",
    };
  }
  return { available: false, baseUrl: "", apiKey: "", model: "", provider: null };
}

/**
 * Low-level System One call (Score / Noul / Choice).
 * @param {{ state: unknown, questions: Record<string, unknown>, model?: string }} body
 * @param {{ fetchFn?: typeof fetch, env?: NodeJS.ProcessEnv }} [opts]
 */
async function systemOne(body, opts) {
  const cfg = resolveJevConfig(opts && opts.env);
  if (!cfg.available) {
    throw Object.assign(
      new Error(
        "Jev unavailable: set TYPESAFE_API_KEY or OPENROUTER_API_KEY",
      ),
      { code: "JEV_UNAVAILABLE" },
    );
  }
  const fetchFn = (opts && opts.fetchFn) || globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is not available");
  }
  const res = await fetchFn(cfg.baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      state: body.state,
      model: body.model || cfg.model,
      questions: body.questions,
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error(`Jev returned non-JSON (${res.status})`), {
      status: res.status,
      body: text.slice(0, 500),
    });
  }
  if (!res.ok) {
    throw Object.assign(
      new Error(
        (json && (json.error || json.message)) ||
          `Jev HTTP ${res.status}`,
      ),
      { status: res.status, body: json },
    );
  }
  return json;
}

/**
 * Score learner depth. Prefer a versioned question from eval config.
 *
 * @param {{ conceptTitle: string, state: unknown, question?: object }} input
 * @param {{ fetchFn?: typeof fetch, env?: NodeJS.ProcessEnv }} [opts]
 */
async function scoreDepth(input, opts) {
  const criteria =
    (input.question && input.question.criteria) ||
    DEPTH_LEVELS.map((l) => l.label);
  const instructions =
    (input.question && input.question.instructions) ||
    `How deep is the learner's understanding of: ${input.conceptTitle}?`;
  const response = await systemOne(
    {
      state: input.state,
      questions: {
        depth: {
          type: "score",
          instructions,
          criteria,
        },
      },
    },
    opts,
  );
  const answer = response && response.answers && response.answers.depth;
  if (!answer || answer.type !== "score") {
    throw new Error("Jev depth Score missing from response");
  }
  const maxLevel = Math.max(1, criteria.length - 1);
  return {
    score: Number(answer.score) || 0,
    confidence: Number(answer.confidence) || 0,
    probabilities: answer.probabilities || {},
    depth: clamp01((Number(answer.score) || 0) / maxLevel),
    maxLevel,
    raw: answer,
  };
}

/**
 * Noul: is this source just past the learner's current depth?
 * @param {{ state: unknown, sourceTitle?: string, question?: object, threshold?: number }} input
 * @param {{ fetchFn?: typeof fetch, env?: NodeJS.ProcessEnv }} [opts]
 */
async function noulSourceInZpd(input, opts) {
  const title = input.sourceTitle ? input.sourceTitle : "";
  const q = input.question || {
    type: "noul",
    instructions: `This source (${title}) is just past the learner's current depth (in their zone of proximal development: challenging but reachable with light support), not too easy and not too hard.`,
    criteria: {
      true: "Source difficulty sits slightly above what the learner already demonstrates; they would stretch productively.",
      false: "Source is clearly below (busywork) or clearly above (overwhelming) the learner's demonstrated depth.",
    },
  };
  const threshold =
    typeof input.threshold === "number" ? input.threshold : 0.55;
  const response = await systemOne(
    {
      state: input.state,
      questions: {
        just_past_depth: {
          type: "noul",
          instructions: q.instructions,
          criteria: q.criteria,
        },
      },
    },
    opts,
  );
  const answer =
    response && response.answers && response.answers.just_past_depth;
  if (!answer || answer.type !== "noul") {
    throw new Error("Jev Noul missing from response");
  }
  return {
    noul: Number(answer.noul) || 0,
    inZpd: (Number(answer.noul) || 0) >= threshold,
    raw: answer,
  };
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

module.exports = {
  OPENROUTER_SYSTEMONE,
  TYPESAFE_SYSTEMONE,
  DEFAULT_MODEL,
  OPENROUTER_MODEL,
  DEPTH_MAX_LEVEL,
  resolveJevConfig,
  systemOne,
  scoreDepth,
  noulSourceInZpd,
};
