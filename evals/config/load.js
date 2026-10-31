"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const PUBLIC_BASELINE = path.join(__dirname, "public-baseline");
const DEFAULT_PRIVATE = path.join(__dirname, "..", "private-config");

const REQUIRED_KEYS = [
  "jevDepthScore",
  "jevSourceNoul",
  "claudeZpdBand",
  "claudeSourcePick",
];

/**
 * Resolve which directory holds a config version.
 * @param {string} version
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveConfigDir(version, env) {
  const e = env || process.env;
  const ver = String(version || e.TINKER_EVAL_CONFIG_VERSION || "v0").trim();
  const customRoot = String(e.TINKER_EVAL_CONFIG_DIR || "").trim();
  const candidates = [];
  if (customRoot) candidates.push(path.resolve(customRoot, ver));
  candidates.push(path.join(DEFAULT_PRIVATE, ver));
  if (ver === "v0") candidates.push(path.join(PUBLIC_BASELINE, "v0"));

  for (const dir of candidates) {
    const manifest = path.join(dir, "manifest.json");
    if (fs.existsSync(manifest)) {
      return { version: ver, dir, source: describeSource(dir), manifestPath: manifest };
    }
  }
  throw new Error(
    `Eval config version "${ver}" not found. Looked in: ${candidates.join(", ")}. ` +
      `See evals/config/README.md.`,
  );
}

function describeSource(dir) {
  const normalized = path.normalize(dir);
  if (normalized.includes(`${path.sep}public-baseline${path.sep}`)) {
    return "public-baseline";
  }
  if (normalized.includes(`${path.sep}private-config${path.sep}`)) {
    return "private-config";
  }
  return "TINKER_EVAL_CONFIG_DIR";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Load a full versioned config pack.
 * @param {{ version?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
function loadEvalConfig(opts) {
  const env = (opts && opts.env) || process.env;
  const located = resolveConfigDir(opts && opts.version, env);
  const manifest = readJson(located.manifestPath);
  if (!manifest.files || typeof manifest.files !== "object") {
    throw new Error(`manifest missing files map: ${located.manifestPath}`);
  }

  const pack = {
    version: manifest.version || located.version,
    kind: manifest.kind || "unknown",
    agentModeling: Boolean(manifest.agentModeling),
    notes: manifest.notes || "",
    source: located.source,
    dir: located.dir,
    jevDepthScore: null,
    jevSourceNoul: null,
    claudeZpdBand: null,
    claudeSourcePick: null,
  };

  for (const key of REQUIRED_KEYS) {
    const rel = manifest.files[key];
    if (!rel) throw new Error(`manifest.files.${key} missing`);
    const abs = path.join(located.dir, rel);
    if (!fs.existsSync(abs)) throw new Error(`config file missing: ${abs}`);
    pack[key] = readJson(abs);
  }

  validateJevScore(pack.jevDepthScore);
  validateJevNoul(pack.jevSourceNoul);
  validateClaude(pack.claudeZpdBand);
  validateClaude(pack.claudeSourcePick);

  if (pack.agentModeling) {
    throw new Error(
      `Config ${pack.version} sets agentModeling=true; v0 loop baseline forbids agent modeling.`,
    );
  }

  return pack;
}

function validateJevScore(doc) {
  if (!doc || doc.type !== "score") throw new Error("jevDepthScore.type must be score");
  if (!doc.instructions) throw new Error("jevDepthScore.instructions required");
  if (!Array.isArray(doc.criteria) || doc.criteria.length < 2) {
    throw new Error("jevDepthScore.criteria must be an array of >=2 levels");
  }
}

function validateJevNoul(doc) {
  if (!doc || doc.type !== "noul") throw new Error("jevSourceNoul.type must be noul");
  if (!doc.instructions) throw new Error("jevSourceNoul.instructions required");
}

function validateClaude(doc) {
  if (!doc || !doc.system || !doc.userTemplate) {
    throw new Error("Claude config needs system and userTemplate");
  }
}

/**
 * Simple {{placeholder}} interpolation.
 * @param {string} template
 * @param {Record<string, string>} vars
 */
function renderTemplate(template, vars) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] != null ? String(vars[key]) : "";
  });
}

/**
 * Build System One Score question from config.
 */
function jevDepthQuestion(pack, conceptTitle) {
  const cfg = pack.jevDepthScore;
  return {
    type: "score",
    instructions: renderTemplate(cfg.instructions, { conceptTitle }),
    criteria: cfg.criteria.slice(),
  };
}

function jevSourceNoulQuestion(pack, sourceTitle) {
  const cfg = pack.jevSourceNoul;
  return {
    type: "noul",
    instructions: renderTemplate(cfg.instructions, {
      sourceTitle: sourceTitle || "",
    }),
    criteria: cfg.criteria || undefined,
  };
}

function noulThreshold(pack) {
  const t = pack.jevSourceNoul && pack.jevSourceNoul.threshold;
  return typeof t === "number" ? t : 0.55;
}

module.exports = {
  REPO_ROOT,
  PUBLIC_BASELINE,
  DEFAULT_PRIVATE,
  resolveConfigDir,
  loadEvalConfig,
  renderTemplate,
  jevDepthQuestion,
  jevSourceNoulQuestion,
  noulThreshold,
};
