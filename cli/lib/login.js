"use strict";

const { spawn } = require("child_process");
const {
  requestPhoneOtp,
  verifyPhoneOtp,
  notionConnect,
  notionStatus,
} = require("./api.js");
const { saveToken, loadConfig } = require("./config.js");
const { question } = require("./input.js");

function openBrowser(url) {
  const target = String(url || "").trim();
  if (!target) return false;
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === "darwin") {
    cmd = "open";
    args = [target];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", target];
  } else {
    cmd = "xdg-open";
    args = [target];
  }
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function connectNotion(config, { write, rl }) {
  const status = await notionStatus(config);
  if (status && status.connected && status.parentPageId) {
    write("Notion already connected.");
    return;
  }
  const started = await notionConnect(config);
  const url = started && (started.authorizeUrl || started.url);
  if (!url) {
    write("Could not get a Notion authorize URL.");
    return;
  }
  write("Opening Notion authorize in your browser…");
  if (!openBrowser(url)) {
    write("Open this URL:");
    write(url);
  }
  write("After authorizing, set a parent page in Tinker → Connections.");
  if (status && status.connected && !status.parentPageId) {
    write("Notion needs a parent page before essays can save.");
  }
  // Keep rl referenced so callers can pass it; no extra prompt noise.
  void rl;
}

async function runLogin(rl, { notion = false, write = console.log } = {}) {
  const config = loadConfig();
  write(`API: ${config.apiBaseUrl}`);
  const phone = (await question(rl, "Phone (E.164 or 10-digit US): ")).trim();
  if (!phone) {
    throw Object.assign(new Error("Phone is required."), { exitCode: 1 });
  }
  const requested = await requestPhoneOtp(config, phone);
  const phoneId = requested && requested.phone_id;
  if (!phoneId) {
    throw Object.assign(new Error("No phone_id from login request."), {
      exitCode: 1,
    });
  }
  const pin = (await question(rl, "SMS code: ")).trim();
  if (!pin) {
    throw Object.assign(new Error("Code is required."), { exitCode: 1 });
  }
  const verified = await verifyPhoneOtp(
    { ...config, token: "" },
    { phone_id: phoneId, pin }
  );
  const token = verified && verified.token;
  if (!token) {
    throw Object.assign(new Error("No session token from verify."), {
      exitCode: 1,
    });
  }
  saveToken(token, { apiBaseUrl: config.apiBaseUrl });
  write(`Signed in. Saved credentials to ${config.configPath}`);
  // Never print the token.
  const next = { ...config, token };
  if (notion) {
    await connectNotion(next, { write, rl });
  } else {
    const status = await notionStatus(next).catch(() => null);
    if (!status || !status.connected) {
      write("Tip: tinker login --notion  to connect Notion for essay saves.");
    } else if (!status.parentPageId) {
      write("Notion needs a parent page (Connections in the app).");
    }
  }
}

module.exports = {
  runLogin,
  connectNotion,
  openBrowser,
};
