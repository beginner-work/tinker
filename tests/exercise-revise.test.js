/* Essay → Claude exercise revise: parse, apply files, API wiring, UI chip. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const revise = require("../api/_lib/exercise-revise.js");
const revision = require("../src/renderer/lib/exercise-revision.js");
const core = require("../src/renderer/lib/exercise-workspace-core.js");

const html = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
const page = fs.readFileSync(path.join(root, "src/renderer/repo/repo.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "src/renderer/repo/exercise-workspace-ui.js"), "utf8");
const apiSrc = fs.readFileSync(path.join(root, "api/exercise-workspace.js"), "utf8");
const storeSrc = fs.readFileSync(path.join(root, "api/_lib/exercise-workspace-store.js"), "utf8");

function demoWorkspace() {
  const ws = core.emptyWorkspace();
  ws.exerciseOrder = ["api-design"];
  ws.exercises["api-design"] = {
    id: "api-design",
    name: "API Design",
    nodes: [
      {
        id: "readme_1",
        name: "README.md",
        type: "file",
        parentId: null,
        content: "# API Design\n\n## Start here\n\n1. Old step\n",
      },
      {
        id: "starter_1",
        name: "practice.ts",
        type: "file",
        parentId: null,
        content: "// starter\nexport {}\n",
      },
      {
        id: "fix_1",
        name: "practice.test.ts",
        type: "file",
        parentId: null,
        content: "test('keeps going', () => {});\n",
      },
    ],
  };
  return ws;
}

test("essay terminal shows an attachable exercise chip", () => {
  assert.match(html, /id="repo-exercise-chip"/);
  assert.match(html, /id="repo-exercise-chip-spinner"/);
  assert.match(html, /id="repo-exercise-chip-retry"/);
  assert.match(html, /id="repo-exercise-chip-label"/);
  assert.match(css, /\.repo-exercise-chip\b/);
  assert.match(css, /\.repo-exercise-chip__spinner|\.repo-ex-transform-spinner/);
  assert.match(page, /renderExerciseChip/);
  assert.match(page, /startExerciseEssay/);
  assert.match(page, /clearExerciseAttachment/);
  assert.match(ui, /Write about this exercise/);
});

test("transform pending shows spinner; error exposes retry on tree and chip", () => {
  assert.match(ui, /repo-ex-transform-spinner/);
  assert.match(ui, /repo-ex-transform-retry/);
  assert.match(ui, /setTransform/);
  assert.match(ui, /status:\s*["']pending["']/);
  assert.match(ui, /status:\s*["']error["']/);
  assert.match(ui, /retryTransform|revise_from_essay/);
  assert.match(page, /retryExerciseTransform/);
  assert.match(page, /exerciseTransformStatus/);
  assert.match(css, /\.repo-ex-transform-retry/);
});

test("persistence stays on TinkerUserData; no GitHub commit path", () => {
  assert.match(storeSrc, /reviseFromEssay/);
  assert.match(storeSrc, /TinkerUserData|tinkerUserData|no GitHub commit/i);
  assert.match(apiSrc, /revise_from_essay/);
  assert.doesNotMatch(storeSrc, /git push|octokit|createOrUpdateFileContents/i);
  assert.doesNotMatch(apiSrc, /git push|octokit|createOrUpdateFileContents/i);
  assert.match(revise.SYSTEM_PROMPT, /starter/i);
});

test("parseModelJson accepts bare and fenced JSON", () => {
  const bare = revise.parseModelJson('{"steps":["a"],"files":[]}');
  assert.deepEqual(bare.steps, ["a"]);
  const fenced = revise.parseModelJson('```json\n{"steps":["b"],"files":[{"path":"README.md","content":"# hi"}]}\n```');
  assert.equal(fenced.steps[0], "b");
  assert.equal(fenced.files[0].path, "README.md");
  assert.throws(() => revise.parseModelJson("not json"), (err) => err && err.status === 502);
});

test("listExerciseFiles prefers README and skips test files", () => {
  const ws = demoWorkspace();
  const files = revision.listExerciseFiles(ws.exercises["api-design"].nodes);
  assert.equal(files[0].path, "README.md");
  assert.ok(files.some((f) => f.path === "practice.ts"));
  assert.ok(!files.some((f) => f.path === "practice.test.ts"));
});

test("applyClaudeRevision updates README steps and starter code", () => {
  const ws = demoWorkspace();
  const result = revision.applyClaudeRevision(ws, {
    core: core,
    exerciseId: "api-design",
    steps: ["Name the route", "Validate the body"],
    files: [
      {
        path: "README.md",
        content: "# API Design\n\n## Start here\n\n1. Name the route\n",
      },
      {
        path: "practice.ts",
        content: "// write the handler\nexport function handle() { throw new Error(\"TODO\"); }\n",
      },
    ],
  });
  assert.equal(result.changed, true);
  assert.ok(result.steps.includes("Name the route"));
  const readme = core.nodeById(result.workspace.exercises["api-design"].nodes, "readme_1");
  assert.match(readme.content, /Name the route/);
  assert.match(readme.content, /Validate the body|Updated from your essay/);
  const nodes = result.workspace.exercises["api-design"].nodes;
  const starter = nodes.find((n) => n.name === "practice.ts");
  assert.ok(starter, "starter practice.ts should remain");
  assert.match(starter.content, /TODO/);
  const testFile = nodes.find((n) => n.name === "practice.test.ts");
  assert.ok(testFile, "test file should remain untouched");
  assert.match(testFile.content, /keeps going/);
});

test("reviseExerciseWithClaude calls Anthropic and applies the patch", async () => {
  const ws = demoWorkspace();
  const calls = [];
  const result = await revise.reviseExerciseWithClaude({
    workspace: ws,
    exerciseId: "api-design",
    essayBody: "1. Split auth into its own step\n2. Keep the starter stub blank",
    core: core,
    callAnthropic: async (args) => {
      calls.push(args);
      return {
        text: JSON.stringify({
          steps: ["Split auth into its own step", "Keep the starter stub blank"],
          files: [
            {
              path: "README.md",
              content: "# API Design\n\n## Start here\n\n1. Split auth into its own step\n2. Keep the starter stub blank\n",
            },
            {
              path: "practice.ts",
              content: "// starter stub\nexport function handle() { throw new Error(\"TODO\"); }\n",
            },
          ],
        }),
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /coding exercise/i);
  assert.match(calls[0].messages[0].content, /Essay/);
  assert.equal(result.changed, true);
  assert.ok(result.steps.includes("Split auth into its own step"));
  const starter = core.nodeById(result.workspace.exercises["api-design"].nodes, "starter_1");
  assert.match(starter.content, /TODO/);
});

test("This is everything wires Claude revise with chip spinner state", () => {
  assert.match(page, /finishWritingAfterSave/);
  assert.match(page, /applyExerciseRevisionFromEssay/);
  assert.match(page, /exerciseTransformStatus\s*=\s*["']pending["']/);
  assert.match(ui, /revise_from_essay/);
  assert.match(ui, /Updating from essay|Updating exercise/);
});
