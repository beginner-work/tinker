"use strict";

const { DEPTH_LEVELS, DEPTH_MAX_LEVEL } = require("./schema.js");
const { depthFromJevScore } = require("./update.js");
const {
  AI_GATEWAY_SYSTEMONE,
  resolveGatewayAuth,
} = require("./gateway.js");

/** Floating / product default on AI Gateway. */
const DEFAULT_MODEL = "typesafe-ai/jev";
/** Pinned for eval reproducibility (set JEV_MODEL or eval runners pin this). */
const EVAL_PINNED_MODEL = "typesafe-ai/jev-1.14.0";

/**
 * Resolve Jev via Vercel AI Gateway only (TypeSafe System One surface).
 * Auth: AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveJevConfig(env) {
  const e = env || process.env;
  const auth = resolveGatewayAuth(e);
  if (!auth.available) {
    return {
      available: false,
      baseUrl: "",
      apiKey: "",
      model: "",
      provider: null,
      authSource: null,
    };
  }
  // Eval runners set JEV_EVAL_PIN=1 (or JEV_MODEL) for reproducibility.
  const pinEval =
    String(e.JEV_EVAL_PIN || e.TINKER_EVAL_PIN_JEV || "").trim() === "1";
  const defaultModel = pinEval ? EVAL_PINNED_MODEL : DEFAULT_MODEL;
  return {
    available: true,
    baseUrl: String(e.JEV_SYSTEMONE_URL || AI_GATEWAY_SYSTEMONE).trim(),
    apiKey: auth.token,
    model: String(e.JEV_MODEL || defaultModel).trim(),
    provider: "ai-gateway",
    authSource: auth.source,
  };
}

/**
 * Low-level System One call (Score / Noul / Choice) through AI Gateway.
 * @param {{ state: unknown, questions: Record<string, unknown>, model?: string }} body
 * @param {{ fetchFn?: typeof fetch, env?: NodeJS.ProcessEnv }} [opts]
 */
async function systemOne(body, opts) {
  const cfg = resolveJevConfig(opts && opts.env);
  if (!cfg.available) {
    throw Object.assign(
      new Error(
        "Jev unavailable: set AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN on Vercel)",
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
 * @param {{ conceptTitle: string, state: unknown, question?: object, model?: string }} input
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
      model: input.model,
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
 * @param {{ state: unknown, sourceTitle?: string, question?: object, threshold?: number, model?: string }} input
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
      model: input.model,
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
  AI_GATEWAY_SYSTEMONE,
  DEFAULT_MODEL,
  EVAL_PINNED_MODEL,
  DEPTH_MAX_LEVEL,
  resolveJevConfig,
  systemOne,
  scoreDepth,
  noulSourceInZpd,
};
