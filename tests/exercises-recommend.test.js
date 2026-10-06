/* Exercise recommendation: pick by tags / rotation; write pad no longer shows cards. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const pick = require("../src/renderer/lib/exercises-pick.js");
const manifest = require("../src/renderer/exercises/manifest.js");
const openSrc = fs.readFileSync(
  path.join(root, "src/renderer/exercises/exercises-open.js"),
  "utf8"
);
const repoJs = fs.readFileSync(path.join(root, "src/renderer/repo/repo.js"), "utf8");
const repoHtml = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const repoCss = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");

function memoryStorage(seed) {
  const map = Object.assign({}, seed || {});
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
    setItem(key, value) {
      map[key] = String(value);
    },
    removeItem(key) {
      delete map[key];
    },
    _map: map,
  };
}

function loadOpen() {
  const sandbox = {
    window: { tinkerExercisesManifest: manifest },
    module: { exports: {} },
    exports: {},
    require(id) {
      if (id === "./manifest.js") return manifest;
      throw new Error("unexpected require: " + id);
    },
  };
  sandbox.self = sandbox.window;
  vm.runInNewContext(openSrc, vm.createContext(sandbox));
  return sandbox.window.tinkerExercisesOpen || sandbox.module.exports;
}

test("pickExercise matches manifest tags in the session text", () => {
  const storage = memoryStorage();
  const picked = pick.pickExercise({
    modules: manifest.modules,
    title: "Notes on Stripe PaymentIntent fixtures",
    body: "I want to practice payments without a live key.",
    place: "Home",
    storage,
    advanceRotate: false,
  });
  assert.equal(picked.id, "stripe-payment-intent");
});

test("pickExercise rotates through unopened modules when tags miss", () => {
  const storage = memoryStorage();
  const first = pick.pickExercise({
    modules: manifest.modules,
    title: "Quiet morning",
    body: "Nothing technical here.",
    storage,
  });
  assert.ok(first && first.id);
  pick.markOpened(first.id, storage);
  const second = pick.pickExercise({
    modules: manifest.modules,
    title: "Another quiet note",
    body: "Still no tags.",
    storage,
  });
  assert.ok(second && second.id);
  assert.notEqual(second.id, first.id);
});

test("ensureRecommendation stores once on the essay and skips re-pick", () => {
  const storage = memoryStorage();
  const essay = {
    id: "e_1",
    title: "Refund notes",
    body: "merchant refund routes using ddd ubiquitous language in Fastify",
  };
  const first = pick.ensureRecommendation(essay, {
    modules: manifest.modules,
    title: essay.title,
    body: essay.body,
    storage,
  });
  assert.equal(first.moduleId, "api-design");
  assert.equal(essay.exerciseRecommendation.moduleId, "api-design");
  assert.equal(essay.exerciseRecommendation.dismissed, false);
  const again = pick.ensureRecommendation(essay, {
    modules: manifest.modules,
    title: "stripe now",
    body: "paymentintent fixture",
    storage,
  });
  assert.equal(again.moduleId, "api-design");
});

test("openInCursor falls back to GitHub off desktop and prefers Cursor on desktop", async () => {
  const open = loadOpen();
  const opened = [];
  const web = await open.openInCursor("stripe-payment-intent", {
    openExternal(url) { opened.push(url); },
  });
  assert.equal(web.via, "github");
  assert.match(
    opened[0],
    /github\.com\/beginner-work\/tinker\/blob\/main\/exercises\/stripe-payment-intent\.js/
  );

  const folderOpened = [];
  const folder = await open.openInCursor("api-design", {
    openExternal(url) { folderOpened.push(url); },
  });
  assert.equal(folder.via, "github");
  assert.match(
    folderOpened[0],
    /github\.com\/beginner-work\/tinker\/tree\/main\/exercises\/api-design/
  );

  const desktopCalls = [];
  const desk = await open.openInCursor("api-design", {
    isDesktopApp: true,
    openExerciseModule(id, opts) {
      desktopCalls.push({ id, opts });
      return Promise.resolve({ ok: true, via: "command" });
    },
  });
  assert.equal(desk.via, "command");
  assert.equal(desktopCalls[0].id, "api-design");
  assert.equal(desktopCalls[0].opts.preferCommand, "cursor");
});

test("write pad no longer shows Grok Bot or Try in Cursor handoffs", () => {
  assert.doesNotMatch(repoHtml, /id="repo-exercise-rec"/);
  assert.doesNotMatch(repoHtml, /Try in Cursor/);
  assert.doesNotMatch(repoHtml, /id="repo-grok-handoff"/);
  assert.doesNotMatch(repoHtml, />Grok Bot</);
  assert.doesNotMatch(repoHtml, /exercises-pick\.js/);
  assert.doesNotMatch(repoHtml, /exercises-open\.js/);
  assert.doesNotMatch(repoJs, /attachExerciseRecommendation/);
  assert.doesNotMatch(repoJs, /showExerciseRecommendationCard/);
  assert.doesNotMatch(repoJs, /repo-tree__exercise/);
  assert.doesNotMatch(repoJs, /showGrokHandoff|mountGrokHandoffUnderPad/);
  assert.doesNotMatch(repoJs, /GROK_BOT_SWITCHBOARD_HREF/);
  assert.doesNotMatch(repoCss, /\.repo-exercise-rec\b/);
  assert.doesNotMatch(repoCss, /\.repo-grok-handoff\b/);
  assert.doesNotMatch(repoCss, /\.repo-pad--with-handoff\b/);
  assert.match(repoJs, /finishWritingAfterSave/);
  // Shared helpers remain for /exercises Open in Cursor.
  assert.equal(
    fs.existsSync(path.join(root, "src/renderer/exercises/exercises-open.js")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(root, "src/renderer/lib/exercises-pick.js")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(root, "src/renderer/icons/cursor-logo.svg")),
    true
  );
});

test("curriculum modules exclude daylight-saving and outreach reps", () => {
  const ids = manifest.modules.map((m) => m.id);
  assert.deepEqual(ids, [
    "formation-persistent-storage",
    "stripe-payment-intent",
    "api-design",
  ]);
  assert.equal(ids.includes("pacific-wall-time"), false);
  assert.equal(ids.includes("mark-touch-sent"), false);
  assert.equal(fs.existsSync(path.join(root, "exercises/pacific-wall-time.js")), false);
  assert.equal(fs.existsSync(path.join(root, "exercises/mark-touch-sent.js")), false);
});
