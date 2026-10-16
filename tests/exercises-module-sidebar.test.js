/* Exercises sidebar: learning-module presentation (no file/folder tree). */
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
        getValue: () => "",
        destroy() {},
        focus() {},
        setFileName() {},
        setValue() {},
      };
    },
  };
  w.fetch = async () => ({
    ok: true,
    json: async () => ({ workspace: seededWorkspace() }),
  });
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

test("desktop sidebar shows module steps and Your answer, not README.md tree rows", async (t) => {
  const e = setup(t, { width: 1280 });
  await e.ui.init();
  const body = e.el("repo-explorer-body");
  assert.ok(body);
  assert.match(body.textContent, /OpenAPI by hand \(payments\)/);
  assert.match(body.textContent, /In plain English/);
  assert.match(body.textContent, /Your answer/);
  assert.match(body.textContent, /Next module/);
  assert.match(body.textContent, /Generated after you finish this one/);
  assert.equal(body.textContent.includes("README.md"), false);
  assert.equal(body.textContent.includes("steps.json"), false);
  assert.equal(body.textContent.includes("00-in-plain-english"), false);
  assert.equal(body.textContent.includes("openapi.yaml"), false);
  assert.equal(body.querySelectorAll(".repo-ex-tree .repo-ex-node").length, 0);
  assert.ok(body.querySelector(".repo-ex-module__progress"));
  assert.ok(body.querySelector(".repo-ex-module-placeholder"));
  assert.equal(e.el("repo-ex-new-file"), null);
  assert.equal(e.el("repo-explorer-toolbar"), null);
  assert.equal(e.w.document.body.textContent.includes("New learning module"), false);
});

test("mobile drawer uses the same module progression chrome", async (t) => {
  const e = setup(t, { width: 390 });
  await e.ui.init();
  const body = e.el("repo-explorer-body");
  assert.match(body.textContent, /OpenAPI by hand \(payments\)/);
  assert.match(body.textContent, /Your answer/);
  assert.match(body.textContent, /Next module/);
  assert.equal(body.textContent.includes("README.md"), false);
  assert.equal(body.querySelectorAll(".repo-ex-write-about").length, 0);
});

test("opening a step shows content labels without file extensions", async (t) => {
  const e = setup(t, { width: 1280 });
  await e.ui.init();
  const answerBtn = e.el("repo-explorer-body").querySelector(".repo-ex-step__answer-btn");
  assert.ok(answerBtn);
  answerBtn.click();
  assert.match(e.el("repo-code-path").textContent, /Your answer/);
  assert.doesNotMatch(e.el("repo-code-path").textContent, /\.md|\.yaml/);
});

test("desktop opens lesson steps as rendered markdown preview, answers stay editable", async (t) => {
  const e = setup(t, { width: 1280 });
  await e.ui.init();
  const stepBtn = e.el("repo-explorer-body").querySelector(".repo-ex-step__btn");
  assert.ok(stepBtn);
  stepBtn.click();

  const preview = e.el("repo-code-preview");
  const surface = e.el("repo-code-surface");
  assert.ok(preview);
  assert.equal(preview.hidden, false);
  assert.equal(preview.classList.contains("is-markdown"), true);
  assert.match(e.el("repo-code-path").textContent, /00 In plain English|In plain English/);
  assert.doesNotMatch(e.el("repo-code-path").textContent, /README\.md/);
  assert.ok(preview.querySelector("h1"));
  assert.match(preview.querySelector("h1").textContent, /In plain English/);
  assert.ok(preview.querySelector("strong"));
  assert.equal(preview.textContent.includes("**"), false);
  assert.equal(preview.textContent.includes("# 00"), false);
  assert.equal(surface.hidden, true);
  assert.equal(e.el("repo-code-save").hidden, true);
  assert.equal(e.el("repo-code-thats-everything").hidden, true);
  assert.equal(e.el("repo-code-refactor").hidden, true);
  assert.equal(e.editorDocs.length, 0);

  const answerBtn = e.el("repo-explorer-body").querySelector(".repo-ex-step__answer-btn");
  assert.ok(answerBtn);
  answerBtn.click();
  assert.equal(e.el("repo-code-preview").hidden, true);
  assert.equal(e.el("repo-code-surface").hidden, false);
  assert.match(e.el("repo-code-path").textContent, /Your answer/);
  assert.equal(e.el("repo-code-save").hidden, false);
  assert.equal(e.el("repo-code-thats-everything").hidden, false);
  assert.equal(e.el("repo-code-refactor").hidden, false);
  assert.ok(e.editorDocs.length >= 1);
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
