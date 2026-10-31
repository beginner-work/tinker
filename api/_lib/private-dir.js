/* Resolve the optional private materials root.
 *
 * Production / local owners point TINKER_PRIVATE_DIR at a checkout of the
 * private Lindow Labs pack (ask corpus, tuned interview prompts, ask eval
 * bank, outreach-from map). The public repo ships safe defaults and works
 * without that directory.
 *
 * Layout under TINKER_PRIVATE_DIR mirrors public paths where possible:
 *   interview-prompt/prompts.json
 *   api/_lib/ask-sources/<sourceId>/
 *   evals/ask/{cases,dataset,fixtures,rubric*.md,THRESHOLDS.md}
 *   snippets/outreach-from-defaults.json
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function privateRoot(env) {
  const e = env || process.env;
  const raw = String(e.TINKER_PRIVATE_DIR || "").trim();
  if (!raw) return "";
  try {
    const abs = path.resolve(raw);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
  } catch {
    /* ignore */
  }
  return "";
}

function privatePath(...parts) {
  const root = privateRoot();
  if (!root) return "";
  return path.join(root, ...parts);
}

function readPrivateJson(relParts, env) {
  const root = privateRoot(env);
  if (!root) return null;
  const file = path.join(root, ...relParts);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readPrivateText(relParts, env) {
  const root = privateRoot(env);
  if (!root) return "";
  const file = path.join(root, ...relParts);
  try {
    if (!fs.existsSync(file)) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

module.exports = {
  privateRoot,
  privatePath,
  readPrivateJson,
  readPrivateText,
};
