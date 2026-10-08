/* Learning sign-in gate + hamburger essays sidebar contracts. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
const page = fs.readFileSync(path.join(root, "src/renderer/repo/repo.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "src/renderer/repo/exercise-workspace-ui.js"), "utf8");
const authSrc = fs.readFileSync(path.join(root, "src/renderer/lib/learning-auth.js"), "utf8");
const revSrc = fs.readFileSync(path.join(root, "src/renderer/lib/exercise-revision.js"), "utf8");
const core = require("../src/renderer/lib/exercise-workspace-core.js");
const revision = require("../src/renderer/lib/exercise-revision.js");

test("sign-in gate markup: no exercise files until Learning signed in", () => {
  assert.match(html, /id="repo-explorer-signin"/);
  assert.match(html, /id="repo-explorer-gated"/);
  assert.match(html, /Sign in to Lindow Labs Learning to open exercises/);
  assert.match(html, /id="repo-explorer-signin-btn"/);
  assert.match(ui, /function applyAuthGate/);
  assert.match(ui, /isLearningSignedIn/);
  assert.match(ui, /els\.gated\) els\.gated\.hidden = !signedIn/);
  assert.match(ui, /Never list or open exercise files while signed out|if \(!signedIn\)/);
  assert.match(ui, /state\.openTabs = \[\]/);
  assert.match(css, /\.repo-explorer-signin/);
  assert.match(css, /\.repo-explorer__gated\[hidden\]/);
  assert.doesNotMatch(html, /\u2014|\u2013/);
});

test("isLearningSignedIn seam: cache + postMessage + session endpoint", () => {
  assert.match(authSrc, /function isLearningSignedIn|isLearningSignedIn:/);
  assert.match(authSrc, /lindowlabs:session/);
  assert.match(authSrc, /\/api\/session/);
  assert.match(authSrc, /credentials:\s*["']include["']/);
  assert.match(authSrc, /tinker\.learning\.signedIn\.v1/);
  assert.doesNotMatch(authSrc, /beginner\.work/);

  const store = {};
  const sandbox = {
    window: {},
    document: { readyState: "complete", addEventListener() {} },
    localStorage: {
      getItem(k) { return store[k] == null ? null : store[k]; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    fetch() { return Promise.reject(new Error("no network")); },
    setTimeout() {},
    CustomEvent: function CustomEvent() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(authSrc, sandbox);
  const api = sandbox.window.tinkerLearningAuth;
  assert.equal(typeof api.isLearningSignedIn, "function");
  api._reset();
  assert.equal(api.isLearningSignedIn(), false);
  api.setLearningSignedIn(true);
  assert.equal(api.isLearningSignedIn(), true);
  api.setLearningSignedIn(false);
  assert.equal(api.isLearningSignedIn(), false);
  assert.equal(api.learningOrigin(), "https://lindowlabs.dev");
  assert.equal(api.sessionEndpoint(), "https://lindowlabs.dev/api/session");
});

test("hamburger opens the right essays sidebar on desktop and mobile", () => {
  assert.match(html, /id="repo-past-essays"/);
  assert.match(html, /aria-controls="repo-right"/);
  assert.match(html, /repo-essays-sidebar/);
  assert.match(page, /setMobileEssayList\(!state\.mobileEssayList\)/);
  assert.match(page, /is-essays-open/);
  assert.match(page, /data-repo-essays-list/);
  // No desktop early-return that ignored the hamburger.
  assert.doesNotMatch(
    page,
    /min-width:\s*801px\)\.matches\) return;\s*[\s\S]{0,80}setMobileEssayList/,
  );
  assert.match(css, /\.repo-top__past-essays\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(css, /\.repo-layout--write\.is-essays-open/);
  assert.match(css, /body\.repo-page--write\[data-repo-essays-list="1"\]/);
  // Hamburger lucide Menu paths.
  assert.match(html, /M4 5h16M4 12h16M4 19h16/);
});

test("exercise revision from essay updates README steps, not practice files", () => {
  assert.match(revSrc, /applyEssayRevision/);
  assert.match(revSrc, /extractStepsFromEssay/);
  assert.match(ui, /applyEssayRevision/);
  assert.match(page, /applyExerciseRevisionFromEssay|startExerciseEssay/);

  const ws = core.emptyWorkspace();
  ws.exerciseOrder = ["demo"];
  ws.exercises.demo = {
    id: "demo",
    name: "Demo",
    nodes: [
      {
        id: "readme_1",
        name: "README.md",
        type: "file",
        parentId: null,
        content: "# Demo\n\n## Start here\n\n1. Old step one\n2. Old step two\n",
      },
      {
        id: "practice_1",
        name: "practice.js",
        type: "file",
        parentId: null,
        content: "// write solution\n",
      },
    ],
  };

  const essay = [
    "Split the first step finer.",
    "",
    "1. Read the fixture",
    "2. Extract client_secret only",
    "3. Return the mapped object",
  ].join("\n");

  const result = revision.applyEssayRevision(ws, {
    core: core,
    exerciseId: "demo",
    essayBody: essay,
  });
  assert.equal(result.changed, true);
  assert.ok(result.steps.includes("Read the fixture"));
  assert.ok(result.steps.includes("Extract client_secret only"));
  assert.ok(result.steps.includes("Return the mapped object"));
  const readme = core.nodeById(result.workspace.exercises.demo.nodes, "readme_1");
  assert.match(readme.content, /## Start here/);
  assert.match(readme.content, /Read the fixture/);
  assert.doesNotMatch(readme.content, /Old step one/);
  const practice = core.nodeById(result.workspace.exercises.demo.nodes, "practice_1");
  assert.equal(practice.content, "// write solution\n");
});
