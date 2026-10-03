/* /repo — stories as Markdown files + blank writing surface. */

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
const storiesSrc = fs.readFileSync(path.join(root, "src/renderer/lib/stories-md.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
const md = require("../src/renderer/lib/stories-md.js");

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
      if (name === "data-story-id") el.dataset = Object.assign(el.dataset || {}, { storyId: String(value) });
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
    "repo-tree",
    "repo-stories-empty",
    "repo-new-piece",
    "repo-body",
    "repo-location",
    "repo-location-btn",
    "repo-location-panel",
    "repo-location-input",
    "repo-location-save",
    "repo-location-choose",
    "repo-file-path",
    "repo-sync-hint",
    "repo-download-one",
    "repo-download-all",
    "repo-mobile",
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
  byId["repo-download-one"].tagName = "BUTTON";
  byId["repo-download-one"].hidden = true;
  byId["repo-download-all"].tagName = "BUTTON";
  byId["repo-download-all"].hidden = true;
  byId["repo-stories-empty"].hidden = true;
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
  if (opts.token) storage.set("tinker_jwt", opts.token);

  const reflections = opts.reflections || [
    {
      id: "self_1",
      title: "Merchant portal reliability",
      body: "While managing 10 incidents might sound like a failure",
      createdAt: "2026-10-02T17:33:00.000Z",
      updatedAt: "2026-10-02T17:33:00.000Z",
    },
    {
      id: "self_2",
      title: "affirm.com",
      body: "I have no real domain expertise in marketing",
      createdAt: "2026-10-02T17:41:00.000Z",
      updatedAt: "2026-10-02T17:41:00.000Z",
    },
  ];

  const written = [];
  const listedFiles = opts.listedFiles || [];

  const docListeners = {};
  const document = {
    body: makeEl("body", "", byId),
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
    sessionStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    tinker: opts.tinker || {
      listNotesFiles() {
        return Promise.resolve(listedFiles);
      },
      writeNotesFile(rootDir, relPath, text) {
        written.push({ rootDir, relPath, text });
        return Promise.resolve(true);
      },
      pickNotesFolder: opts.pickNotesFolder,
      isDesktopApp: !!opts.desktop,
    },
    location: { assign() {} },
    fetch() {
      return Promise.resolve({
        status: 200,
        ok: true,
        json() {
          return Promise.resolve({ reflections });
        },
      });
    },
  };
  if (opts.pickNotesFolder) {
    windowObj.tinker.pickNotesFolder = opts.pickNotesFolder;
  }

  const sandbox = {
    window: windowObj,
    document,
    console,
    Blob: class Blob {
      constructor(parts) { this.parts = parts; }
    },
    URL: {
      createObjectURL() { return "blob:test"; },
      revokeObjectURL() {},
    },
    Uint8Array,
    setTimeout,
    setImmediate,
    Promise,
    self: undefined,
    fetch: windowObj.fetch.bind(windowObj),
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  // UMD attaches to the context global (this), not window.
  vm.runInContext(storiesSrc, context);
  windowObj.tinkerStoriesMd = context.tinkerStoriesMd || sandbox.tinkerStoriesMd;
  assert.ok(windowObj.tinkerStoriesMd, "stories-md helpers must load");
  vm.runInContext(page, context);

  return {
    byId,
    storage,
    window: windowObj,
    document,
    written,
    async flush() {
      if (windowObj.tinkerRepo && windowObj.tinkerRepo.ready) {
        await windowObj.tinkerRepo.ready;
      }
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
    click(id) {
      byId[id].dispatch("click", {
        type: "click",
        target: byId[id],
        preventDefault() {},
        stopPropagation() {},
      });
    },
    findStoryButton(fileName) {
      function walk(node) {
        if (!node) return null;
        if (
          node.className &&
          String(node.className).includes("repo-tree__piece") &&
          node.textContent === fileName
        ) {
          return node;
        }
        for (const child of node.children || []) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      }
      return walk(byId["repo-tree"]);
    },
  };
}

test("repo page lists stories and opens blank Markdown surface", () => {
  assert.match(html, /id="repo-tree"/);
  assert.match(html, /id="repo-body"/);
  assert.match(html, /id="repo-new-piece"/);
  assert.match(html, />New file</);
  assert.match(html, /href="\/\?write=1"/);
  assert.match(html, />Write</);
  assert.match(html, /Stories/);
  assert.match(html, /Tinker location/);
  assert.match(html, /id="repo-download-one"/);
  assert.match(html, /id="repo-download-all"/);
  assert.match(html, /src="\/lib\/stories-md\.js(\?v=\d+)?"/);
  assert.match(html, /src="\/repo\/repo\.js(\?v=\d+)?"/);
  assert.match(html, /href="\/repo\/repo\.css(\?v=\d+)?"/);
  assert.doesNotMatch(html, /Inbox|← Inbox/);
  assert.doesNotMatch(html, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(page, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(html, /id="repo-body"[^>]*placeholder=/);
  assert.match(html, /<textarea class="writing-input repo-surface__input" id="repo-body" spellcheck="true"><\/textarea>/);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(page.includes("innerHTML"), false);
});

test("repo routes, desktop landing, and auth return include /repo", () => {
  assert.match(vercel, /\/repo\/index\.html/);
  assert.match(vercel, /self-reflections/);
  assert.match(sw, /pathname === "\/repo"/);
  assert.match(settings, /href="\/repo"/);
  assert.match(mainJs, /label:\s*"Stories"/);
  assert.match(mainJs, /\/repo/);
  assert.match(mainJs, /APP_URL[\s\S]*\/repo/);
  assert.match(css, /\.repo-layout/);
  assert.match(css, /\.repo-surface/);
  assert.match(css, /\.repo-location/);
  const auth = fs.readFileSync(path.join(root, "src/renderer/auth.js"), "utf8");
  assert.match(auth, /\/repo/);
});

test("repo loads reflections into stories/ file names with verbatim markdown", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: true });
  await env.flush();
  const stories = env.window.tinkerRepo.getStories();
  assert.equal(stories.length, 2);
  const merchant = stories.find((s) => s.title === "Merchant portal reliability");
  assert.ok(merchant);
  assert.match(merchant.relPath, /^stories\/\d{4}-\d{2}-\d{2}-merchant-portal-reliability\.md$/);
  assert.equal(
    merchant.markdown,
    md.storyMarkdown("Merchant portal reliability", "While managing 10 incidents might sound like a failure")
  );
  assert.equal(env.byId["repo-body"].value, "", "default center is blank");

  const btn = env.findStoryButton(merchant.fileName);
  assert.ok(btn, "expected story file button");
  btn.dispatch("click", { type: "click", target: btn, preventDefault() {}, stopPropagation() {} });
  assert.equal(env.byId["repo-body"].value, merchant.markdown);
  assert.equal(env.byId["repo-file-path"].textContent, merchant.relPath);
});

test("location saves across reload; desktop writes stories without clobbering edits", async () => {
  const when = "2026-10-02T17:33:00.000Z";
  const rel = md.storyRelPath({
    title: "Merchant portal reliability",
    createdAt: when,
  }, new Date(when));
  const desired = md.storyMarkdown(
    "Merchant portal reliability",
    "While managing 10 incidents might sound like a failure"
  );
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    storedLocation: "/Users/tyler/code/tinker",
    listedFiles: [
      { relPath: rel, text: "# Merchant portal reliability\n\nLOCAL EDIT keep me" },
    ],
  });
  await env.flush();
  assert.equal(env.window.tinkerRepo.getLocation(), "/Users/tyler/code/tinker");
  // Differing local merchant file must not be overwritten; other missing files may write.
  assert.equal(env.written.some((w) => w.relPath === rel), false);
  assert.ok(env.written.every((w) => w.relPath.startsWith("stories/")));

  const env2 = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    storedLocation: "/Users/tyler/code/tinker",
    listedFiles: [],
  });
  await env2.flush();
  assert.ok(env2.written.length >= 1);
  assert.ok(env2.written.every((w) => w.relPath.startsWith("stories/")));
  assert.ok(env2.written.some((w) => w.text === desired));
});

test("web offers download controls; new file keeps blank editor", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: false });
  await env.flush();
  assert.equal(env.byId["repo-download-all"].hidden, false);
  env.click("repo-new-piece");
  assert.equal(env.byId["repo-body"].value, "");
  assert.match(env.byId["repo-file-path"].textContent, /^stories\//);
});

test("desktop folder picker is offered when pickNotesFolder exists", async () => {
  let called = false;
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    pickNotesFolder() {
      called = true;
      return Promise.resolve({ path: "/Users/tyler/code/tinker", name: "tinker" });
    },
  });
  await env.flush();
  assert.equal(env.byId["repo-location-choose"].hidden, false);
  env.click("repo-location-btn");
  env.click("repo-location-choose");
  await env.flush();
  assert.equal(called, true);
  assert.equal(env.window.tinkerRepo.getLocation(), "/Users/tyler/code/tinker");
});
