/* UI-contract smoke test for the /repo repository preview skeleton.
 *
 * Structural + small DOM sandbox — sample fixtures, location in
 * localStorage only. No API/storage tables/git wiring.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
const page = fs.readFileSync(path.join(root, "src/renderer/repo/repo.js"), "utf8");
const fixturesSrc = fs.readFileSync(path.join(root, "src/renderer/repo/fixtures.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");

const REMOVED_CENTER_STRINGS = [
  "Select a reflection or piece",
  "Sample data only. Nothing is saved.",
  "Read-only sample version",
  "Develop into the repository",
  ">Title<",
  ">Body<",
  'for="repo-title"',
  'id="repo-title"',
  'id="repo-empty"',
  'id="repo-reflection-pane"',
  'id="repo-editor"',
  'id="repo-readonly-note"',
  "repo-empty__title",
  "repo-empty__note",
];

function makeEl(tag, id, store) {
  const listeners = {};
  const attrs = {};
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    id: id || "",
    className: "",
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    title: "",
    type: tag === "button" ? "button" : "",
    children: [],
    parentNode: null,
    style: {},
    firstChild: null,
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    dispatch(type, event) {
      const list = listeners[type] || [];
      for (const fn of list) fn(event || { type, target: el, preventDefault() {}, stopPropagation() {}, key: "" });
    },
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      el.firstChild = el.children[0] || null;
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      el.firstChild = el.children[0] || null;
      return child;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
      if (name === "hidden") el.hidden = value !== false && value !== "false";
      if (name === "aria-expanded") el["aria-expanded"] = String(value);
    },
    getAttribute(name) {
      return attrs[name] == null ? null : attrs[name];
    },
    focus() {},
    contains(node) {
      if (node === el) return true;
      return el.children.some((c) => c === node || (c.contains && c.contains(node)));
    },
  };
  if (id) store[id] = el;
  return el;
}

function bootRepoPage(options) {
  const opts = options || {};
  const byId = {};
  const ids = [
    "repo-name",
    "repo-branch",
    "repo-reflections-list",
    "repo-tree",
    "repo-new-piece",
    "repo-body",
    "repo-location",
    "repo-location-btn",
    "repo-location-panel",
    "repo-location-input",
    "repo-location-save",
    "repo-location-choose",
    "repo-changes-list",
    "repo-change-note",
    "repo-save-version",
    "repo-save-hint",
    "repo-history-list",
    "repo-mobile",
    "repo-mobile-reflections",
    "repo-mobile-tree",
    "repo-mobile-piece",
    "repo-mobile-title",
    "repo-mobile-body",
  ];
  for (const id of ids) makeEl("div", id, byId);
  byId["repo-body"].tagName = "TEXTAREA";
  byId["repo-location-btn"].tagName = "BUTTON";
  byId["repo-location-btn"].textContent = "Tinker location";
  byId["repo-location-panel"].hidden = true;
  byId["repo-location-input"].tagName = "INPUT";
  byId["repo-location-save"].tagName = "BUTTON";
  byId["repo-location-choose"].tagName = "BUTTON";
  byId["repo-location-choose"].hidden = true;
  byId["repo-location"].contains = function (node) {
    return (
      node === byId["repo-location"] ||
      node === byId["repo-location-btn"] ||
      node === byId["repo-location-panel"] ||
      node === byId["repo-location-input"] ||
      node === byId["repo-location-save"] ||
      node === byId["repo-location-choose"]
    );
  };

  const storage = new Map();
  if (opts.storedLocation) storage.set("tinker.repo.location.v1", opts.storedLocation);

  const docListeners = {};
  const document = {
    getElementById(id) {
      return byId[id] || null;
    },
    createElement(tag) {
      return makeEl(tag, "", byId);
    },
    addEventListener(type, fn) {
      (docListeners[type] || (docListeners[type] = [])).push(fn);
    },
    activeElement: null,
  };

  const windowObj = {
    tinkerRepoFixtures: undefined,
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    tinker: opts.tinker || undefined,
  };

  const sandbox = {
    window: windowObj,
    document,
    console,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fixturesSrc, context);
  windowObj.tinkerRepoFixtures = sandbox.window.tinkerRepoFixtures;
  // fixtures.js attaches to root/window; ensure the page sees it
  if (!windowObj.tinkerRepoFixtures && sandbox.tinkerRepoFixtures) {
    windowObj.tinkerRepoFixtures = sandbox.tinkerRepoFixtures;
  }
  vm.runInContext(page, context);

  return {
    byId,
    storage,
    window: windowObj,
    document,
    click(id) {
      byId[id].dispatch("click", {
        type: "click",
        target: byId[id],
        preventDefault() {},
        stopPropagation() {},
      });
    },
  };
}

test("repo preview page is a blank writing surface with location dropdown", () => {
  assert.match(html, /Repository preview/);
  assert.match(html, /id="repo-reflections-list"/);
  assert.match(html, /id="repo-tree"/);
  assert.match(html, /id="repo-new-piece"/);
  assert.match(html, /id="repo-body"/);
  assert.match(html, /class="repo-center"/);
  assert.match(html, /class="writing-input repo-surface__input"/);
  assert.match(html, /id="repo-location-btn"/);
  assert.match(html, /Tinker location/);
  assert.match(html, /id="repo-location-panel"/);
  assert.match(html, /id="repo-location-input"/);
  assert.match(html, /id="repo-location-save"/);
  assert.match(html, /id="repo-location-choose"/);
  assert.match(html, /Choose folder/);
  assert.match(html, /id="repo-changes-list"/);
  assert.match(html, /id="repo-save-version"/);
  assert.match(html, /id="repo-history-list"/);
  assert.match(html, /id="repo-mobile"/);
  assert.match(html, /src="\/repo\/fixtures\.js"/);
  assert.match(html, /src="\/repo\/repo\.js"/);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(page.includes("innerHTML"), false);
  assert.doesNotMatch(html, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(page, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(fixturesSrc, /Tyler|tlindow|nanoengineering/i);

  for (const snippet of REMOVED_CENTER_STRINGS) {
    assert.equal(
      html.includes(snippet),
      false,
      `center should not include leftover UI: ${snippet}`,
    );
    assert.equal(
      page.includes(snippet),
      false,
      `repo.js should not include leftover UI: ${snippet}`,
    );
  }

  // Textarea has no placeholder and opens without seeded copy.
  assert.doesNotMatch(html, /id="repo-body"[^>]*placeholder=/);
  assert.match(html, /<textarea class="writing-input repo-surface__input" id="repo-body" spellcheck="true"><\/textarea>/);
});

test("repo fixtures expose sample reflections, folders, and history", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fixturesSrc, vm.createContext(sandbox));
  const sample = sandbox.window.tinkerRepoFixtures.SAMPLE_REPO;
  assert.ok(sample.name);
  assert.ok(sample.branchLabel);
  assert.ok(Array.isArray(sample.reflections));
  assert.ok(sample.reflections.length >= 2);
  assert.ok(Array.isArray(sample.folders));
  assert.ok(sample.folders.length >= 2);
  assert.ok(sample.folders[0].pieces.length >= 1);
  assert.ok(Array.isArray(sample.history));
  assert.ok(sample.history.length >= 1);
  assert.match(sample.reflections[0].title, /Sample/);
});

test("repo preview routes and desktop entry are wired", () => {
  assert.match(vercel, /\/repo\/index\.html/);
  assert.match(sw, /pathname === "\/repo"/);
  assert.match(settings, /href="\/repo"/);
  assert.match(settings, /Repository preview/);
  assert.match(mainJs, /label:\s*"Repository preview"/);
  assert.match(mainJs, /\/repo/);
  assert.match(css, /\.repo-layout/);
  assert.match(css, /\.repo-reflections/);
  assert.match(css, /\.repo-surface/);
  assert.match(css, /\.repo-location/);
});

test("repo page stays UI-only — no API or git wiring", () => {
  assert.doesNotMatch(page, /fetch\s*\(/);
  assert.doesNotMatch(page, /indexedDB|prisma/i);
  assert.doesNotMatch(fixturesSrc, /fetch\s*\(|localStorage|prisma/i);
  assert.match(page, /localStorage/);
  assert.match(page, /tinker\.repo\.location\.v1/);
  assert.match(page, /getLocation/);
  assert.match(page, /window\.tinkerRepo/);
  assert.match(page, /saveHint/);
  assert.match(html, /Not wired yet/);
  assert.match(mainJs, /notesFolder:pick/);
});

test("center textarea opens blank and location saves across reload", () => {
  const first = bootRepoPage();
  assert.equal(first.byId["repo-body"].value, "", "default center is blank");
  assert.equal(first.window.tinkerRepo.getLocation(), "");
  assert.equal(first.byId["repo-location-btn"].textContent, "Tinker location");
  assert.equal(first.byId["repo-location-panel"].hidden, true);
  assert.equal(first.byId["repo-location-choose"].hidden, true);

  first.click("repo-location-btn");
  assert.equal(first.byId["repo-location-panel"].hidden, false);

  first.byId["repo-location-input"].value = "/Users/tyler/code/tinker";
  first.click("repo-location-save");

  assert.equal(first.window.tinkerRepo.getLocation(), "/Users/tyler/code/tinker");
  assert.equal(first.storage.get("tinker.repo.location.v1"), "/Users/tyler/code/tinker");
  assert.equal(first.byId["repo-location-panel"].hidden, true);
  assert.match(first.byId["repo-location-btn"].textContent, /tinker/);
  assert.notEqual(first.byId["repo-location-btn"].textContent, "Tinker location");

  const second = bootRepoPage({
    storedLocation: first.storage.get("tinker.repo.location.v1"),
  });
  assert.equal(second.byId["repo-body"].value, "", "reload still opens blank center");
  assert.equal(second.window.tinkerRepo.getLocation(), "/Users/tyler/code/tinker");
  assert.match(second.byId["repo-location-btn"].textContent, /tinker/);
});

test("desktop folder picker is offered when pickNotesFolder exists", async () => {
  let called = false;
  const env = bootRepoPage({
    tinker: {
      pickNotesFolder() {
        called = true;
        return Promise.resolve({ path: "/Users/tyler/code/tinker", name: "tinker" });
      },
    },
  });
  assert.equal(env.byId["repo-location-choose"].hidden, false);
  env.click("repo-location-btn");
  env.click("repo-location-choose");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, true);
  assert.equal(env.window.tinkerRepo.getLocation(), "/Users/tyler/code/tinker");
});

test("selecting a sidebar piece loads text into the same blank surface", () => {
  const env = bootRepoPage();
  assert.equal(env.byId["repo-body"].value, "");

  // Click the first piece button created in the tree.
  const pieceBtn = env.byId["repo-tree"].children
    .flatMap((folder) => folder.children)
    .find((node) => node.className && node.className.includes("repo-tree__pieces"))
    ?.children?.[0]?.children?.[0];

  // Fallback: walk recursively for a piece button
  function findPieceButton(node) {
    if (!node) return null;
    if (node.className === "repo-tree__piece" || (node.className && node.className.includes("repo-tree__piece"))) {
      return node;
    }
    for (const child of node.children || []) {
      const found = findPieceButton(child);
      if (found) return found;
    }
    return null;
  }
  const btn = pieceBtn || findPieceButton(env.byId["repo-tree"]);
  assert.ok(btn, "expected a piece button in the tree");
  btn.dispatch("click", { type: "click", target: btn, preventDefault() {}, stopPropagation() {} });
  assert.match(env.byId["repo-body"].value, /Placeholder body|Sample/);
});
