/* Learning loop chrome: prompt card + one practice file (no Exercises sidebar). */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const core = require("../src/renderer/lib/exercise-workspace-core.js");
const revision = require("../src/renderer/lib/exercise-revision.js");
const evaluate = require("../src/renderer/lib/exercise-evaluate.js");
const progress = require("../src/renderer/lib/learning-progress.js");
const essayRead = require("../src/renderer/lib/essay-read.js");
const manifest = require("../src/renderer/exercises/manifest.js");
const seed = JSON.parse(
  fs.readFileSync(
    path.join(root, "api/_lib/seeds/exercise-workspace-seed.json"),
    "utf8"
  )
);
const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const source = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);

function seededWorkspace() {
  return core.buildSeedWorkspace(seed, manifest.modules);
}

function setup(t, options = {}) {
  const dom = new JSDOM(html, {
    url: "https://test.invalid/repo",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  let width = options.width || 1280;
  let signedIn = options.signedIn !== false;
  let authChange;
  let resize;
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
  w.tinkerLearningProgress = progress;
  w.tinkerEssayRead = essayRead;
  w.tinkerExercisesManifest = manifest;
  w.tinkerLearningAuth = {
    isLearningSignedIn: () => signedIn,
    onLearningAuthChange: (fn) => {
      authChange = fn;
    },
    requestLearningSignIn() {},
  };
  const editorDocs = [];
  w.tinkerCodeMirror = {
    create: (_host, opts) => {
      editorDocs.push((opts && opts.doc) || "");
      return {
        getValue: () => (editorDocs[editorDocs.length - 1] || ""),
        destroy() {},
        focus() {},
        setFileName() {},
        setValue(doc) {
          editorDocs.push(doc == null ? "" : String(doc));
        },
      };
    },
  };
  w.fetch = async (url) => {
    if (String(url).indexOf("learning-progress") !== -1) {
      return {
        ok: true,
        json: async () => ({ data: null }),
      };
    }
    return {
      ok: true,
      json: async () => ({ workspace: seededWorkspace() }),
    };
  };
  w.eval(source);
  return {
    w,
    ui: w.tinkerExerciseWorkspaceUi,
    editorDocs,
    el: (id) => w.document.getElementById(id),
    resize: (n) => {
      width = n;
      if (resize) resize();
    },
    authChange: () => authChange,
  };
}

test("learning loop hides explorer and opens the practice file with prompt", async (t) => {
  const e = setup(t, { width: 1280 });
  await e.ui.init();
  assert.ok(e.el("repo-layout").classList.contains("repo-layout--learning"));
  assert.equal(e.el("repo-explorer").hidden, true);
  assert.equal(e.el("repo-labs-link"), null);
  assert.match(e.el("repo-learning-prompt-text").textContent, /plain English|PaymentIntent/i);
  assert.match(e.el("repo-learning-goal").textContent, /OpenAPI/);
  assert.equal(e.el("repo-code").hidden, false);
  assert.equal(e.el("repo-code-thats-everything").hidden, false);
  assert.equal(e.el("repo-code-save").hidden, true);
  assert.equal(e.el("repo-code-refactor").hidden, true);
  assert.equal(e.el("repo-tabs").hidden, true);
  assert.ok(e.editorDocs.length >= 1);
});

test("narrow width still shows prompt and That's everything", async (t) => {
  const e = setup(t, { width: 390 });
  await e.ui.init();
  assert.ok(e.el("repo-layout").classList.contains("repo-layout--learning"));
  assert.equal(e.el("repo-code").hidden, false);
  assert.equal(e.el("repo-code-thats-everything").hidden, false);
  assert.match(e.el("repo-learning-prompt-text").textContent, /./);
});

test("desktop step preview markup and harness exist", () => {
  assert.match(html, /id="repo-code-preview"/);
  assert.match(html, /Learning module step, read only/);
  assert.match(source, /showDesktopStepPreview/);
  assert.match(source, /isDesktopStepPreview/);
  assert.match(source, /kind === "step"/);
  assert.match(source, /renderMarkdownHtml|fillMarkdownElement/);
  const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
  assert.match(css, /\.repo-code__preview\.is-markdown/);
  const harness = fs.readFileSync(
    path.join(root, "src/renderer/repo/harness/desktop-step-md-preview.html"),
    "utf8"
  );
  assert.match(harness, /repo-code__preview/);
  assert.match(harness, /tinkerEssayRead\.renderMarkdown/);
  assert.doesNotMatch(harness, /\u2014|\u2013/);
});

test("learning loop harnesses cover attempt and after-apply states", () => {
  const after = fs.readFileSync(
    path.join(root, "src/renderer/repo/harness/learning-loop-after.html"),
    "utf8"
  );
  const attempt = fs.readFileSync(
    path.join(root, "src/renderer/repo/harness/learning-loop-attempt.html"),
    "utf8"
  );
  assert.match(after, /repo-learning__prompt/);
  assert.match(after, /id="repo-code-undo"/);
  assert.match(after, /is-just-applied/);
  assert.match(after, /Just beyond/);
  assert.doesNotMatch(after, /id="repo-labs-link"/);
  assert.match(attempt, /That's everything/);
  assert.match(attempt, /repo-learning__prompt/);
  assert.match(attempt, /hidden>Undo|id="repo-code-undo" hidden/);
  assert.doesNotMatch(attempt, /is-just-applied/);
  assert.doesNotMatch(html, /New learning module/);
});
