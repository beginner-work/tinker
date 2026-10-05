/* Exercise recommendation: pick by tags / rotation, save on essay, sidebar + card. */
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
    title: "Outreach notes",
    body: "markTouchSent and touch status sent",
  };
  const first = pick.ensureRecommendation(essay, {
    modules: manifest.modules,
    title: essay.title,
    body: essay.body,
    storage,
  });
  assert.equal(first.moduleId, "mark-touch-sent");
  assert.equal(essay.exerciseRecommendation.moduleId, "mark-touch-sent");
  assert.equal(essay.exerciseRecommendation.dismissed, false);
  const again = pick.ensureRecommendation(essay, {
    modules: manifest.modules,
    title: "stripe now",
    body: "paymentintent fixture",
    storage,
  });
  assert.equal(again.moduleId, "mark-touch-sent");
});

test("openInCursor falls back to GitHub off desktop and prefers Cursor on desktop", async () => {
  const open = loadOpen();
  const opened = [];
  const web = await open.openInCursor("pacific-wall-time", {
    openExternal(url) { opened.push(url); },
  });
  assert.equal(web.via, "github");
  assert.match(
    opened[0],
    /github\.com\/beginner-work\/tinker\/blob\/main\/exercises\/pacific-wall-time\.js/
  );

  const desktopCalls = [];
  const desk = await open.openInCursor("pacific-wall-time", {
    isDesktopApp: true,
    openExerciseModule(id, opts) {
      desktopCalls.push({ id, opts });
      return Promise.resolve({ ok: true, via: "command" });
    },
  });
  assert.equal(desk.via, "command");
  assert.equal(desktopCalls[0].id, "pacific-wall-time");
  assert.equal(desktopCalls[0].opts.preferCommand, "cursor");
});

test("repo page wires recommendation card, sidebar row, and checked-in Cursor logo", () => {
  assert.match(repoHtml, /id="repo-exercise-rec"/);
  assert.match(repoHtml, /Open in Cursor/);
  assert.match(repoHtml, /Try in Cursor/);
  assert.match(repoHtml, /cursor-logo\.svg/);
  assert.match(repoHtml, /exercises-pick\.js/);
  assert.match(repoHtml, /exercises-open\.js/);
  assert.equal(repoHtml.includes("—"), false);
  assert.match(repoJs, /attachExerciseRecommendation/);
  assert.match(repoJs, /showExerciseRecommendationCard/);
  assert.match(repoJs, /repo-tree__exercise/);
  assert.match(repoJs, /openInCursor/);
  assert.match(repoJs, /isPhoneViewport/);
  assert.match(repoCss, /\.repo-exercise-rec\b/);
  assert.match(repoCss, /\.repo-tree__exercise\b/);
  assert.equal(
    fs.existsSync(path.join(root, "src/renderer/icons/cursor-logo.svg")),
    true
  );
  const logo = fs.readFileSync(
    path.join(root, "src/renderer/icons/cursor-logo.svg"),
    "utf8"
  );
  assert.match(logo, /<svg/i);
  assert.ok(logo.length < 50000);
});
