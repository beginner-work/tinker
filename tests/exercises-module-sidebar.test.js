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

test("write page keeps learning loop; Technical essays chrome, no Exercises nav", () => {
  assert.match(html, /repo-layout--learning/);
  assert.match(html, /id="repo-explorer"/);
  assert.match(html, /id="repo-learning-prompt"/);
  assert.doesNotMatch(html, /data-exercises-nav/);
  assert.match(html, /data-technical-essays-nav/);
  assert.match(html, /id="repo-tech-tree"/);
  assert.match(html, /id="repo-labs-link"/);
  assert.match(source, /showDesktopStepPreview/);
  assert.match(source, /isDesktopStepPreview/);
  assert.match(source, /renderMarkdownHtml|fillMarkdownElement/);
  const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
  assert.match(css, /\.repo-tech-essays-sidebar/);
  const harness = fs.readFileSync(
    path.join(root, "src/renderer/repo/harness/technical-essays-sidebar.html"),
    "utf8"
  );
  assert.match(harness, /Development/);
  assert.match(harness, /id="repo-tech-tree"/);
  assert.doesNotMatch(harness, /repo-learning__prompt/);
  assert.doesNotMatch(html, /New learning module/);
});
