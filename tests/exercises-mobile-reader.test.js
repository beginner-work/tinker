/* Read-only exercise UI behavioral tests; all network and auth are mocked. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
// jsdom is installed by the pinned isomorphic-dompurify dependency.
const { JSDOM } = require("jsdom");
const core = require("../src/renderer/lib/exercise-workspace-core.js");
const revision = require("../src/renderer/lib/exercise-revision.js");
const essayRead = require("../src/renderer/lib/essay-read.js");
const root = path.join(__dirname, "../src/renderer");
const html = fs.readFileSync(path.join(root, "repo/index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "repo/exercise-workspace-ui.js"), "utf8");
const css = fs.readFileSync(path.join(root, "repo/repo.css"), "utf8");
function workspace() {
  const ws = core.emptyWorkspace();
  ws.exerciseOrder = ["api-design"];
  ws.exercises["api-design"] = { id: "api-design", name: "API Design", nodes: [
    { id: "readme", name: "README.md", type: "file", parentId: null, content: "# Instructions\n\n**Read** the code\n\n1. Read the code\n2. Try it on desktop\n\n```js\nconst x = 1;\n```\n\n[docs](https://example.com)" },
    { id: "folder", name: "src", type: "folder", parentId: null },
    { id: "code", name: "practice.js", type: "file", parentId: "folder", content: '<script>window.executed = true</script>\nconst saved = 42;\n' + "x".repeat(600) },
    { id: "empty", name: "empty.js", type: "file", parentId: null, content: "" },
  ] };
  return ws;
}
function setup(t, options = {}) {
  const dom = new JSDOM(html, { url: "https://test.invalid/repo", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  let width = options.width || 390, signedIn = options.signedIn !== false, authChange, resize;
  const calls = [], editorDocs = [];
  w.localStorage.setItem("tinker_jwt", "mock-owner");
  w.matchMedia = () => ({ matches: width >= 801, addEventListener: (_, fn) => { resize = fn; } });
  w.tinkerExerciseWorkspaceCore = core;
  w.tinkerExerciseRevision = revision;
  w.tinkerEssayRead = essayRead;
  w.tinkerExercisesManifest = { modules: [{ id: "api-design" }] };
  w.tinkerLearningAuth = { isLearningSignedIn: () => signedIn, onLearningAuthChange: fn => { authChange = fn; }, requestLearningSignIn() {} };
  w.tinkerCodeMirror = { create: (_, opts) => {
    editorDocs.push(opts.doc);
    return { getValue: () => "desktop edit", destroy() {}, focus() {}, setFileName() {}, setValue() {} };
  } };
  w.prompt = () => { throw new Error("Read-only flow prompted for mutation"); };
  w.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET" });
    if (options.fetch) return options.fetch(url, opts);
    return { ok: true, json: async () => ({ workspace: workspace() }) };
  };
  w.eval(source);
  const ui = w.tinkerExerciseWorkspaceUi;
  return { w, ui, calls, editorDocs, el: id => w.document.getElementById(id),
    resize: n => { width = n; resize(); },
    signOut: () => { signedIn = false; w.localStorage.removeItem("tinker_jwt"); authChange(false); },
    signIn: () => { signedIn = true; w.localStorage.setItem("tinker_jwt", "another-owner"); authChange(true); },
  };
}
for (const width of [320, 390, 430, 800]) {
  test(`mobile ${width}px opens real saved files without editor or mutations`, async t => {
    const e = setup(t, { width }); await e.ui.init();
    assert.equal(e.calls[0].url, "/api/exercise-workspace?action=read");
    assert.equal(e.el("repo-layout").classList.contains("is-explorer-open"), true);
    e.ui.openExercise("api-design");
    const md = e.el("repo-ex-reader-content");
    assert.equal(md.classList.contains("is-markdown"), true);
    assert.equal(md.querySelector("h1").textContent, "Instructions");
    assert.equal(md.querySelector("strong").textContent, "Read");
    assert.ok(md.querySelector("ol"));
    assert.ok(md.querySelector("pre code"));
    assert.equal(md.querySelector("a").getAttribute("href"), "https://example.com");
    assert.equal(md.querySelector("script"), null);
    e.ui.openFile("api-design", "code");
    assert.equal(e.el("repo-ex-reader-content").classList.contains("is-markdown"), false);
    assert.match(e.el("repo-ex-reader-content").textContent, /const saved = 42/);
    assert.equal(e.el("repo-ex-reader-content").querySelector("script"), null);
    assert.equal(e.w.executed, undefined);
    assert.match(e.el("repo-ex-reader-path").textContent, /src \/ practice.js/);
    assert.equal(e.el("repo-ex-reader").hidden, false);
    assert.equal(e.el("repo-explorer-body").hidden, true);
    assert.equal(e.el("repo-explorer-toolbar").hidden, true);
    assert.equal(e.el("repo-code").hidden, true);
    assert.equal(e.editorDocs.length, 0);
    assert.equal(e.w.document.querySelectorAll("#repo-explorer-body .repo-ex-node__icon, #repo-explorer-body .repo-ex-write-about").length, 0);
    assert.equal(e.w.document.querySelectorAll('#repo-explorer-body [draggable="true"]').length, 0);
    e.ui.createNode("file"); e.ui.moveNode("api-design", "code", null);
    e.ui.startWriteAboutExercise("api-design");
    e.el("repo-code-save").click(); e.el("repo-ex-new-folder").click();
    await assert.rejects(e.ui.applyEssayRevision("api-design", "Change this"), /read-only/);
    assert.equal(e.calls.some(c => c.method !== "GET"), false);
  });
}
test("back, repeated opens, browser back/forward, close, and focus", async t => {
  const e = setup(t); await e.ui.init();
  e.ui.openFile("api-design", "code");
  const historyLength = e.w.history.length;
  e.ui.openFile("api-design", "code");
  assert.equal(e.w.history.length, historyLength);
  const entry = e.w.history.state;
  e.w.dispatchEvent(new e.w.PopStateEvent("popstate", { state: null }));
  assert.equal(e.el("repo-ex-reader").hidden, true);
  assert.equal(e.el("repo-explorer-body").hidden, false);
  assert.equal(e.w.document.activeElement.textContent, "practice.js");
  e.w.dispatchEvent(new e.w.PopStateEvent("popstate", { state: entry }));
  assert.equal(e.el("repo-ex-reader").hidden, false);
  e.el("repo-ex-reader-back").click();
  assert.equal(e.el("repo-ex-reader").hidden, true);
  e.w.dispatchEvent(new e.w.PopStateEvent("popstate", { state: null }));
  e.ui.openFile("api-design", "readme");
  e.el("repo-explorer-collapse").click();
  assert.equal(e.el("repo-layout").classList.contains("is-explorer-open"), false);
  assert.equal(e.el("repo-pad").hidden, false);
});
test("loading, request error and retry are visible; no misleading template fallback on mobile", async t => {
  let resolveRequest, fail = true;
  const e = setup(t, { fetch: () => new Promise(resolve => { resolveRequest = () => resolve({ ok: !fail, status: 503, json: async () => fail ? {} : { workspace: workspace() } }); }) });
  const init = e.ui.init();
  assert.match(e.el("repo-ex-load-status").textContent, /Loading/);
  resolveRequest(); await init;
  assert.match(e.el("repo-ex-load-status").textContent, /Could not load/);
  assert.equal(e.el("repo-ex-load-retry").hidden, false);
  assert.equal(e.calls.length, 1);
  fail = false; e.el("repo-ex-load-retry").click(); resolveRequest();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(e.el("repo-ex-load-status").hidden, true);
  assert.ok(e.ui.getWorkspace().exercises["api-design"]);
});
test("empty workspace and empty files have readable states", async t => {
  const e = setup(t); await e.ui.init(); e.ui.openFile("api-design", "empty");
  assert.equal(e.el("repo-ex-reader-content").textContent, "This learning module is empty.");
  e.ui._setWorkspace(core.emptyWorkspace());
  assert.equal(e.el("repo-explorer-empty").hidden, false);
  assert.equal(e.el("repo-ex-reader").hidden, true);
});
test("signout clears files; late responses and old reader history cannot restore them", async t => {
  const e = setup(t); await e.ui.init(); e.ui.openFile("api-design", "code");
  const entry = e.w.history.state;
  e.signOut();
  assert.equal(e.el("repo-ex-reader-content").textContent, "");
  assert.equal(e.el("repo-explorer-body").textContent, "");
  e.signIn(); await new Promise(r => setTimeout(r, 0));
  e.w.dispatchEvent(new e.w.PopStateEvent("popstate", { state: entry }));
  assert.equal(e.el("repo-ex-reader").hidden, true);
});
test("signout while loading discards late authenticated responses", async t => {
  let resolve;
  const e = setup(t, { fetch: () => new Promise(r => { resolve = r; }) });
  const pending = e.ui.init(); e.signOut();
  resolve({ ok: true, json: async () => ({ workspace: workspace() }) }); await pending;
  assert.equal(Object.keys(e.ui.getWorkspace().exercises).length, 0);
  assert.equal(e.el("repo-explorer-body").textContent, "");
});
test("desktop editor keeps blank practice and save behavior, resize makes it read-only", async t => {
  const e = setup(t, { width: 1200 }); await e.ui.init();
  assert.equal(e.calls[0].url, "/api/exercise-workspace?action=list");
  e.ui.openFile("api-design", "code"); assert.equal(e.editorDocs[0], "");
  e.el("repo-code-save").click(); await new Promise(r => setTimeout(r, 0));
  assert.ok(e.calls.some(c => c.method === "POST"));
  e.resize(390); const count = e.calls.length;
  e.el("repo-code-save").click(); e.ui.createNode("file");
  assert.equal(e.calls.length, count);
  assert.equal(e.el("repo-code").hidden, true);
  e.ui.openFile("api-design", "code"); assert.equal(e.el("repo-ex-reader").hidden, false);
  e.resize(1200); assert.equal(e.el("repo-ex-reader").hidden, true);
  assert.equal(e.el("repo-explorer-toolbar").hidden, false);
});
test("mobile reader scrollports constrain long lines and include safe area/touch targets", () => {
  assert.match(css, /\.repo-ex-reader__content\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.repo-ex-reader__content\s*\{[^}]*white-space:\s*pre/s);
  assert.match(css, /\.repo-ex-reader__content\.is-markdown\s*\{[^}]*white-space:\s*normal/s);
  assert.match(css, /\.repo-ex-reader__content\.is-markdown\s*\{[^}]*font-family:\s*var\(--font-display/s);
  assert.match(css, /\.repo-ex-reader__back\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /padding-bottom:\s*env\(safe-area-inset-bottom/);
  assert.match(css, /\.repo-top\.repo-top--labs\s*\{[^}]*safe-area-inset-left/s);
  assert.match(css, /\.repo-write-empty/);
  assert.match(html, /id="repo-write-empty"/);
  assert.match(html, /id="repo-ex-reader-content"[^>]*><\/div>/);
});

test("reopening during asynchronous Back waits for history and keeps the new file open", async t => {
  const e = setup(t); await e.ui.init();
  e.ui.openFile("api-design", "readme");
  e.el("repo-ex-reader-back").click();
  e.ui.openFile("api-design", "code");
  assert.equal(e.ui._state.queuedMobileFile.nodeId, "code");
  await new Promise(r => e.w.addEventListener("popstate", r, { once: true }));
  assert.equal(e.ui._state.mobileFile.nodeId, "code");
  assert.equal(e.el("repo-ex-reader").hidden, false);
  assert.equal(e.w.history.state.tinkerExerciseReader.nodeId, "code");
});

test("markdown reader sanitizes raw HTML and script tags in .md files", async t => {
  const e = setup(t); await e.ui.init();
  const ws = workspace();
  ws.exercises["api-design"].nodes.push({
    id: "evil",
    name: "evil.md",
    type: "file",
    parentId: null,
    content: "# Hi\n\n<script>window.pwned=1</script>\n\n<img src=x onerror=\"window.pwned=1\">\n\n**ok**",
  });
  e.ui._setWorkspace(ws);
  e.ui.openFile("api-design", "evil");
  const content = e.el("repo-ex-reader-content");
  assert.equal(content.classList.contains("is-markdown"), true);
  assert.equal(content.querySelector("script"), null);
  assert.equal(content.querySelector("img"), null);
  assert.equal(e.w.pwned, undefined);
  assert.equal(content.querySelector("strong").textContent, "ok");
  assert.equal(content.querySelector("h1").textContent, "Hi");
});
