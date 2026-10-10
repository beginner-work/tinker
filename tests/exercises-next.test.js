/* /next unfinished exercise picker + resume bookmarks. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const next = require("../src/renderer/lib/exercises-next.js");
const pick = require("../src/renderer/lib/exercises-pick.js");
const manifest = require("../src/renderer/exercises/manifest.js");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const auth = fs.readFileSync(path.join(root, "src/renderer/auth.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const nextHtml = fs.readFileSync(
  path.join(root, "src/renderer/next/index.html"),
  "utf8"
);
const nextJs = fs.readFileSync(
  path.join(root, "src/renderer/next/next.js"),
  "utf8"
);
const repoHtml = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const repoJs = fs.readFileSync(
  path.join(root, "src/renderer/repo/repo.js"),
  "utf8"
);
const uiJs = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);

function memoryStorage(seed) {
  const map = Object.assign(Object.create(null), seed || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; },
    _map: map,
  };
}

test("prefers in-progress module as next unfinished", () => {
  const storage = memoryStorage();
  const picked = next.pickNextExercise({
    modules: manifest.modules,
    storage,
    pickApi: pick,
  });
  assert.ok(picked);
  assert.equal(picked.moduleId, "formation-persistent-storage");
  assert.match(picked.name, /Formation/i);
});

test("skips done modules and uses resume bookmark in URL", () => {
  const modules = [
    { id: "a", name: "A", status: "Done", description: "x" },
    { id: "b", name: "B", status: "Not started", description: "y" },
  ];
  const storage = memoryStorage();
  next.setResume("b", { nodeId: "file_1", fileName: "README.md" }, storage);
  const picked = next.pickNextExercise({ modules, storage, pickApi: pick });
  assert.equal(picked.moduleId, "b");
  assert.match(picked.resumeLabel, /README\.md/);
  const url = next.buildNextRepoUrl(picked, { lockIn: true, from: "next" });
  assert.match(url, /\/repo\?/);
  assert.match(url, /exercise=b/);
  assert.match(url, /node=file_1/);
  assert.match(url, /lockin=1/);
  assert.match(url, /from=next/);
});

test("opened-but-not-done ranks ahead of untouched not-started", () => {
  const modules = [
    { id: "fresh", name: "Fresh", status: "Not started", description: "a" },
    { id: "touched", name: "Touched", status: "Not started", description: "b" },
  ];
  const storage = memoryStorage();
  pick.markOpened("touched", storage);
  const picked = next.pickNextExercise({ modules, storage, pickApi: pick });
  assert.equal(picked.moduleId, "touched");
});

test("/next route, auth return, and SW bypass are wired", () => {
  assert.match(vercel, /"\/next"/);
  assert.match(vercel, /\/next\/index\.html/);
  assert.match(auth, /\/next/);
  assert.match(sw, /pathname === "\/next"/);
  assert.match(nextHtml, /exercises-next\.js/);
  assert.match(nextJs, /pickNextExercise/);
  assert.match(nextJs, /lockin=1/);
  assert.match(nextJs, /tinker_mcp_return/);
});

test("repo deep link opens exercise and can start lock-in", () => {
  assert.match(repoHtml, /exercises-next\.js/);
  assert.match(repoHtml, /lock-in\.js/);
  assert.match(repoHtml, /lock-in-ui\.js/);
  assert.match(repoJs, /applyExerciseDeepLink/);
  assert.match(repoJs, /startLockIn/);
  assert.match(repoJs, /openExercise/);
  assert.match(uiJs, /rememberResume/);
  assert.match(uiJs, /openExercise:\s*openExercise/);
});

test("next page redirects signed-in owners without inventing modules", () => {
  const storage = memoryStorage();
  storage.setItem("tinker_jwt", "fake.token");
  const sandbox = {
    window: {
      localStorage: storage,
      sessionStorage: memoryStorage(),
      location: {
        search: "?lockin=1",
        assign() {},
        replace(url) { sandbox.replaced = url; },
      },
      tinkerExercisesManifest: manifest,
      tinkerExercisesPick: pick,
      tinkerExercisesNext: next,
    },
    document: {
      getElementById() { return { textContent: "" }; },
    },
    localStorage: storage,
  };
  sandbox.window.document = sandbox.document;
  vm.runInNewContext(nextJs, vm.createContext(sandbox));
  assert.match(sandbox.replaced, /\/repo\?/);
  assert.match(sandbox.replaced, /exercise=formation-persistent-storage/);
  assert.match(sandbox.replaced, /lockin=1/);
});
