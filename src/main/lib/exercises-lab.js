/* Learning exercises lab: local clone path, git ensure, and IDE open plan.
 *
 * Pure helpers for Node tests. The Electron main process injects fs,
 * spawn, and shell.openPath. The renderer never talks to git directly.
 */
"use strict";

const path = require("path");
const { expandHome } = require("./custom-path.js");

const REPO_SLUG = "tlindow/lindowlabs";
const REPO_HTTPS = "https://github.com/tlindow/lindowlabs.git";
const GITHUB_TREE =
  "https://github.com/tlindow/lindowlabs/tree/main/exercises";

const MODULE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function defaultClonePath(homeDir) {
  const home = String(homeDir || "").trim();
  if (!home) return path.join("lindowlabs");
  return path.join(home, "lindowlabs");
}

function resolveClonePath(configured, homeDir) {
  const raw = String(configured == null ? "" : configured).trim();
  if (!raw) return defaultClonePath(homeDir);
  return expandHome(raw, homeDir);
}

function githubModuleUrl(moduleId) {
  const id = String(moduleId || "").trim();
  if (!MODULE_ID_RE.test(id)) {
    const err = new Error("Unknown exercise module.");
    err.code = "BAD_MODULE";
    throw err;
  }
  return GITHUB_TREE + "/" + encodeURIComponent(id);
}

function assertModuleId(moduleId, allowedIds) {
  const id = String(moduleId || "").trim();
  if (!MODULE_ID_RE.test(id)) {
    const err = new Error("Unknown exercise module.");
    err.code = "BAD_MODULE";
    throw err;
  }
  if (Array.isArray(allowedIds) && allowedIds.length) {
    if (allowedIds.indexOf(id) === -1) {
      const err = new Error("Unknown exercise module.");
      err.code = "BAD_MODULE";
      throw err;
    }
  }
  return id;
}

function moduleAbsPath(cloneRoot, moduleId, allowedIds) {
  const id = assertModuleId(moduleId, allowedIds);
  const root = path.resolve(String(cloneRoot || ""));
  const target = path.resolve(root, "exercises", id);
  const rel = path.relative(root, target);
  if (!root || rel.startsWith("..") || path.isAbsolute(rel)) {
    const err = new Error("Module path escapes the lab folder.");
    err.code = "PATH_ESCAPE";
    throw err;
  }
  return target;
}

/**
 * Decide how to open a module.
 * Desktop with no IDE command → OS default handler (openPath).
 * Desktop with IDE command → spawn that command with the folder path.
 * Web / phone → GitHub URL fallback.
 */
function chooseOpenAction(opts) {
  const options = opts || {};
  const githubUrl = String(options.githubUrl || "");
  if (!options.isDesktop) {
    return { kind: "github", url: githubUrl };
  }
  const folder = String(options.moduleAbsPath || "");
  if (!folder) {
    const err = new Error("Missing module folder.");
    err.code = "NO_FOLDER";
    throw err;
  }
  const ide = String(options.ideCommand || "").trim();
  if (!ide) {
    return { kind: "openPath", path: folder };
  }
  const parts = splitCommand(ide);
  if (!parts.command) {
    return { kind: "openPath", path: folder };
  }
  return {
    kind: "command",
    command: parts.command,
    args: parts.args.concat([folder]),
  };
}

/** Simple argv split: respects double quotes, no shell expansion. */
function splitCommand(raw) {
  const input = String(raw || "").trim();
  if (!input) return { command: "", args: [] };
  const tokens = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) tokens.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return { command: tokens[0] || "", args: tokens.slice(1) };
}

function isGitRepoSync(dir, fsApi) {
  const fs = fsApi || require("fs");
  try {
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
}

/**
 * Clone the lab repo on first use; pull when it already exists.
 * `run(cmd, args, cwd)` must return a Promise that resolves on exit 0.
 */
async function ensureLabRepo(opts) {
  const options = opts || {};
  const clonePath = path.resolve(String(options.clonePath || ""));
  const fsApi = options.fs || require("fs");
  const run = options.run;
  if (!clonePath) {
    const err = new Error("Clone path is empty.");
    err.code = "EMPTY_PATH";
    throw err;
  }
  if (typeof run !== "function") {
    const err = new Error("Git runner is missing.");
    err.code = "NO_RUNNER";
    throw err;
  }

  const exists = fsApi.existsSync(clonePath);
  if (!exists) {
    const parent = path.dirname(clonePath);
    if (!fsApi.existsSync(parent)) {
      fsApi.mkdirSync(parent, { recursive: true });
    }
    await run("git", ["clone", REPO_HTTPS, clonePath], parent);
    return { action: "clone", path: clonePath };
  }

  if (!isGitRepoSync(clonePath, fsApi)) {
    const err = new Error(
      "That folder exists but is not a git clone of " + REPO_SLUG + "."
    );
    err.code = "NOT_GIT";
    throw err;
  }

  await run("git", ["pull", "--ff-only"], clonePath);
  return { action: "pull", path: clonePath };
}

function normalizeSettings(raw, homeDir) {
  const src = raw && typeof raw === "object" ? raw : {};
  const clonePath = resolveClonePath(src.clonePath, homeDir);
  const ideCommand = String(src.ideCommand == null ? "" : src.ideCommand).trim();
  return {
    clonePath,
    ideCommand,
    repo: REPO_SLUG,
    defaultClonePath: defaultClonePath(homeDir),
  };
}

module.exports = {
  REPO_SLUG,
  REPO_HTTPS,
  GITHUB_TREE,
  MODULE_ID_RE,
  defaultClonePath,
  resolveClonePath,
  githubModuleUrl,
  assertModuleId,
  moduleAbsPath,
  chooseOpenAction,
  splitCommand,
  isGitRepoSync,
  ensureLabRepo,
  normalizeSettings,
};
