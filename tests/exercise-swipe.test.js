/* Mobile swipe drill: better/worse alternatives of a baseline snippet. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const models = require("../src/renderer/lib/claude-models.js");
const swipe = require("../src/renderer/lib/exercise-swipe.js");
const core = require("../src/renderer/lib/exercise-workspace-core.js");
const revision = require("../src/renderer/lib/exercise-revision.js");
const evaluate = require("../src/renderer/lib/exercise-evaluate.js");
const progress = require("../src/renderer/lib/learning-progress.js");
const essayRead = require("../src/renderer/lib/essay-read.js");

const uiSrc = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);
const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(root, "src/renderer/repo/repo.css"),
  "utf8"
);
const swipeSrc = fs.readFileSync(
  path.join(root, "src/renderer/lib/exercise-swipe.js"),
  "utf8"
);
const structuredSrc = fs.readFileSync(
  path.join(root, "src/renderer/lib/claude-structured.js"),
  "utf8"
);

test("swipe helper pins the exercise Opus model and bans Formation", () => {
  assert.equal(swipe.MODEL, models.EXERCISE_REFACTOR);
  assert.equal(swipe.MODEL, "claude-opus-5-5");
  assert.match(swipeSrc, /EXERCISE_REFACTOR/);
  assert.match(swipe.SYSTEM_PROMPT, /learning goal/i);
  assert.match(swipe.SYSTEM_PROMPT, /Never mention Formation/);
  assert.doesNotMatch(swipeSrc, /openai|codex|gpt-/i);
  assert.match(html, /exercise-swipe\.js/);
  assert.match(html, /id="repo-swipe"/);
  assert.match(uiSrc, /tinkerExerciseSwipe|swipeApi/);
  assert.match(uiSrc, /loadSwipeCard|finishSwipe|isMobileSwipeMode/);
  assert.match(structuredSrc, /SWIPE_SCHEMA/);
});

test("pickSnippet returns a short window and applySnippetReplacement updates baseline", () => {
  const baseline = [
    "paths:",
    "  /intents:",
    "    get:",
    "      summary: Fetch one",
    "      responses:",
    "        '200':",
    "          description: ok",
    "    post:",
    "      summary: Create",
  ].join("\n");
  const snip = swipe.pickSnippet(baseline, { seed: 2, lineCount: 5 });
  assert.ok(snip.lineCount >= swipe.MIN_LINES);
  assert.ok(snip.lineCount <= swipe.MAX_LINES);
  assert.ok(snip.before.includes("get:") || snip.before.includes("paths:"));
  const next = swipe.applySnippetReplacement(
    baseline,
    snip.startOffset,
    snip.endOffset,
    "replaced\nblock"
  );
  assert.match(next, /replaced\nblock/);
  assert.ok(next.length < baseline.length + 20);
});

test("compactDiff marks removed and added lines with IDE-like kinds", () => {
  const diff = swipe.compactDiff("a\nb\nc", "a\nB\nc");
  const kinds = diff.map((d) => d.type);
  assert.ok(kinds.includes("del"));
  assert.ok(kinds.includes("add"));
  assert.ok(kinds.includes("ctx"));
});

test("parseSwipeReply reads better/worse and rejects Formation", () => {
  const parsed = swipe.parseSwipeReply(
    JSON.stringify({
      alternative: "summary: Fetch by id\n",
      kind: "better",
      why: "Names the id in the summary.",
    })
  );
  assert.equal(parsed.kind, "better");
  assert.match(parsed.alternative, /Fetch by id/);
  assert.match(parsed.why, /Better:/);
  assert.throws(
    () =>
      swipe.parseSwipeReply(
        JSON.stringify({
          alternative: "x",
          kind: "worse",
          why: "Go back to Formation.",
        })
      ),
    /Formation/
  );
});

test("shouldUpdateBaseline only when better is accepted", () => {
  assert.equal(swipe.shouldUpdateBaseline("better", "right"), true);
  assert.equal(swipe.shouldUpdateBaseline("better", "better"), true);
  assert.equal(swipe.shouldUpdateBaseline("better", "left"), false);
  assert.equal(swipe.shouldUpdateBaseline("worse", "right"), false);
  assert.equal(swipe.shouldUpdateBaseline("worse", "left"), false);
});

test("buildSwipeUserMessage scopes to the learning goal", () => {
  const msg = swipe.buildSwipeUserMessage({
    fileName: "api.yaml",
    learningGoal: "Write OpenAPI by feel",
    snippet: "paths:\n  /x:\n    get: {}\n",
    recentKinds: ["better", "worse"],
  });
  assert.match(msg, /Write OpenAPI by feel/);
  assert.match(msg, /<<<SNIPPET/);
  assert.match(msg, /Recent kinds: better, worse/);
});

function workspace() {
  const ws = core.emptyWorkspace();
  ws.exerciseOrder = ["from-essays"];
  ws.exercises["from-essays"] = {
    id: "from-essays",
    name: "From essays",
    nodes: [
      {
        id: "practice",
        name: "api.yaml",
        type: "file",
        parentId: null,
        content: "paths:\n  /intents:\n    get:\n      summary: Fetch\n",
      },
    ],
  };
  return ws;
}

function setup(t, options = {}) {
  const dom = new JSDOM(html, {
    url: "https://test.invalid/repo",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  let width = options.width || 390;
  let signedIn = options.signedIn !== false;
  let resize;
  const claudeCalls = [];
  w.localStorage.setItem("tinker_jwt", "mock-owner");
  w.matchMedia = () => ({
    matches: width >= 801,
    addEventListener: (_, fn) => {
      resize = fn;
    },
  });
  w.tinkerExerciseWorkspaceCore = core;
  w.tinkerExerciseRevision = revision;
  w.tinkerExerciseEvaluate = evaluate;
  w.tinkerExerciseSwipe = swipe;
  w.tinkerLearningProgress = progress;
  w.tinkerEssayRead = essayRead;
  w.tinkerExercisesManifest = { modules: [{ id: "from-essays" }] };
  w.tinkerClaudeModels = models;
  w.tinkerLearningAuth = {
    isLearningSignedIn: () => signedIn,
    onLearningAuthChange() {},
    requestLearningSignIn() {},
  };
  w.tinkerCodeMirror = {
    create: () => ({
      getValue: () => "",
      destroy() {},
      focus() {},
      setFileName() {},
      setValue() {},
    }),
  };
  w.tinker = {
    callClaude: async (opts) => {
      claudeCalls.push(opts);
      if (options.claudeReply) {
        return { text: JSON.stringify(options.claudeReply) };
      }
      return {
        text: JSON.stringify({
          alternative: "paths:\n  /intents:\n    get:\n      summary: Fetch one by id\n",
          kind: "better",
          why: "Names the id.",
        }),
      };
    },
  };
  w.fetch = async (url) => {
    if (String(url).indexOf("learning-progress") !== -1) {
      return {
        ok: true,
        json: async () => ({
          data: {
            status: "active",
            goalTitle: "Write OpenAPI by feel",
            currentPrompt: "Name ask and return.",
            practicePath: "api.yaml",
            fileName: "api.yaml",
            exerciseId: "from-essays",
            level: 20,
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ workspace: workspace() }) };
  };
  w.eval(uiSrc);
  return {
    w,
    ui: w.tinkerExerciseWorkspaceUi,
    claudeCalls,
    el: (id) => w.document.getElementById(id),
    resize: (n) => {
      width = n;
      if (resize) resize();
    },
  };
}

test("mobile learning shows swipe chrome; desktop stays on editor", async (t) => {
  const mobile = setup(t, { width: 390 });
  await mobile.ui.init();
  mobile.ui._setWorkspace(workspace());
  mobile.ui._state.learningProgress = progress.normalizeProgress({
    status: "active",
    goalTitle: "Write OpenAPI by feel",
    currentPrompt: "Name ask and return.",
    practicePath: "api.yaml",
    fileName: "api.yaml",
    exerciseId: "from-essays",
    level: 20,
  });
  mobile.ui.openPracticeFromProgress();
  assert.equal(mobile.ui.isMobileSwipeMode(), true);
  assert.equal(mobile.el("repo-swipe").hasAttribute("hidden"), false);
  assert.ok(mobile.el("repo-layout").classList.contains("is-swipe-mode"));
  assert.match(css, /\.repo-swipe__line--del/);
  assert.match(css, /\.repo-swipe__line--add/);
  assert.match(css, /min-width:\s*801px\)[\s\S]*\.repo-swipe[\s\S]*display:\s*none/);

  const desktop = setup(t, { width: 1200 });
  await desktop.ui.init();
  desktop.ui._setWorkspace(workspace());
  desktop.ui._state.learningProgress = progress.normalizeProgress({
    status: "active",
    goalTitle: "Write OpenAPI by feel",
    currentPrompt: "Name ask and return.",
    practicePath: "api.yaml",
    fileName: "api.yaml",
    exerciseId: "from-essays",
    level: 20,
  });
  desktop.ui.openPracticeFromProgress();
  assert.equal(desktop.ui.isMobileSwipeMode(), false);
  assert.equal(desktop.el("repo-swipe").hasAttribute("hidden"), true);
});

test("accepting a better swipe updates the baseline for the next card", async (t) => {
  const e = setup(t, { width: 390 });
  await e.ui.init();
  e.ui._setWorkspace(workspace());
  e.ui._state.learningProgress = progress.normalizeProgress({
    status: "active",
    goalTitle: "Write OpenAPI by feel",
    currentPrompt: "Name ask and return.",
    practicePath: "api.yaml",
    fileName: "api.yaml",
    exerciseId: "from-essays",
    level: 20,
  });
  e.ui.openPracticeFromProgress();
  const before = "paths:\n  /intents:\n    get:\n      summary: Fetch\n";
  const after = "paths:\n  /intents:\n    get:\n      summary: Fetch one by id\n";
  e.ui._setSwipeCard({
    before: before,
    after: after,
    kind: "better",
    why: "Better: names the id.",
    startOffset: 0,
    endOffset: before.length,
    baseline: before,
  });
  e.ui.finishSwipe("right");
  await new Promise((r) => setTimeout(r, 30));
  assert.match(e.el("repo-swipe-why").textContent, /Better:/);
  const node = e.ui.getWorkspace().exercises["from-essays"].nodes.find(
    (n) => n.id === "practice"
  );
  assert.match(node.content, /Fetch one by id/);
});
