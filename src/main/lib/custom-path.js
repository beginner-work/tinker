/* Resolve a typed filesystem path for the Location dropdown.
 * Expands ~ to home, creates the folder if missing, and checks writability.
 * Pure helpers; pass a fake home + fs stubs in tests.
 */
"use strict";

const path = require("path");
const fs = require("fs");

function defaultFs() {
  return {
    existsSync: fs.existsSync.bind(fs),
    mkdirSync: fs.mkdirSync.bind(fs),
    accessSync: fs.accessSync.bind(fs),
    constants: fs.constants,
    statSync: fs.statSync.bind(fs),
  };
}

function expandHome(rawPath, homeDir) {
  const home = String(homeDir || "").trim();
  let input = String(rawPath == null ? "" : rawPath).trim();
  if (!input) {
    const err = new Error("Enter a folder path.");
    err.code = "EMPTY";
    throw err;
  }
  if (input === "~") {
    if (!home) {
      const err = new Error("Home folder is unavailable.");
      err.code = "NO_HOME";
      throw err;
    }
    return path.resolve(home);
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    if (!home) {
      const err = new Error("Home folder is unavailable.");
      err.code = "NO_HOME";
      throw err;
    }
    return path.resolve(path.join(home, input.slice(2)));
  }
  return path.resolve(input);
}

function shortLabel(absPath, homeDir) {
  const abs = String(absPath || "").replace(/\\/g, "/");
  const home = String(homeDir || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (home && (abs === home || abs.startsWith(home + "/"))) {
    return abs === home ? "~" : "~" + abs.slice(home.length);
  }
  return abs;
}

/**
 * Expand, create, and validate a custom storage path.
 * @returns {{path:string,name:string,id:string,label:string}}
 */
function useCustomPath(rawPath, opts) {
  const options = opts || {};
  const homeDir = options.homeDir || process.env.HOME || "";
  const fsApi = options.fs || defaultFs();
  const target = expandHome(rawPath, homeDir);

  try {
    if (!fsApi.existsSync(target)) {
      fsApi.mkdirSync(target, { recursive: true });
    } else {
      const st = fsApi.statSync(target);
      if (!st || typeof st.isDirectory !== "function" || !st.isDirectory()) {
        const err = new Error("That path is not a folder.");
        err.code = "NOT_DIR";
        throw err;
      }
    }
  } catch (err) {
    if (err && (err.code === "NOT_DIR" || err.code === "EMPTY" || err.code === "NO_HOME")) {
      throw err;
    }
    const wrap = new Error("Could not create that folder.");
    wrap.code = "MKDIR";
    wrap.cause = err;
    throw wrap;
  }

  try {
    const mode = (fsApi.constants && fsApi.constants.W_OK) || 2;
    fsApi.accessSync(target, mode);
  } catch (err) {
    const wrap = new Error("That folder is not writable.");
    wrap.code = "NOT_WRITABLE";
    wrap.cause = err;
    throw wrap;
  }

  return {
    path: target,
    name: path.basename(target) || "Tinker",
    id: "custom",
    label: shortLabel(target, homeDir),
  };
}

module.exports = {
  expandHome,
  shortLabel,
  useCustomPath,
};
