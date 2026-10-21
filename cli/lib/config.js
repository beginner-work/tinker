"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_API_BASE = "https://tinker.beginner.work";

function configPath() {
  return process.env.TINKER_CONFIG || path.join(os.homedir(), ".tinker");
}

function readFileConfig() {
  const filePath = configPath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return data;
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    return {};
  }
}

function writeFileConfig(next) {
  const filePath = configPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(next, null, 2) + "\n";
  fs.writeFileSync(filePath, body, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore on platforms without chmod */
  }
}

function loadConfig() {
  const filePath = configPath();
  const file = readFileConfig();
  const apiBaseUrl = String(
    process.env.TINKER_API_BASE_URL ||
      process.env.TINKER_API_URL ||
      file.apiBaseUrl ||
      DEFAULT_API_BASE
  )
    .trim()
    .replace(/\/+$/, "");
  const token = String(
    process.env.TINKER_TOKEN ||
      process.env.TINKER_SESSION_TOKEN ||
      file.token ||
      ""
  ).trim();
  return { apiBaseUrl, token, configPath: filePath };
}

function saveToken(token, extras = {}) {
  const file = readFileConfig();
  const next = {
    ...file,
    ...extras,
    apiBaseUrl:
      extras.apiBaseUrl ||
      file.apiBaseUrl ||
      process.env.TINKER_API_BASE_URL ||
      DEFAULT_API_BASE,
    token: String(token || "").trim(),
  };
  writeFileConfig(next);
  return next;
}

function clearConfig() {
  try {
    fs.unlinkSync(configPath());
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

/** Redact secrets for any diagnostic string. */
function redact(value) {
  const s = String(value == null ? "" : value);
  if (!s) return s;
  if (s.length <= 8) return "••••";
  return s.slice(0, 2) + "…••••…" + s.slice(-2);
}

module.exports = {
  DEFAULT_API_BASE,
  configPath,
  loadConfig,
  saveToken,
  clearConfig,
  readFileConfig,
  redact,
};
