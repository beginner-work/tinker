"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.join(__dirname, "..");
const cliRoot = path.join(root, "cli");

const { runCoach, askNextQuestion, createApiAskModel } = require("../cli/lib/coach.js");
const { finalizeEssay, verifyFounderOnly } = require("../cli/lib/stitch.js");
const { parseArgs } = require("../cli/lib/main.js");
const { isFinishPhrase, isQuitPhrase } = require("../cli/lib/input.js");
const { HELP } = require("../cli/lib/help.js");
const interview = require("../cli/lib/interview.js");
const config = require("../cli/lib/config.js");
const { createTheme, colorLevel, TOKENS } = require("../cli/lib/theme.js");

const plainTheme = createTheme({ level: 0 });

test("cli package exposes a tinker bin and is self-contained", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"));
  assert.equal(pkg.name, "tinker");
  assert.equal(pkg.bin.tinker, "bin/tinker.js");
  const bin = fs.readFileSync(path.join(cliRoot, "bin/tinker.js"), "utf8");
  assert.match(bin, /^#!/);
  assert.ok(fs.existsSync(path.join(cliRoot, "vendor/interview-prompt.js")));
  assert.ok(fs.existsSync(path.join(cliRoot, "vendor/lib/claude-models.js")));
});

test("vendored interview-prompt matches src/renderer (no drift)", () => {
  const src = fs.readFileSync(
    path.join(root, "src/renderer/interview-prompt.js"),
    "utf8"
  );
  const vendored = fs.readFileSync(
    path.join(cliRoot, "vendor/interview-prompt.js"),
    "utf8"
  );
  assert.equal(vendored, src);
  const modelsSrc = fs.readFileSync(
    path.join(root, "src/renderer/lib/claude-models.js"),
    "utf8"
  );
  const modelsVendor = fs.readFileSync(
    path.join(cliRoot, "vendor/lib/claude-models.js"),
    "utf8"
  );
  assert.equal(modelsVendor, modelsSrc);
});

test("CLI reuses interview-prompt buildFollowupRequest and parseInterviewResponse", () => {
  const built = interview.buildFollowupRequest({ transcript: [] });
  assert.equal(built.mode, "interview");
  assert.match(built.system, /You ask one question at a time/);
  assert.match(built.user, /Begin the interview/);
  const parsed = interview.parseInterviewResponse(
    JSON.stringify({
      next_question: "What are you learning about this?",
      stitched_title: null,
      stitched_body: null,
      done: false,
    })
  );
  assert.equal(parsed.next_question, "What are you learning about this?");
  assert.equal(parsed.done, false);
});

test("help text covers install surface and has no exercise command", () => {
  assert.match(HELP, /tinker login/);
  assert.match(HELP, /this is everything/);
  assert.match(HELP, /~\/\.tinker/);
  assert.equal(/exercise/i.test(HELP), false);
  assert.equal(/formation/i.test(HELP), false);
});

test("parseArgs rejects exercise and supports help/login", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["login"]).command, "login");
  assert.equal(parseArgs(["login", "--notion"]).notion, true);
  assert.throws(() => parseArgs(["exercise"]), /not part of the tinker CLI/);
});

test("finish phrase detection", () => {
  assert.equal(isFinishPhrase("This is everything"), true);
  assert.equal(isFinishPhrase("this is everything."), true);
  assert.equal(isFinishPhrase("keep going"), false);
  assert.equal(isQuitPhrase(".quit"), true);
});

test("finalizeEssay falls back to founder words when model invents", () => {
  const transcript = [
    { q: "What are you learning?", a: "The pace only works when I cut scope." },
  ];
  const essay = finalizeEssay(
    {
      stitched_title: "Invented Title About Synergy",
      stitched_body: "Synergy unlocks paradigm shifts in the marketplace.",
      done: true,
    },
    transcript
  );
  assert.equal(essay.body, "The pace only works when I cut scope.");
  assert.ok(verifyFounderOnly(essay.body, transcript).ok);
});

test("coach loop asks one question at a time and saves on finish (LLM mocked)", async () => {
  const questions = [
    "What are you learning about how this work moves?",
    "What are you noticing that you did not expect?",
  ];
  let askCalls = 0;
  const lines = [];
  const answers = [
    { kind: "answer", text: "It moves when I ship the smallest cut." },
    { kind: "answer", text: "I did not expect silence to be useful." },
    { kind: "finish", text: "" },
  ];
  let answerIdx = 0;
  let saved = null;

  const result = await runCoach({
    askModel: async ({ transcript, forceStitch }) => {
      askCalls += 1;
      if (forceStitch) {
        return {
          next_question: null,
          stitched_title: "It moves when I ship the smallest cut",
          stitched_body:
            "It moves when I ship the smallest cut.\n\nI did not expect silence to be useful.",
          done: true,
        };
      }
      const q = questions[Math.min(transcript.length, questions.length - 1)];
      return {
        next_question: q,
        stitched_title: null,
        stitched_body: null,
        done: false,
      };
    },
    readAnswer: async () => answers[answerIdx++],
    write: (line) => lines.push(String(line)),
    saveEssay: async (essay) => {
      saved = essay;
      return { ok: true };
    },
    theme: plainTheme,
  });

  assert.equal(result.status, "saved");
  assert.equal(lines[0], questions[0]);
  assert.equal(lines[1], questions[1]);
  assert.ok(lines.includes("Saved to Notion."));
  assert.equal(lines.some((l) => /^\d+\./.test(l)), false);
  assert.ok(saved);
  assert.match(saved.body, /smallest cut/);
  assert.ok(askCalls >= 3);
});

test("coach loop surfaces Notion parent-page errors explicitly", async () => {
  const lines = [];
  const queue = [
    { kind: "answer", text: "Cut scope first." },
    { kind: "finish", text: "" },
  ];
  const result = await runCoach({
    askModel: async ({ forceStitch, transcript }) => {
      if (forceStitch) {
        return {
          next_question: null,
          stitched_title: "Cut",
          stitched_body: "Cut scope first.",
          done: true,
        };
      }
      return {
        next_question: transcript.length
          ? "What else are you figuring out?"
          : "What are you learning?",
        stitched_title: null,
        stitched_body: null,
        done: false,
      };
    },
    readAnswer: async () => queue.shift(),
    write: (line) => lines.push(String(line)),
    saveEssay: async () => ({
      ok: false,
      code: "notion_parent_required",
      message:
        "Notion needs a parent page. Run: tinker login --notion  (then paste a page URL in Connections, or share the page with Tinker during authorize).",
    }),
    theme: plainTheme,
  });
  assert.equal(result.status, "error");
  assert.ok(lines.some((l) => /Notion needs a parent page/.test(l)));
  assert.equal(lines.includes("Saved to Notion."), false);
});

test("createApiAskModel builds converse payload from interview-prompt", async () => {
  let captured = null;
  const ask = createApiAskModel(async (_config, payload) => {
    captured = payload;
    return {
      text: JSON.stringify({
        next_question: "What are you learning about pace?",
        done: false,
      }),
    };
  }, { apiBaseUrl: "https://example.test", token: "secret" });

  const parsed = await ask({ transcript: [], forceStitch: false, keepCrafting: false });
  assert.equal(parsed.next_question, "What are you learning about pace?");
  assert.ok(captured);
  assert.match(captured.system, /INTERVIEW, DO NOT WRITE/);
  assert.equal(captured.messages[0].role, "user");
  assert.equal(captured.model, interview.KEEP_CRAFTING_MODEL);
});

test("config never echoes token in redact helper; load prefers env", () => {
  assert.equal(config.redact("abcdefghijklmnop"), "ab…••••…op");
  const prevUrl = process.env.TINKER_API_BASE_URL;
  const prevToken = process.env.TINKER_TOKEN;
  const tmp = path.join(os.tmpdir(), `tinker-config-test-${process.pid}.json`);
  process.env.TINKER_CONFIG = tmp;
  process.env.TINKER_API_BASE_URL = "https://example.test";
  process.env.TINKER_TOKEN = "env-secret-token";
  try {
    // Reload module path — loadConfig reads env each call.
    const loaded = config.loadConfig();
    assert.equal(loaded.apiBaseUrl, "https://example.test");
    assert.equal(loaded.token, "env-secret-token");
  } finally {
    if (prevUrl === undefined) delete process.env.TINKER_API_BASE_URL;
    else process.env.TINKER_API_BASE_URL = prevUrl;
    if (prevToken === undefined) delete process.env.TINKER_TOKEN;
    else process.env.TINKER_TOKEN = prevToken;
    delete process.env.TINKER_CONFIG;
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
});

test("askNextQuestion falls back when model returns empty", async () => {
  const q = await askNextQuestion(async () => ({
    next_question: null,
    done: true,
    stitched_title: null,
    stitched_body: null,
  }), []);
  assert.ok(typeof q === "string" && q.length > 0);
  assert.match(q.toLowerCase(), /learn|notic|figur|discover|understand|recogn|pick|work|coming|find/);
});

test("sample session transcript exists for the PR", () => {
  const sample = fs.readFileSync(
    path.join(cliRoot, "examples/sample-session.txt"),
    "utf8"
  );
  assert.match(sample, /What are you learning/);
  assert.match(sample, /this is everything/i);
  assert.match(sample, /Saved to Notion/);
  assert.equal(/^ {0,3}\d+\./m.test(sample), false);
});

test("root package.json wires tinker bin to the CLI", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.bin.tinker, "cli/bin/tinker.js");
});

test("theme tokens match web writing UI CSS variables", () => {
  assert.equal(TOKENS.ink.hex, "#1a1a1a");
  assert.equal(TOKENS.foreground.hex, "#2d2a26");
  assert.equal(TOKENS.muted.hex, "#6f6a65");
  assert.equal(TOKENS.accent.hex, "#6366f1");
  assert.equal(TOKENS.danger.hex, "#b42318");
});

test("colorLevel respects NO_COLOR, FORCE_COLOR, and non-TTY", () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  assert.equal(colorLevel(pipe, {}), 0);
  assert.equal(colorLevel(tty, { NO_COLOR: "1" }), 0);
  assert.equal(colorLevel(tty, { NO_COLOR: "1", FORCE_COLOR: "3" }), 3);
  assert.equal(colorLevel(tty, { FORCE_COLOR: "0" }), 0);
  assert.equal(colorLevel(tty, { FORCE_COLOR: "3" }), 3);
  assert.equal(colorLevel(tty, { COLORTERM: "truecolor", TERM: "xterm" }), 3);
  assert.equal(colorLevel(tty, { TERM: "xterm-256color" }), 2);
  assert.equal(colorLevel(tty, { TERM: "dumb" }), 0);
});

test("theme paints question/body/success/error with truecolor and falls back", () => {
  const truecolor = createTheme({ level: 3 });
  const q = truecolor.question("What are you learning?");
  // Bold questions use accent purple, not ink.
  assert.match(q, /\x1b\[38;2;99;102;241m/);
  assert.match(q, /\x1b\[1m/);
  assert.match(q, /What are you learning\?/);
  assert.match(q, /\x1b\[0m/);
  assert.equal(/\x1b\[38;2;26;26;26m/.test(q), false);

  const body = truecolor.body("typed answer");
  assert.match(body, /\x1b\[38;2;45;42;38m/);
  assert.equal(/\x1b\[1m/.test(body), false);

  const ok = truecolor.success("Saved to Notion.");
  assert.match(ok, /\x1b\[38;2;99;102;241m/);
  assert.match(ok, /\x1b\[1m/);
  assert.match(ok, /Saved to Notion\./);

  // Any bold paint uses accent, even if another token was requested.
  const boldInk = truecolor.paint(TOKENS.ink, "Bold label", { bold: true });
  assert.match(boldInk, /\x1b\[38;2;99;102;241m/);
  assert.match(boldInk, /\x1b\[1m/);

  const err = truecolor.error("Notion needs a parent page.");
  assert.match(err, /\x1b\[38;2;180;35;24m/);

  const c256 = createTheme({ level: 2 });
  assert.match(c256.question("Q"), /\x1b\[38;5;99m/);
  assert.match(c256.accent("ok"), /\x1b\[38;5;99m/);

  const basic = createTheme({ level: 1 });
  assert.match(basic.question("Q"), /\x1b\[35m/);
  assert.match(basic.error("no"), /\x1b\[31m/);

  const plain = createTheme({ level: 0 });
  assert.equal(plain.question("Q"), "Q");
  assert.equal(plain.success("Saved to Notion."), "Saved to Notion.");
  assert.equal(plain.prompt("> "), "> ");
});

test("readline prompt wraps ANSI so cursor width stays correct", () => {
  const theme = createTheme({ level: 3 });
  const p = theme.prompt("> ");
  assert.match(p, /^\x01/);
  assert.match(p, /\x02> /);
  // Ends with body-color open (no reset after typed region starts).
  assert.match(p, /\x01\x1b\[0m\x1b\[38;2;45;42;38m\x02$/);
});

test("coach loop styles question and Saved to Notion with accent when color on", async () => {
  const theme = createTheme({ level: 3 });
  const lines = [];
  const queue = [
    { kind: "answer", text: "Ship the smallest cut." },
    { kind: "finish", text: "" },
  ];
  await runCoach({
    askModel: async ({ forceStitch }) => {
      if (forceStitch) {
        return {
          next_question: null,
          stitched_title: "Cut",
          stitched_body: "Ship the smallest cut.",
          done: true,
        };
      }
      return {
        next_question: "What are you learning?",
        stitched_title: null,
        stitched_body: null,
        done: false,
      };
    },
    readAnswer: async () => queue.shift(),
    write: (line) => lines.push(String(line)),
    saveEssay: async () => ({ ok: true }),
    theme,
  });
  assert.match(lines[0], /\x1b\[38;2;99;102;241m/);
  assert.match(lines[0], /\x1b\[1m/);
  assert.match(lines[0], /What are you learning\?/);
  const saved = lines.find((l) => /Saved to Notion/.test(l));
  assert.ok(saved);
  assert.match(saved, /\x1b\[38;2;99;102;241m/);
  assert.match(saved, /\x1b\[1m/);
});

test("coach loop styles Notion errors in danger red when color on", async () => {
  const theme = createTheme({ level: 3 });
  const lines = [];
  const queue = [
    { kind: "answer", text: "Cut scope." },
    { kind: "finish", text: "" },
  ];
  await runCoach({
    askModel: async ({ forceStitch }) => {
      if (forceStitch) {
        return {
          next_question: null,
          stitched_title: "Cut",
          stitched_body: "Cut scope.",
          done: true,
        };
      }
      return {
        next_question: "What are you learning?",
        done: false,
      };
    },
    readAnswer: async () => queue.shift(),
    write: (line) => lines.push(String(line)),
    saveEssay: async () => ({
      ok: false,
      message: "Notion needs a parent page.",
    }),
    theme,
  });
  const errLine = lines.find((l) => /Notion needs a parent page/.test(l));
  assert.ok(errLine);
  assert.match(errLine, /\x1b\[38;2;180;35;24m/);
});
