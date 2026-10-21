"use strict";

const { printHelp } = require("./help.js");
const { loadConfig, clearConfig } = require("./config.js");
const api = require("./api.js");
const { createInterface, readAnswer } = require("./input.js");
const { runCoach, createApiAskModel } = require("./coach.js");
const { runLogin } = require("./login.js");
const { getTheme } = require("./theme.js");

function parseArgs(argv) {
  const args = {
    help: false,
    command: null,
    notion: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help" || a === "help") {
      args.help = true;
    } else if (a === "--notion") {
      args.notion = true;
    } else if (a === "login" || a === "logout") {
      args.command = a;
    } else if (a === "exercise" || a === "exercises") {
      throw Object.assign(
        new Error("Exercises are not part of the tinker CLI. Use the writing coach: tinker"),
        { exitCode: 1 }
      );
    } else if (a.startsWith("-")) {
      throw Object.assign(new Error(`Unknown flag: ${a}\nTry: tinker --help`), {
        exitCode: 1,
      });
    } else {
      throw Object.assign(
        new Error(`Unknown command: ${a}\nTry: tinker --help`),
        { exitCode: 1 }
      );
    }
  }
  return args;
}

function stdoutWrite(line) {
  process.stdout.write(String(line == null ? "" : line) + "\n");
}

async function runWritingSession() {
  const config = loadConfig();
  const theme = getTheme();
  if (!config.token) {
    throw Object.assign(
      new Error("Not signed in. Run: tinker login"),
      { exitCode: 1 }
    );
  }

  const rl = createInterface();
  const askModel = createApiAskModel(api.converse, config);

  try {
    const result = await runCoach({
      askModel,
      readAnswer: () => readAnswer(rl, { prompt: "> ", theme }),
      write: stdoutWrite,
      saveEssay: async (essay) => api.saveNotionEssay(config, essay),
      theme,
    });
    return result;
  } finally {
    rl.close();
  }
}

async function main(argv) {
  const theme = getTheme();
  const args = parseArgs(argv || []);
  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.command === "logout") {
    clearConfig();
    stdoutWrite(theme.muted("Cleared ~/.tinker credentials."));
    return 0;
  }

  if (args.command === "login") {
    const rl = createInterface();
    try {
      await runLogin(rl, {
        notion: args.notion,
        write: stdoutWrite,
        theme,
      });
    } finally {
      rl.close();
    }
    return 0;
  }

  // Default: writing coach
  if (args.notion) {
    throw Object.assign(
      new Error("--notion is for login. Try: tinker login --notion"),
      { exitCode: 1 }
    );
  }
  await runWritingSession();
  return 0;
}

module.exports = { main, parseArgs, runWritingSession };
