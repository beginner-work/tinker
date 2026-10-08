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

test("sign-in gate markup: no exercise files until signed in", () => {
  assert.match(html, /id="repo-explorer-signin"/);
  assert.match(html, /id="repo-explorer-gated"/);
  assert.match(html, /Sign in to Tinker or Lindow Labs Learning to open exercises/);
  assert.match(html, /id="repo-explorer-signin-btn"/);
  assert.match(ui, /function applyAuthGate/);
  assert.match(ui, /isLearningSignedIn/);
  assert.match(ui, /els\.gated\) els\.gated\.hidden = !signedIn/);
  assert.match(ui, /Never list or open exercise files while signed out|if \(!signedIn\)/);
  assert.match(ui, /state\.openTabs = \[\]/);
  assert.match(css, /\.repo-explorer-signin/);
  assert.match(css, /\.repo-explorer__gated\[hidden\]/);
  assert.match(
    css,
    /\.repo-explorer__gated\s*\{[^}]*min-height:\s*0/s,
  );
  assert.doesNotMatch(html, /\u2014|\u2013/);
});

test("isLearningSignedIn accepts Learning session OR Tinker JWT", () => {
  assert.match(authSrc, /hasTinkerSession/);
  assert.match(authSrc, /isLearningSessionSignedIn/);
  assert.match(authSrc, /tinker_jwt/);
  assert.match(authSrc, /lindowlabs:session/);
  assert.match(authSrc, /\/api\/session/);
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

  // Signed out of both → locked out.
  assert.equal(api.isLearningSignedIn(), false);
  assert.equal(api.isLearningSessionSignedIn(), false);
  assert.equal(api.hasTinkerSession(), false);

  // Tinker session alone unlocks exercises.
  store.tinker_jwt = "session-token";
  assert.equal(api.hasTinkerSession(), true);
  assert.equal(api.isLearningSignedIn(), true);

  // Clear Tinker; Learning seam alone also unlocks.
  delete store.tinker_jwt;
  api.setLearningSignedIn(true);
  assert.equal(api.isLearningSessionSignedIn(), true);
  assert.equal(api.isLearningSignedIn(), true);

  // Both cleared → locked out again.
  api.setLearningSignedIn(false);
  assert.equal(api.isLearningSignedIn(), false);
  assert.equal(api.learningOrigin(), "https://lindowlabs.dev");
  assert.equal(api.sessionEndpoint(), "https://lindowlabs.dev/api/session");
});

test("signed-out gate clears explorer file names from the DOM", () => {
  // Contract: when applyAuthGate sees signed-out, it clears #repo-explorer-body
  // so no exercise file names remain visible.
  assert.match(ui, /if \(els\.body\) clear\(els\.body\)/);
  assert.match(ui, /els\.gated\) els\.gated\.hidden = !signedIn/);
  assert.match(html, /id="repo-explorer-body"/);
  assert.match(html, /id="repo-explorer-gated"/);
});

test("hamburger opens the right essays sidebar on desktop and mobile", () => {
  assert.match(html, /id="repo-past-essays"/);
  assert.match(html, /aria-controls="repo-right"/);
  assert.match(html, /repo-essays-sidebar/);
  assert.match(page, /setMobileEssayList\(!state\.mobileEssayList\)/);
  assert.match(page, /is-essays-open/);
  assert.match(page, /data-repo-essays-list/);
  assert.doesNotMatch(
    page,
    /min-width:\s*801px\)\.matches\) return;\s*[\s\S]{0,80}setMobileEssayList/,
  );
  assert.match(css, /\.repo-top__past-essays\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(css, /\.repo-layout--write\.is-essays-open/);
  assert.match(css, /body\.repo-page--write\[data-repo-essays-list="1"\]/);
  assert.match(html, /M4 5h16M4 12h16M4 19h16/);
});

test("mobile essays and exercises drawers clear the sticky top bar", () => {
  // Sticky labs bar clearance accounts for 44px icons + vertical padding.
  assert.match(css, /--repo-top-bar:\s*calc\(56px \+ env\(safe-area-inset-top/);
  // Essays drawer starts below the top bar (not inset:0 under it).
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.is-essays-open \.repo-right\s*\{[^}]*top:\s*var\(--repo-top-bar/s,
  );
  assert.doesNotMatch(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.is-essays-open \.repo-right\s*\{[^}]*inset:\s*0/s,
  );
  // Essays header is in-flow under the top bar, not fixed at a low top offset.
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-essays-sidebar \.repo-panel__head\s*\{[^}]*position:\s*relative/s,
  );
  assert.doesNotMatch(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-essays-sidebar \.repo-panel__head\s*\{[^}]*position:\s*fixed/s,
  );
  // Exercises drawer also clears the sticky top bar.
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-explorer\s*\{[^}]*top:\s*var\(--repo-top-bar/s,
  );
});

test("beaker matches hamburger size and is labeled Exercises", () => {
  assert.match(html, /aria-label="Exercises"/);
  assert.match(html, /repo-top__labs-icon"[^>]*width="20"/);
  assert.match(css, /\.repo-top__labs\s*\{[^}]*width:\s*44px/s);
  assert.match(css, /\.repo-top__labs-icon\s*\{[^}]*width:\s*20px/s);
  assert.match(css, /\.repo-top__past-essays\s*\{[^}]*width:\s*44px/s);
});

test("mobile hides code editor and Save button", () => {
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*#repo-code-save[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-code[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(ui, /Mobile: exercise files are not editable|!isWideDesktop\(\)/);
  assert.match(ui, /els\.codeSave\) els\.codeSave\.hidden = true/);
});

test("exercise revision from essay updates README steps, not practice files", () => {
  assert.match(revSrc, /applyEssayRevision/);
  assert.match(revSrc, /Updated from your essay/);
  assert.match(ui, /repo-ex-steps|Updated steps/);
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
    "1. Read the fixture carefully",
    "2. Split the first step finer",
    "3. Merge the last two steps",
  ].join("\n");

  const result = revision.applyEssayRevision(ws, {
    core: core,
    exerciseId: "demo",
    essayBody: essay,
  });
  assert.equal(result.changed, true);
  assert.ok(result.steps.includes("Read the fixture carefully"));
  assert.ok(result.steps.includes("Split the first step finer"));
  assert.ok(result.steps.includes("Merge the last two steps"));
  const readme = core.nodeById(result.workspace.exercises.demo.nodes, "readme_1");
  assert.match(readme.content, /## Start here/);
  assert.match(readme.content, /Updated from your essay/);
  assert.match(readme.content, /Read the fixture carefully/);
  assert.match(readme.content, /Split the first step finer/);
  assert.doesNotMatch(readme.content, /Old step one/);
  const practice = core.nodeById(result.workspace.exercises.demo.nodes, "practice_1");
  assert.equal(practice.content, "// write solution\n");
  assert.equal(revision.isPracticeFile(practice), true);
});
