/* /repo — stories as Markdown files + blank writing surface. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const filesHtml = fs.readFileSync(path.join(root, "src/renderer/repo/files/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const page = fs.readFileSync(path.join(root, "src/renderer/repo/repo.js"), "utf8");
const storiesSrc = fs.readFileSync(path.join(root, "src/renderer/lib/stories-md.js"), "utf8");
const foldersSrc = fs.readFileSync(path.join(root, "src/renderer/lib/repo-folders-core.js"), "utf8");
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
    className: "",
    hidden: false,
    disabled: false,
    value: "",
    title: "",
    placeholder: "",
    type: tag === "button" ? "button" : (tag === "input" ? "text" : ""),
    children: [],
    parentNode: null,
    style: {},
    dataset: {},
    firstChild: null,
    _text: "",
    classList: {
      add() {},
      remove() {},
      contains(name) {
        return String(el.className || "").split(/\s+/).includes(String(name));
      },
      toggle() {},
    },
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
      if (name === "aria-label") el["aria-label"] = String(value);
      if (name === "aria-selected") el["aria-selected"] = String(value);
      if (name === "data-story-id") el.dataset = Object.assign(el.dataset || {}, { storyId: String(value) });
      if (name === "data-folder-id") el.dataset = Object.assign(el.dataset || {}, { folderId: String(value) });
      if (name === "data-location-custom") el.dataset = Object.assign(el.dataset || {}, { locationCustom: String(value) });
      if (name === "data-location-storage") el.dataset = Object.assign(el.dataset || {}, { locationStorage: String(value) });
      if (name === "data-open") el.dataset = Object.assign(el.dataset || {}, { open: String(value) });
      if (name === "id") {
        el.id = String(value);
        if (store) store[el.id] = el;
      }
    },
    getAttribute(name) {
      return attrs[name] == null ? null : attrs[name];
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    focus() {},
    select() {},
    scrollIntoView() {},
    contains(node) {
      if (node === el) return true;
      return el.children.some((c) => c === node || (c.contains && c.contains(node)));
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (selector.startsWith("[data-folder-id]") && cur.dataset && cur.dataset.folderId) return cur;
        if (selector.startsWith(".") && String(cur.className || "").split(/\s+/).includes(selector.slice(1))) {
          return cur;
        }
        cur = cur.parentNode;
      }
      return null;
    },
  };
  Object.defineProperty(el, "id", {
    configurable: true,
    enumerable: true,
    get() { return attrs.id || id || ""; },
    set(value) {
      attrs.id = String(value || "");
      if (store && attrs.id) store[attrs.id] = el;
    },
  });
  Object.defineProperty(el, "textContent", {
    configurable: true,
    enumerable: true,
    get() {
      if (el.children && el.children.length) {
        return el.children.map((c) => (c && c.textContent != null ? c.textContent : "")).join("");
      }
      return el._text || "";
    },
    set(value) {
      el._text = value == null ? "" : String(value);
    },
  });
  if (id) {
    attrs.id = id;
    store[id] = el;
  }
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
    "repo-new-folder",
    "repo-body",
    "repo-location",
    "repo-location-btn",
    "repo-location-panel",
    "repo-location-input",
    "repo-location-save",
    "repo-location-choose",
    "repo-location-value",
    "repo-location-list",
    "repo-location-custom",
    "repo-location-error",
    "repo-location-caption",
    "repo-file-path",
    "repo-file-type",
    "repo-file-place",
    "repo-sync-hint",
    "repo-download-one",
    "repo-download-all",
    "repo-saved-in-list",
    "repo-saved-in-custom",
    "repo-saved-in-input",
    "repo-saved-in-error",
    "repo-saved-in-save",
    "repo-move-sheet",
    "repo-move-list",
    "repo-move-cancel",
    "repo-move-backdrop",
    "repo-move-hint",
    "repo-confirm-sheet",
    "repo-confirm-hint",
    "repo-confirm-keep",
    "repo-confirm-delete",
    "repo-confirm-cancel",
    "repo-confirm-backdrop",
  ];
  for (const id of ids) makeEl("div", id, byId);
  byId["repo-body"].tagName = "TEXTAREA";
  byId["repo-location-btn"].tagName = "BUTTON";
  byId["repo-location-btn"].textContent = "";
  byId["repo-location-value"].textContent = "";
  byId["repo-location-panel"].hidden = true;
  byId["repo-location-custom"].hidden = true;
  byId["repo-location-list"].tagName = "UL";
  byId["repo-location-list"].hidden = false;
  byId["repo-location-input"].tagName = "INPUT";
  byId["repo-location-save"].tagName = "BUTTON";
  byId["repo-location-choose"].tagName = "BUTTON";
  byId["repo-location-choose"].hidden = true;
  byId["repo-location-error"].hidden = true;
  byId["repo-location-caption"].textContent = "Location";
  byId["repo-file-place"].hidden = true;
  byId["repo-saved-in-list"].tagName = "UL";
  byId["repo-saved-in-custom"].hidden = true;
  byId["repo-saved-in-input"].tagName = "INPUT";
  byId["repo-saved-in-error"].hidden = true;
  byId["repo-saved-in-save"].tagName = "BUTTON";
  byId["repo-download-one"].tagName = "BUTTON";
  byId["repo-download-one"].hidden = true;
  byId["repo-download-all"].tagName = "BUTTON";
  byId["repo-download-all"].hidden = true;
  byId["repo-new-folder"].tagName = "BUTTON";
  byId["repo-new-piece"].tagName = "BUTTON";
  byId["repo-move-sheet"].hidden = true;
  byId["repo-confirm-sheet"].hidden = true;
  byId["repo-file-type"].hidden = true;
  byId["repo-stories-empty"].hidden = true;
  byId["repo-location"].contains = function (node) {
    function walk(parent) {
      if (node === parent) return true;
      return (parent.children || []).some((c) => walk(c));
    }
    return walk(byId["repo-location"]) ||
      node === byId["repo-location-btn"] ||
      node === byId["repo-location-panel"] ||
      node === byId["repo-location-list"] ||
      node === byId["repo-location-input"] ||
      node === byId["repo-location-save"] ||
      node === byId["repo-location-choose"] ||
      node === byId["repo-location-custom"];
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
  const bodyEl = makeEl("body", "", byId);
  bodyEl.setAttribute("data-repo-mode", opts.mode || "write");
  bodyEl.className = opts.mode === "files" ? "repo-page repo-page--files" : "repo-page repo-page--write";
  const assigned = [];
  const document = {
    body: bodyEl,
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
      useCustomStoragePath: opts.useCustomStoragePath,
      isDesktopApp: !!opts.desktop,
    },
    location: {
      search: opts.search || "",
      href: opts.href || "/repo",
      assign(url) { assigned.push(String(url)); },
      replace(url) { assigned.push(String(url)); },
    },
    fetch(url, init) {
      const href = String(url || "");
      if (href.includes("/api/repo-folders")) {
        if (init && init.method === "POST") {
          const body = JSON.parse(init.body || "{}");
          const tree = opts.folderTree || { folders: [], placements: {} };
          if (href.includes("create_folder")) {
            opts._folderSeq = (opts._folderSeq || 0) + 1;
            const folder = {
              id: "fld_test_" + opts._folderSeq,
              name: body.name,
              parentId: body.parentId || null,
              contentType: body.contentType || "stories",
              createdAt: "2026-10-03T00:00:00.000Z",
              updatedAt: "2026-10-03T00:00:00.000Z",
            };
            if (body.parentId) {
              const parent = (tree.folders || []).find((f) => f.id === body.parentId);
              if (parent) folder.contentType = parent.contentType;
            }
            tree.folders = (tree.folders || []).concat([folder]);
            opts.folderTree = tree;
            if (typeof opts.onCreateFolder === "function") opts.onCreateFolder(body, folder);
            return Promise.resolve({
              status: 200,
              ok: true,
              json() { return Promise.resolve({ folder, tree }); },
            });
          }
          if (href.includes("move_file")) {
            tree.placements = Object.assign({}, tree.placements || {});
            if (body.fileId) tree.placements[body.fileId] = body.folderId || null;
            opts.folderTree = tree;
            if (typeof opts.onMoveFile === "function") opts.onMoveFile(body);
            return Promise.resolve({
              status: 200,
              ok: true,
              json() { return Promise.resolve({ tree }); },
            });
          }
          if (href.includes("set_place")) {
            tree.places = Object.assign({}, tree.places || {});
            if (body.fileId) {
              const place = body.place == null ? "" : String(body.place).trim();
              if (place) tree.places[body.fileId] = place.slice(0, 120);
              else delete tree.places[body.fileId];
            }
            opts.folderTree = tree;
            if (typeof opts.onSetPlace === "function") opts.onSetPlace(body);
            return Promise.resolve({
              status: 200,
              ok: true,
              json() { return Promise.resolve({ tree }); },
            });
          }
          return Promise.resolve({
            status: 200,
            ok: true,
            json() { return Promise.resolve({ tree }); },
          });
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json() {
            return Promise.resolve(opts.folderTree || { folders: [], placements: {}, places: {}, contentTypes: ["stories"] });
          },
        });
      }
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
    URLSearchParams,
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
  vm.runInContext(foldersSrc, context);
  windowObj.tinkerStoriesMd = context.tinkerStoriesMd || sandbox.tinkerStoriesMd;
  windowObj.tinkerRepoFoldersCore = context.tinkerRepoFoldersCore || sandbox.tinkerRepoFoldersCore;
  assert.ok(windowObj.tinkerStoriesMd, "stories-md helpers must load");
  assert.ok(windowObj.tinkerRepoFoldersCore, "repo-folders-core helpers must load");
  vm.runInContext(page, context);

  return {
    byId,
    storage,
    window: windowObj,
    document,
    written,
    assigned,
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

test("repo write page is writing surface + Location place; Files page holds tree + Saved in", () => {
  assert.match(html, /data-repo-mode="write"/);
  assert.match(html, /id="repo-body"/);
  assert.match(html, /id="repo-new-piece"/);
  assert.match(html, /href="\/repo\/files"/);
  assert.match(html, />Files</);
  assert.match(html, /href="\/\?write=1"/);
  assert.match(html, />Home</);
  assert.match(html, /repo-location__globe/);
  assert.match(html, /id="repo-location-caption"[^>]*>Location</);
  assert.match(html, /placeholder="Where are you\?"/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /id="repo-location-list"/);
  assert.match(html, /id="repo-location-value"/);
  assert.match(html, /id="repo-file-place"/);
  assert.match(html, /id="repo-download-one"/);
  assert.match(html, /id="repo-download-all"/);
  assert.doesNotMatch(html, /id="repo-tree"/);
  assert.doesNotMatch(html, /id="repo-new-folder"/);
  assert.doesNotMatch(html, /id="repo-move-sheet"/);
  assert.doesNotMatch(html, /id="repo-saved-in-list"/);
  assert.match(html, /src="\/lib\/stories-md\.js\?v=9"/);
  assert.match(html, /src="\/lib\/repo-folders-core\.js\?v=9"/);
  assert.match(html, /src="\/lib\/storage-path-core\.js\?v=9"/);
  assert.match(html, /src="\/repo\/repo\.js\?v=9"/);
  assert.match(html, /src="\/repo\/storage-section\.js\?v=9"/);
  assert.match(html, /href="\/repo\/repo\.css\?v=9"/);
  assert.match(html, /href="\/styles\.css\?v=9"/);
  assert.doesNotMatch(html, /Inbox|← Inbox/);
  assert.doesNotMatch(html, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(page, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(html, /id="repo-body"[^>]*placeholder=/);
  assert.match(html, /<textarea class="writing-input repo-surface__input" id="repo-body" spellcheck="true"><\/textarea>/);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(page.includes("innerHTML"), false);
  assert.match(page, /registerLocationSection/);
  assert.match(page, /refreshLocation/);
  assert.match(page, /RECENT_PLACES_KEY/);
  assert.match(page, /PLACE_STARTERS/);
  assert.match(page, /set_place/);
  assert.match(css, /\.repo-location__field/);
  assert.match(css, /\.repo-location__globe/);
  assert.match(css, /\.repo-saved-in/);

  assert.match(filesHtml, /data-repo-mode="files"/);
  assert.match(filesHtml, /id="repo-tree"/);
  assert.match(filesHtml, /id="repo-new-folder"/);
  assert.match(filesHtml, />New folder</);
  assert.match(filesHtml, /id="repo-new-piece"/);
  assert.match(filesHtml, />New file</);
  assert.match(filesHtml, /href="\/repo"/);
  assert.match(filesHtml, />Pad</);
  assert.match(filesHtml, /id="repo-move-sheet"/);
  assert.match(filesHtml, /id="repo-saved-in-list"/);
  assert.match(filesHtml, /id="repo-saved-in-custom"/);
  assert.match(filesHtml, /Saved in/);
  assert.match(filesHtml, /Custom location/);
  assert.doesNotMatch(filesHtml, /id="repo-body"/);
  assert.doesNotMatch(filesHtml, /id="repo-location"/);
  assert.match(vercel, /\/repo\/files/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /repo-layout--write/);
  assert.match(css, /repo-layout--files/);
  assert.match(css, /tinker-desktop-traffic-inset/);
});

test("writing-input and /repo surface are invisible (no box)", () => {
  const base = styles.match(/\.writing-input\s*\{[^}]+\}/);
  assert.ok(base, "base .writing-input rule");
  assert.match(base[0], /border:\s*0/);
  assert.match(base[0], /background:\s*transparent/);
  assert.match(base[0], /box-shadow:\s*none/);
  assert.match(base[0], /resize:\s*none/);
  assert.match(styles, /\.writing-input:focus-visible/);
  const repoInput = css.match(/\.repo-surface__input\.writing-input\s*\{[^}]+\}/);
  assert.ok(repoInput, "repo surface writing-input rule");
  assert.match(repoInput[0], /border:\s*0/);
  assert.match(repoInput[0], /background:\s*transparent/);
  assert.match(repoInput[0], /box-shadow:\s*none/);
  assert.match(repoInput[0], /resize:\s*none/);
  assert.match(css, /\.repo-surface__input\.writing-input:focus-visible/);
  assert.doesNotMatch(styles, /\.writing-input--needs-answer\s*\{\s*outline:/);
});

test("repo routes, desktop landing, and auth return include /repo", () => {
  assert.match(vercel, /\/repo\/index\.html/);
  assert.match(vercel, /self-reflections/);
  assert.match(vercel, /repo-folders/);
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
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    search: "?file=self_1",
  });
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
  assert.equal(env.byId["repo-body"].value, merchant.markdown);
  assert.equal(env.byId["repo-file-path"].textContent, merchant.relPath);
});

function seedTypedFolders() {
  return {
    folders: [
      {
        id: "fld_reflections",
        name: "reflections",
        parentId: null,
        contentType: "reflections",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "fld_2026",
        name: "2026",
        parentId: "fld_reflections",
        contentType: "reflections",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "fld_essays",
        name: "essays",
        parentId: null,
        contentType: "drafts",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    placements: {},
  };
}

test("Files page opens a file by navigating to /repo?file=", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "files",
    folderTree: seedTypedFolders(),
  });
  await env.flush();
  const stories = env.window.tinkerRepo.getStories();
  const merchant = stories.find((s) => s.title === "Merchant portal reliability");
  assert.ok(merchant);
  const btn = env.findStoryButton(merchant.fileName);
  assert.ok(btn, "expected story file button on Files page");
  btn.dispatch("click", { type: "click", target: btn, preventDefault() {}, stopPropagation() {} });
  assert.ok(env.assigned.some((url) => url.includes("/repo?file=" + encodeURIComponent(merchant.id))));
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
  const env = bootRepoPage({ token: "jwt-test", desktop: false, mode: "write" });
  await env.flush();
  assert.equal(env.byId["repo-download-all"].hidden, false);
  env.click("repo-new-piece");
  assert.equal(env.byId["repo-body"].value, "");
  assert.match(env.byId["repo-file-path"].textContent, /^stories\//);
});

test("desktop Mac folder picker in Files Saved in sets getLocation()", async () => {
  let called = false;
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "files",
    pickNotesFolder() {
      called = true;
      return Promise.resolve({ path: "/Users/tyler/code/tinker", name: "tinker" });
    },
  });
  await env.flush();
  const mac = (env.byId["repo-saved-in-list"].children || []).find((row) =>
    String(row.getAttribute("data-location-storage") || "") === "mac-folder" ||
    String(row.textContent || "").includes("Mac folder")
  );
  assert.ok(mac, "Saved in should list Mac folder when pickNotesFolder exists");
  mac.dispatch("click", {
    type: "click",
    target: mac,
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  assert.equal(called, true);
  assert.equal(env.window.tinkerRepo.getLocation(), "/Users/tyler/code/tinker");
  assert.equal(env.byId["repo-location-choose"].hidden, true);
});

test("New folder inline create appears and posts to API", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: true, mode: "files" });
  await env.flush();
  env.click("repo-new-folder");
  const input = env.document.getElementById("repo-folder-create-name");
  assert.ok(input, "inline name field");
  input.value = "Career";
  const type = env.document.getElementById("repo-folder-create-type");
  assert.ok(type);
  assert.equal(type.value, "stories");
  input.dispatch("keydown", {
    type: "keydown",
    key: "Enter",
    target: input,
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  const folders = env.window.tinkerRepo.getFolders();
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, "Career");
  assert.equal(folders[0].contentType, "stories");
});

test("Location place combobox lists starters and commits a place for a draft", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
  });
  await env.flush();
  env.click("repo-new-piece");
  env.click("repo-location-btn");
  assert.equal(env.byId["repo-location-panel"].hidden, false);
  const labels = (env.byId["repo-location-list"].children || []).map((row) => row.textContent);
  assert.ok(labels.some((t) => t.includes("Home")));
  assert.ok(labels.some((t) => t.includes("Coffee shop")));
  assert.ok(labels.some((t) => t.includes("San Diego")));
  assert.ok(labels.every((t) => !t.includes("Mac folder")));
  assert.ok(labels.every((t) => !t.includes("Custom location") && !t.includes("Custom path")));
  const home = (env.byId["repo-location-list"].children || []).find((row) =>
    String(row.textContent || "").includes("Home")
  );
  assert.ok(home);
  home.dispatch("click", {
    type: "click",
    target: home,
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  assert.equal(env.window.tinkerRepo.getPlace(), "Home");
  assert.equal(env.byId["repo-location-input"].value, "Home");
  assert.equal(env.byId["repo-file-place"].hidden, false);
  assert.match(env.byId["repo-file-place"].textContent, /Home/);
});

test("choosing a place on a saved file posts set_place", async () => {
  const places = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    search: "?file=self_1",
    onSetPlace(body) { places.push(body); },
  });
  await env.flush();
  env.click("repo-location-btn");
  const cafe = (env.byId["repo-location-list"].children || []).find((row) =>
    String(row.textContent || "").includes("Coffee shop")
  );
  assert.ok(cafe);
  cafe.dispatch("click", {
    type: "click",
    target: cafe,
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(places.length, 1);
  assert.equal(places[0].fileId, "self_1");
  assert.equal(places[0].place, "Coffee shop");
  assert.equal(env.window.tinkerRepo.getPlace(), "Coffee shop");
});

test("typed place commits with Enter and Escape closes the panel", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: true, mode: "write" });
  await env.flush();
  env.click("repo-new-piece");
  env.click("repo-location-btn");
  assert.equal(env.byId["repo-location-panel"].hidden, false);
  env.document.activeElement = env.byId["repo-location-input"];
  env.byId["repo-location-input"].value = "Library";
  env.byId["repo-location-input"].dispatch("input", {
    type: "input",
    target: env.byId["repo-location-input"],
  });
  const useRow = (env.byId["repo-location-list"].children || []).find((row) =>
    String(row.textContent || "").includes("Library")
  );
  assert.ok(useRow);
  env.byId["repo-location-input"].dispatch("keydown", {
    type: "keydown",
    key: "Enter",
    target: env.byId["repo-location-input"],
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  assert.equal(env.window.tinkerRepo.getPlace(), "Library");
  env.click("repo-location-btn");
  assert.equal(env.byId["repo-location-panel"].hidden, false);
  env.byId["repo-location-list"].dispatch("keydown", {
    type: "keydown",
    key: "Escape",
    target: env.byId["repo-location-list"],
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(env.byId["repo-location-panel"].hidden, true);
});

test("registerLocationSection adds a Saved in option that fires onSelect", async () => {
  let selected = null;
  const env = bootRepoPage({ token: "jwt-test", desktop: true, mode: "files" });
  await env.flush();
  env.window.tinkerRepo.registerLocationSection({
    key: "storage",
    label: "",
    order: 100,
    getOptions() {
      return [{ id: "icloud", label: "iCloud Drive", badge: "Soon" }];
    },
    onSelect(option) {
      selected = option;
    },
  });
  env.window.tinkerRepo.refreshLocation();
  const icloud = (env.byId["repo-saved-in-list"].children || []).find((row) =>
    String(row.getAttribute("data-location-storage") || "") === "icloud" ||
    String(row.textContent || "").includes("iCloud Drive")
  );
  assert.ok(icloud, "registered Saved in option should render");
  icloud.dispatch("click", {
    type: "click",
    target: icloud,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.ok(selected);
  assert.equal(selected.id, "icloud");
});
