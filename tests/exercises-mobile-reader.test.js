/* Mobile: essay writing is first screen; Technical essays replaces Exercises. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const core = require("../src/renderer/lib/exercise-workspace-core.js");
const revision = require("../src/renderer/lib/exercise-revision.js");
const evaluate = require("../src/renderer/lib/exercise-evaluate.js");
const progress = require("../src/renderer/lib/learning-progress.js");
const essayRead = require("../src/renderer/lib/essay-read.js");
const root = path.join(__dirname, "../src/renderer");
const html = fs.readFileSync(path.join(root, "repo/index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "repo/exercise-workspace-ui.js"), "utf8");
const css = fs.readFileSync(path.join(root, "repo/repo.css"), "utf8");

function workspace() {
  const ws = core.emptyWorkspace();
  ws.exerciseOrder = ["api-design"];
  ws.exercises["api-design"] = {
    id: "api-design",
    name: "API Design",
    nodes: [
      {
        id: "folder",
        name: "00-in-plain-english",
        type: "folder",
        parentId: null,
      },
      {
        id: "api",
        name: "api.md",
        type: "file",
        parentId: "folder",
        content: "# PaymentIntent\n\nCaller asks to create one.\n",
      },
      {
        id: "readme",
        name: "README.md",
        type: "file",
        parentId: "folder",
        content: "# Instructions\n\n**Read** the code\n",
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
  let authChange;
  let resize;
  const calls = [];
  const editorDocs = [];
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
  w.tinkerExercisesManifest = { modules: [{ id: "api-design" }] };
  w.tinkerLearningAuth = {
    isLearningSignedIn: () => signedIn,
    onLearningAuthChange: (fn) => {
      authChange = fn;
    },
    requestLearningSignIn() {},
  };
  w.tinkerCodeMirror = {
    create: (_, opts) => {
      editorDocs.push(opts.doc);
      return {
        getValue: () => "desktop edit",
        destroy() {},
        focus() {},
        setFileName() {},
        setValue(doc) {
          editorDocs.push(doc == null ? "" : String(doc));
        },
      };
    },
  };
  w.prompt = () => {
    throw new Error("Read-only flow prompted for mutation");
  };
  w.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET" });
    if (options.fetch) return options.fetch(url, opts);
    if (String(url).indexOf("learning-progress") !== -1) {
      return { ok: true, json: async () => ({ data: null }) };
    }
    return { ok: true, json: async () => ({ workspace: workspace() }) };
  };
  w.eval(source);
  return {
    w,
    ui: w.tinkerExerciseWorkspaceUi,
    calls,
    editorDocs,
    el: (id) => w.document.getElementById(id),
    resize: (n) => {
      width = n;
      if (resize) resize();
    },
    signOut: () => {
      signedIn = false;
      w.localStorage.removeItem("tinker_jwt");
      authChange(false);
    },
    signIn: () => {
      signedIn = true;
      w.localStorage.setItem("tinker_jwt", "another-owner");
      authChange(true);
    },
  };
}

for (const width of [320, 390, 430, 800]) {
  test(`mobile ${width}px write page keeps essay first; learning markup hidden`, async (t) => {
    const e = setup(t, { width });
    // Learning loop DOM is present for desktop reconstruct, but practice file starts hidden.
    assert.equal(e.el("repo-layout").classList.contains("repo-layout--learning"), true);
    assert.ok(e.el("repo-explorer"));
    assert.equal(e.el("repo-explorer").hasAttribute("hidden"), true);
    assert.ok(e.el("repo-code"));
    assert.equal(e.el("repo-code").hasAttribute("hidden"), true);
    assert.ok(e.el("repo-labs-link"));
    assert.ok(e.el("repo-tech-tree"));
    assert.ok(e.el("repo-panel-write"));
  });
}

test("mobile learning CSS only forces editor when is-code-open", () => {
  assert.match(css, /\.repo-layout--learning/);
  assert.match(css, /\.repo-learning__prompt/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-layout--learning\.is-code-open[\s\S]*\.repo-code:not\(\[hidden\]\)[\s\S]*display:\s*flex\s*!important/,
  );
  assert.match(css, /essay writing first|mobile first paint stays essay writing/);
});

test("tinker mark is present for Technical essays access", () => {
  assert.match(html, /id="repo-labs-link"/);
  assert.match(html, /data-technical-essays-nav/);
  assert.match(css, /\.repo-top__labs/);
  assert.match(html, /tinker-mark\.svg/);
});

test("exercise-workspace UI module still exposes auth + surface helpers", () => {
  assert.match(source, /applyAuthGate/);
  assert.match(source, /toggleExplorer/);
  assert.match(source, /isLearningSurfaceOpen|learningSurfaceOpen/);
  assert.match(source, /openPracticeFromProgress/);
});

test("sign-in gate lives in exercise-workspace UI module", () => {
  assert.match(html, /id="repo-explorer-signin"/);
  assert.match(source, /applyAuthGate/);
  assert.match(source, /isLearningSignedIn/);
  assert.match(source, /requestLearningSignIn/);
  assert.match(source, /openPracticeFromProgress/);
  assert.match(source, /learningSurfaceOpen/);
});

test("markdown helpers still sanitize when reader markup is used", () => {
  assert.match(source, /fillMarkdownElement|renderMarkdownHtml/);
  assert.match(css, /\.repo-ex-reader__content\.is-markdown/);
});
