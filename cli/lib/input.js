"use strict";

const readline = require("readline");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getTheme, rlHide } = require("./theme.js");

/**
 * Compact inline input for a short terminal panel.
 * - Enter submits a one-line answer
 * - A line that is only "." ends a multi-line answer
 * - Continuation lines after the first are allowed until "." or empty+done
 */

function createInterface({ input = process.stdin, output = process.stdout } = {}) {
  return readline.createInterface({
    input,
    output,
    terminal: input.isTTY ? true : false,
  });
}

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

function isFinishPhrase(line) {
  const s = String(line || "")
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, "");
  return s === "this is everything" || s === "this is every thing";
}

function isQuitPhrase(line) {
  const s = String(line || "").trim().toLowerCase();
  return s === ".quit" || s === ".exit" || s === "quit";
}

function resetOutput(rl, theme) {
  if (theme && theme.enabled && theme.reset && rl && rl.output) {
    rl.output.write(theme.reset);
  }
}

/**
 * Read an answer. Multi-line: keep reading until a lone "." line.
 * First line alone + Enter is enough for short answers.
 * Prompt is muted; typed text uses the web body color when color is on.
 */
async function readAnswer(rl, { prompt = "> ", theme = getTheme() } = {}) {
  const styledPrompt = theme.prompt(prompt);
  // Continuation: no "> ", but keep body color for typed lines.
  const cont = theme.enabled
    ? rlHide(theme.reset + theme.bodyOpen())
    : "";

  const first = await question(rl, styledPrompt);
  resetOutput(rl, theme);
  if (isFinishPhrase(first) || isQuitPhrase(first)) {
    return { kind: isFinishPhrase(first) ? "finish" : "quit", text: "" };
  }
  const trimmed = String(first || "");
  // Optional $EDITOR for a longer inline answer (VISUAL or EDITOR).
  if (trimmed.trim() === ".edit" || trimmed.trim() === ".editor") {
    const edited = editInEditor("");
    if (edited == null) {
      return { kind: "answer", text: "" };
    }
    if (isFinishPhrase(edited)) {
      return { kind: "finish", text: "" };
    }
    return { kind: "answer", text: edited };
  }
  // Lone "." on first line → empty answer nudge handled by caller.
  if (trimmed.trim() === ".") {
    return { kind: "answer", text: "" };
  }
  // Trailing "\\" continues; or if the user already pasted and ends with "."
  if (!trimmed.endsWith("\\") && trimmed.trim() !== "") {
    return { kind: "answer", text: trimmed.replace(/\s+$/g, "") };
  }

  const lines = [];
  if (trimmed.endsWith("\\")) {
    lines.push(trimmed.slice(0, -1));
  } else if (trimmed.trim()) {
    lines.push(trimmed);
  }

  for (;;) {
    const line = await question(rl, cont);
    resetOutput(rl, theme);
    if (isFinishPhrase(line)) {
      return {
        kind: "finish",
        text: lines.join("\n").replace(/\s+$/g, ""),
      };
    }
    if (isQuitPhrase(line)) {
      return { kind: "quit", text: lines.join("\n").replace(/\s+$/g, "") };
    }
    if (String(line).trim() === ".") {
      break;
    }
    if (String(line).endsWith("\\")) {
      lines.push(String(line).slice(0, -1));
      continue;
    }
    lines.push(String(line));
  }
  return { kind: "answer", text: lines.join("\n").replace(/\s+$/g, "") };
}

/**
 * Optional $EDITOR for a longer answer. Returns null if editor fails.
 */
function editInEditor(initial) {
  const editor = process.env.VISUAL || process.env.EDITOR || "";
  if (!editor) return null;
  const tmp = path.join(
    os.tmpdir(),
    `tinker-answer-${process.pid}-${Date.now()}.md`
  );
  fs.writeFileSync(tmp, initial || "", "utf8");
  try {
    // macOS zsh / Linux: VISUAL/EDITOR may be "code -w" or "vim".
    const result = spawnSync(editor, [tmp], {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    if (result.status !== 0) return null;
    return fs.readFileSync(tmp, "utf8").replace(/\s+$/g, "");
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  createInterface,
  question,
  readAnswer,
  isFinishPhrase,
  isQuitPhrase,
  editInEditor,
};
