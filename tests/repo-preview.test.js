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
const platformSrc = fs.readFileSync(path.join(root, "src/renderer/platform-mobile.js"), "utf8");
const storiesSrc = fs.readFileSync(path.join(root, "src/renderer/lib/stories-md.js"), "utf8");
const foldersSrc = fs.readFileSync(path.join(root, "src/renderer/lib/repo-folders-core.js"), "utf8");
const padRevealSrc = fs.readFileSync(path.join(root, "src/renderer/lib/repo-pad-reveal.js"), "utf8");
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
    style: { height: "" },
    dataset: {},
    firstChild: null,
    nodeType: 1,
    _text: "",
    get childNodes() { return el.children; },
    classList: {
      add(name) {
        const parts = String(el.className || "").split(/\s+/).filter(Boolean);
        if (!parts.includes(String(name))) parts.push(String(name));
        el.className = parts.join(" ");
      },
      remove(name) {
        el.className = String(el.className || "")
          .split(/\s+/)
          .filter((part) => part && part !== String(name))
          .join(" ");
      },
      contains(name) {
        return String(el.className || "").split(/\s+/).includes(String(name));
      },
      toggle(name) {
        if (el.classList.contains(name)) el.classList.remove(name);
        else el.classList.add(name);
      },
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
    focus() {
      if (store && store.__document) store.__document.activeElement = el;
    },
    select() {},
    scrollIntoView() {},
    setSelectionRange(start, end) {
      el.selectionStart = start;
      el.selectionEnd = end;
    },
    contains(node) {
      if (node === el) return true;
      return el.children.some((c) => c === node || (c.contains && c.contains(node)));
    },
    querySelector(selector) {
      const all = el.querySelectorAll(selector);
      return all[0] || null;
    },
    querySelectorAll(selector) {
      const out = [];
      function match(node) {
        if (!node || node.nodeType === 3) return;
        const cls = String(node.className || "").split(/\s+/);
        if (selector === "textarea.repo-pad__turn") {
          if (node.tagName === "TEXTAREA" && cls.includes("repo-pad__turn")) out.push(node);
        } else if (selector === "[data-pad-q='1']") {
          if (node.getAttribute && node.getAttribute("data-pad-q") === "1") out.push(node);
        } else if (selector.startsWith(".")) {
          if (cls.includes(selector.slice(1))) out.push(node);
        }
        for (const child of node.children || []) match(child);
      }
      match(el);
      return out;
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        const sels = String(selector || "").split(",").map((s) => s.trim()).filter(Boolean);
        for (const sel of sels) {
          if (sel.startsWith("#") && cur.id === sel.slice(1)) return cur;
          if (sel.startsWith("[data-folder-id]") && cur.dataset && cur.dataset.folderId) return cur;
          if (sel.startsWith(".") && String(cur.className || "").split(/\s+/).includes(sel.slice(1))) {
            return cur;
          }
          if (sel === "textarea.repo-pad__turn") {
            const cls = String(cur.className || "").split(/\s+/);
            if (cur.tagName === "TEXTAREA" && cls.includes("repo-pad__turn")) return cur;
          }
          if (/^(a|button|input|select|label)$/i.test(sel) && cur.tagName === sel.toUpperCase()) {
            return cur;
          }
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
    "repo-sidebar-new-piece",
    "repo-new-folder",
    "repo-body",
    "repo-surface",
    "repo-pad",
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
    "repo-followup",
    "repo-pad-error",
    "repo-pad-error-text",
    "repo-pad-error-retry",
    "repo-pad-error-signin",
    "repo-pad-actions",
    "repo-keep-crafting",
    "repo-keep-crafting-kbd",
    "repo-this-is-everything",
    "repo-file-path",
    "repo-file-type",
    "repo-file-place",
    "repo-sync-hint",
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
  // Write page no longer has top-right account / download chrome; Files still does.
  if (opts.mode === "files") {
    ids.push(
      "repo-signin",
      "repo-account",
      "repo-account-label",
      "repo-signout",
    );
  }
  for (const id of ids) makeEl("div", id, byId);
  byId["repo-body"].tagName = "TEXTAREA";
  byId["repo-surface"].tagName = "DIV";
  byId["repo-surface"].className = "repo-surface writing";
  byId["repo-surface"].nodeType = 1;
  byId["repo-pad"].tagName = "DIV";
  byId["repo-pad"].className = "repo-pad";
  byId["repo-pad"].nodeType = 1;
  byId["repo-surface"].appendChild(byId["repo-location"]);
  byId["repo-surface"].appendChild(byId["repo-pad"]);
  byId["repo-surface"].appendChild(byId["repo-pad-actions"]);
  byId["repo-location"].appendChild(byId["repo-location-btn"]);
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
  byId["repo-followup"].hidden = true;
  byId["repo-pad-error"].hidden = true;
  byId["repo-pad-error"].tagName = "DIV";
  byId["repo-pad-error-text"].tagName = "P";
  byId["repo-pad-error-retry"].tagName = "BUTTON";
  byId["repo-pad-error-retry"].textContent = "Retry";
  byId["repo-pad-error-retry"].hidden = true;
  byId["repo-pad-error-signin"].tagName = "BUTTON";
  byId["repo-pad-error-signin"].textContent = "Sign in";
  byId["repo-pad-error-signin"].hidden = true;
  byId["repo-pad-actions"].tagName = "FOOTER";
  byId["repo-pad-actions"].className = "repo-surface__foot";
  byId["repo-keep-crafting"].tagName = "BUTTON";
  byId["repo-keep-crafting"].textContent = "Keep crafting";
  byId["repo-keep-crafting"].tabIndex = -1;
  byId["repo-keep-crafting"].setAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
  byId["repo-keep-crafting-kbd"].tagName = "SPAN";
  byId["repo-keep-crafting-kbd"].className = "repo-surface__kbd";
  byId["repo-keep-crafting-kbd"].textContent = "⌘↵";
  byId["repo-keep-crafting-kbd"].setAttribute("aria-hidden", "true");
  byId["repo-keep-crafting"].appendChild(byId["repo-keep-crafting-kbd"]);
  byId["repo-this-is-everything"].tagName = "BUTTON";
  byId["repo-this-is-everything"].textContent = "This is everything";
  byId["repo-this-is-everything"].disabled = true;
  byId["repo-this-is-everything"].tabIndex = -1;
  byId["repo-body"].scrollTop = 0;
  byId["repo-body"].selectionStart = 0;
  byId["repo-body"].selectionEnd = 0;
  byId["repo-body"].setSelectionRange = function (start, end) {
    byId["repo-body"].selectionStart = start;
    byId["repo-body"].selectionEnd = end;
  };
  byId["repo-file-place"].hidden = true;
  byId["repo-saved-in-list"].tagName = "UL";
  byId["repo-saved-in-custom"].hidden = true;
  byId["repo-saved-in-input"].tagName = "INPUT";
  byId["repo-saved-in-error"].hidden = true;
  byId["repo-saved-in-save"].tagName = "BUTTON";
  if (byId["repo-signin"]) {
    byId["repo-signin"].tagName = "A";
    byId["repo-signin"].textContent = "Sign in";
    byId["repo-signin"].href = "/?signin=1";
    byId["repo-signin"].hidden = false;
    byId["repo-account"].tagName = "DIV";
    byId["repo-account"].hidden = true;
    byId["repo-account-label"].tagName = "SPAN";
    byId["repo-account-label"].textContent = "Signed in";
    byId["repo-signout"].tagName = "BUTTON";
    byId["repo-signout"].textContent = "Sign out";
  }
  byId["repo-new-folder"].tagName = "BUTTON";
  byId["repo-new-piece"].tagName = "BUTTON";
  byId["repo-sidebar-new-piece"].tagName = "BUTTON";
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
  const session = new Map();
  if (opts.storedLocation) storage.set("tinker.repo.location.v1", opts.storedLocation);
  if (opts.token) storage.set("tinker_jwt", opts.token);
  if (opts.phone) storage.set("tinker_phone", opts.phone);
  if (opts.sessionDraft) session.set("tinker.repo.padDraft.v1", opts.sessionDraft);

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
  const htmlEl = makeEl("html", "", byId);
  htmlEl.style = htmlEl.style || {};
  const cssVars = {};
  htmlEl.style.setProperty = function (name, value) {
    cssVars[String(name)] = String(value);
  };
  htmlEl.style.getPropertyValue = function (name) {
    return cssVars[String(name)] || "";
  };
  const document = {
    body: bodyEl,
    documentElement: htmlEl,
    activeElement: null,
    getElementById(id) {
      return byId[id] || null;
    },
    createElement(tag) {
      const el = makeEl(tag, "", byId);
      el.nodeType = 1;
      if (String(tag).toLowerCase() === "textarea") el.tagName = "TEXTAREA";
      return el;
    },
    addEventListener(type, fn) {
      (docListeners[type] || (docListeners[type] = [])).push(fn);
    },
  };
  byId.__document = document;

  const windowObj = {
    navigator: opts.navigator || {
      platform: opts.platform || "MacIntel",
      userAgent: opts.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    },
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
      getItem(key) {
        return session.has(key) ? session.get(key) : null;
      },
      setItem(key, value) {
        session.set(key, String(value));
      },
      removeItem(key) {
        session.delete(key);
      },
    },
    location: {
      pathname: opts.pathname || (opts.mode === "files" ? "/repo/files" : "/repo"),
      search: opts.search || "",
      href: opts.href || (opts.mode === "files" ? "/repo/files" : "/repo"),
      assign(url) { assigned.push(String(url)); },
      replace(url) { assigned.push(String(url)); },
    },
    innerHeight: opts.innerHeight || 844,
    visualViewport: opts.visualViewport || {
      height: opts.vvHeight != null ? opts.vvHeight : 844,
      offsetTop: opts.vvOffsetTop != null ? opts.vvOffsetTop : 0,
      addEventListener() {},
    },
    scrollTo() {},
    scrollY: 0,
    fetch(url, init) {
      const href = String(url || "");
      if (href.includes("/api/user-data/essays")) {
        if (init && init.method === "PUT") {
          const body = JSON.parse(init.body || "{}");
          opts._essays = Array.isArray(body.data) ? body.data : [];
          if (typeof opts.onPutEssays === "function") opts.onPutEssays(opts._essays);
          if (opts.failPutEssays) {
            return Promise.resolve({
              status: opts.putEssaysStatus || 500,
              ok: false,
              json() { return Promise.resolve({ error: "fail" }); },
            });
          }
          return Promise.resolve({
            status: 200,
            ok: true,
            json() { return Promise.resolve({ ok: true }); },
          });
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json() {
            return Promise.resolve({ data: opts._essays || opts.essays || [] });
          },
        });
      }
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

  windowObj.tinkerInterview = opts.tinkerInterview || {
    KEEP_CRAFTING_MODEL: "test-model",
    buildFollowupRequest(args) {
      if (typeof opts.onBuildFollowup === "function") opts.onBuildFollowup(args);
      if (!args || !String(args.draft || "").trim()) return { error: "Pass a draft." };
      return { mode: "freeform", system: "sys", user: "user:" + args.draft };
    },
    parseFreeformResponse(text) {
      try {
        const parsed = JSON.parse(String(text || "{}"));
        return { questions: Array.isArray(parsed.questions) ? parsed.questions : [] };
      } catch {
        return { questions: [] };
      }
    },
    fallbackKeepCraftingQuestion() {
      return "What else are you learning about this?";
    },
  };

  function defaultCallClaude(payload) {
    if (typeof opts.onCallClaude === "function") opts.onCallClaude(payload);
    if (typeof opts.callClaude === "function") return opts.callClaude(payload);
    return Promise.resolve({
      text: JSON.stringify({ questions: ["What are you noticing about this?"] }),
    });
  }

  if (opts.frozenPreload) {
    // Simulate Electron contextBridge.exposeInMainWorld("tinker", …):
    // frozen API object + non-writable window.tinker without callClaude.
    const preloadApi = Object.assign(
      {
        listNotesFiles() {
          return Promise.resolve(listedFiles);
        },
        writeNotesFile(rootDir, relPath, text) {
          written.push({ rootDir, relPath, text });
          return Promise.resolve(true);
        },
        pickNotesFolder: opts.pickNotesFolder,
        useCustomStoragePath: opts.useCustomStoragePath,
        isDesktopApp: true,
        supportsWebview: true,
      },
      typeof opts.frozenPreload === "object" ? opts.frozenPreload : {},
      opts.tinker && typeof opts.tinker === "object" ? opts.tinker : {}
    );
    delete preloadApi.callClaude;
    const frozen = Object.freeze(preloadApi);
    Object.defineProperty(windowObj, "tinker", {
      value: frozen,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } else {
    windowObj.tinker = opts.tinker || {
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
      callClaude: defaultCallClaude,
    };
    if (opts.pickNotesFolder) {
      windowObj.tinker.pickNotesFolder = opts.pickNotesFolder;
    }
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
    clearTimeout,
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
  vm.runInContext(padRevealSrc, context);
  windowObj.tinkerStoriesMd = context.tinkerStoriesMd || sandbox.tinkerStoriesMd;
  windowObj.tinkerRepoFoldersCore = context.tinkerRepoFoldersCore || sandbox.tinkerRepoFoldersCore;
  windowObj.tinkerRepoPadReveal = context.tinkerRepoPadReveal || sandbox.tinkerRepoPadReveal;
  // Interview helpers are injected on window for pad Keep crafting.
  context.tinkerInterview = windowObj.tinkerInterview;
  assert.ok(windowObj.tinkerStoriesMd, "stories-md helpers must load");
  assert.ok(windowObj.tinkerRepoFoldersCore, "repo-folders-core helpers must load");
  assert.ok(windowObj.tinkerRepoPadReveal, "repo-pad-reveal helpers must load");

  if (opts.frozenPreload) {
    // Same order as /repo/index.html: platform-mobile before repo.js.
    vm.runInContext(platformSrc, context);
    assert.equal(
      typeof windowObj.tinker.callClaude,
      "undefined",
      "frozen preload tinker must stay without callClaude"
    );
    assert.equal(
      typeof windowObj.tinkerApi.callClaude,
      "function",
      "platform-mobile must install writable tinkerApi.callClaude"
    );
    // Use the test mock instead of the real converse fetch.
    windowObj.tinkerApi.callClaude = defaultCallClaude;
  }

  vm.runInContext(page, context);

  return {
    byId,
    storage,
    session,
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
    findStoryButton(label) {
      function walk(node) {
        if (!node) return null;
        if (
          node.className &&
          String(node.className).includes("repo-tree__piece") &&
          node.textContent === label
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

test("repo write page is writing surface + Location place + structure sidebar", () => {
  assert.match(html, /data-repo-mode="write"/);
  assert.match(html, /id="repo-body"/);
  assert.match(html, /<title>tinker<\/title>/);
  // No visible Files pill, New file, or on-screen tinker wordmark.
  assert.doesNotMatch(html, /id="repo-files-link"/);
  assert.doesNotMatch(html, /<header[\s\S]*?>Files</);
  assert.doesNotMatch(html, /class="repo-tree__new"[^>]*>New file</);
  assert.doesNotMatch(html, /class="repo-top__action"[^>]*>New file</);
  assert.doesNotMatch(html, /class="repo-top__name"/);
  assert.doesNotMatch(html, /repo-top__back/);
  assert.doesNotMatch(html, /href="\/\?write=1"/);
  assert.doesNotMatch(html, />Home</);
  assert.match(html, /id="repo-name"[^>]*hidden[^>]*>tinker</);
  assert.match(html, /repo-location__globe/);
  assert.match(html, /icons\/tinker-mark\.svg\?v=28/);
  assert.match(html, /id="repo-location-caption"[^>]*>Location</);
  assert.match(html, /placeholder="Where are you\?"/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /id="repo-location-list"/);
  assert.match(html, /id="repo-location-value"/);
  assert.match(html, /id="repo-file-place"/);
  assert.doesNotMatch(html, /id="repo-download-one"/);
  assert.doesNotMatch(html, /id="repo-download-all"/);
  assert.doesNotMatch(html, /Download all/);
  assert.doesNotMatch(html, /id="repo-signin"/);
  assert.doesNotMatch(html, /id="repo-account"/);
  assert.doesNotMatch(html, /id="repo-signout"/);
  assert.doesNotMatch(html, /repo-top--auth/);
  assert.doesNotMatch(html, /<header[\s\S]*?<\/header>/);
  assert.match(html, /id="repo-keep-crafting"/);
  assert.match(html, /id="repo-this-is-everything"/);
  assert.match(html, /Keep crafting/);
  assert.match(html, />This is everything</);
  assert.match(html, /aria-keyshortcuts="Meta\+Enter Control\+Enter"/);
  assert.match(html, /id="repo-keep-crafting-kbd"/);
  assert.match(html, /repo-surface__kbd/);
  assert.match(html, /⌘↵|Ctrl↵/);
  assert.match(html, /id="repo-pad"/);
  assert.match(html, /repo-pad__mirror/);
  assert.doesNotMatch(html, />Write</);
  assert.match(html, /id="repo-surface"[\s\S]*id="repo-location"/);
  // Action bar lives inside the writing surface (sticky bottom-right).
  assert.match(html, /id="repo-pad-actions"/);
  const surfaceChunk = (html.match(/id="repo-surface"[\s\S]*?<\/div>\s*<\/main>/) || [""])[0];
  assert.match(surfaceChunk, /id="repo-pad-actions"/);
  assert.match(surfaceChunk, /id="repo-keep-crafting"/);
  assert.match(surfaceChunk, /id="repo-location"/);
  // Write page has no top-right account / Sign out / Download chrome.
  assert.doesNotMatch(html, /id="repo-account-label"/);
  assert.doesNotMatch(html, />Sign out</);
  // Desktop structure sidebar; Saved in stays on Files. Mobile: desktop-only.
  assert.match(html, /id="repo-tree"/);
  assert.match(html, /id="repo-new-folder"/);
  assert.match(html, /id="repo-move-sheet"/);
  assert.match(html, /class="repo-right"/);
  assert.doesNotMatch(html, /id="repo-saved-in-list"/);
  assert.match(html, /src="\/lib\/stories-md\.js\?v=28"/);
  assert.match(html, /src="\/lib\/repo-folders-core\.js\?v=28"/);
  assert.match(html, /src="\/lib\/repo-pad-reveal\.js\?v=28"/);
  assert.match(html, /src="\/lib\/storage-path-core\.js\?v=28"/);
  assert.match(html, /src="\/repo\/repo\.js\?v=28"/);
  assert.match(html, /src="\/repo\/storage-section\.js\?v=28"/);
  assert.match(html, /src="\/platform-mobile\.js\?v=28"/);
  assert.match(html, /src="\/interview-prompt\.js\?v=28"/);
  assert.match(html, /href="\/repo\/repo\.css\?v=28"/);
  assert.match(html, /href="\/styles\.css\?v=28"/);
  assert.doesNotMatch(html, /Inbox|← Inbox/);
  assert.doesNotMatch(html, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(page, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(html, /id="repo-body"[^>]*placeholder=/);
  assert.match(html, /id="repo-body"/);
  assert.match(html, /class="repo-pad__mirror"/);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(page.includes("innerHTML"), false);
  assert.match(page, /registerLocationSection/);
  assert.match(page, /refreshLocation/);
  assert.match(page, /RECENT_PLACES_KEY/);
  assert.match(page, /PLACE_STARTERS/);
  assert.match(page, /set_place/);
  assert.match(page, /displayTitle/);
  assert.match(css, /\.repo-location__field/);
  assert.match(css, /\.repo-location__globe/);
  assert.match(css, /\.repo-location\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.repo-location\s*\{[^}]*align-self:\s*center/s);
  assert.match(css, /\.repo-pad\s*\{/);
  assert.match(css, /\.repo-pad__q\s*\{/);
  assert.match(css, /\.repo-pad__mirror/);
  assert.match(css, /body\.repo-page--write\s+\.repo-center\s*\{[^}]*background:\s*transparent/s);
  assert.doesNotMatch(css, /min-height:\s*42vh/);
  // Desktop (≥768px): fixed to the viewport with floor max(48px, 8vh|8dvh).
  // Phone (≤767px): #453 — 12px + safe-area + keyboard inset.
  assert.match(css, /\.repo-surface__foot\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /--repo-foot-floor:\s*max\(\s*48px,\s*8vh\s*\)/);
  assert.match(css, /--repo-foot-floor:\s*max\(\s*48px,\s*8dvh\s*\)/);
  assert.match(
    css,
    /\.repo-surface__foot\s*\{[^}]*bottom:\s*calc\(\s*var\(--repo-foot-floor\)\s*\+\s*env\(safe-area-inset-bottom/s,
  );
  assert.match(css, /\.repo-surface\.writing\s+\.repo-pad\s*\{[^}]*--repo-foot-floor/s);
  assert.match(
    css,
    /@media\s*\(max-width:\s*767px\)[\s\S]*--repo-foot-floor:\s*12px[\s\S]*\.repo-surface__foot\s*\{[^}]*12px \+ env\(safe-area-inset-bottom/s,
  );
  assert.match(css, /\.repo-surface__foot/);
  assert.match(css, /\.repo-surface__foot\.is-visible/);
  assert.match(css, /\.repo-surface__kbd/);
  assert.match(css, /\.repo-surface__kbd\s*\{[^}]*display:\s*none/s);
  assert.match(
    css,
    /@media\s*\(\s*hover:\s*hover\s*\)\s*and\s*\(\s*pointer:\s*fine\s*\)\s*\{[\s\S]*\.repo-surface__kbd\s*\{[^}]*display:\s*inline/s,
  );
  assert.match(css, /transition:\s*opacity\s*200ms/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /100dvh/);
  assert.match(css, /100svh/);
  assert.match(css, /-webkit-fill-available/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /--repo-keyboard-inset/);
  assert.match(css, /\.repo-layout--write\s+\.repo-right\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.repo-layout--write\s+\.repo-right\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.repo-layout--write\s+\.repo-right\s+\.repo-tree__body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.repo-layout--write\s+\.repo-right\s+\.repo-changes\s*\{[^}]*flex-shrink:\s*0/s);
  assert.match(css, /\.repo-layout--write\s+\.repo-right/);
  assert.match(css, /body\.repo-page--write\s+\.repo-right\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.repo-saved-in/);
  // Files page still uses auth header; write page has none.
  assert.match(filesHtml, /repo-top--auth/);
  assert.match(html, /viewport-fit=cover/);
  // Location picker centered in the editor column with safe-area top.
  assert.match(css, /\.repo-location\s*\{[^}]*align-self:\s*center/s);
  assert.match(css, /\.repo-location\s*\{[^}]*margin-left:\s*auto/s);
  assert.match(css, /\.repo-location\s*\{[^}]*margin-right:\s*auto/s);
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)[\s\S]*\.repo-layout--write[\s\S]*align-items:\s*stretch/,
  );
  assert.match(css, /\.repo-location\s*\{[^}]*top:\s*calc\(\s*12px \+ env\(safe-area-inset-top/s);
  assert.match(
    css,
    /@media\s*\(min-width:\s*801px\)[\s\S]*\.repo-location\s*\{[^}]*top:\s*calc\(\s*56px \+ env\(safe-area-inset-top/s,
  );
  assert.match(
    css,
    /@media\s*\(min-width:\s*801px\)[\s\S]*\.repo-location\s*\{[^}]*margin-top:\s*44px/s,
  );
  assert.match(css, /\.repo-surface\.writing\s*\{[^}]*safe-area-inset-top/s);
  // Phones: clear breathing room under the notch (safe-area + ~40–56px).
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)[\s\S]*\.repo-location\s*\{[^}]*top:\s*calc\(\s*48px \+ env\(safe-area-inset-top/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*430px\)[\s\S]*\.repo-location\s*\{[^}]*top:\s*calc\(\s*48px \+ env\(safe-area-inset-top/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)[\s\S]*\.repo-surface\.writing\s*\{[^}]*padding:\s*calc\(\s*48px \+ env\(safe-area-inset-top/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*430px\)[\s\S]*\.repo-surface\.writing\s*\{[^}]*padding:\s*calc\(\s*48px \+ env\(safe-area-inset-top/s,
  );
  assert.match(page, /visualViewport/);
  assert.match(page, /--repo-keyboard-inset/);
  assert.match(page, /onBlankPadActivate|focusLastPadTurn/);

  assert.match(filesHtml, /data-repo-mode="files"/);
  assert.match(filesHtml, /id="repo-tree"/);
  assert.match(filesHtml, /id="repo-new-folder"/);
  assert.match(filesHtml, />New folder</);
  assert.match(filesHtml, /id="repo-new-piece"/);
  assert.doesNotMatch(filesHtml, /class="repo-tree__new"[^>]*>New file</);
  assert.match(filesHtml, /href="\/repo"/);
  assert.match(filesHtml, />Pad</);
  assert.match(filesHtml, /id="repo-signin"/);
  assert.match(filesHtml, /href="\/\?signin=1"/);
  assert.match(filesHtml, />Sign in</);
  assert.match(filesHtml, /id="repo-account"/);
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

/** Desktop foot floor: max(48px, 8vh). Used by UI-contract + screenshot gates. */
function repoFootFloorPx(viewportHeight) {
  return Math.max(48, Math.round(0.08 * viewportHeight));
}

/** Desktop essays rail + foot gutter — mirrors --repo-essays-rail / --repo-foot-gutter. */
function repoFootSidebarGeometry(viewportWidth, viewportHeight, footWidthPx = 280) {
  const sidebarHidden = viewportWidth <= 800;
  const rail = sidebarHidden ? 0 : 320;
  const gutter = sidebarHidden ? 12 : 24;
  const rightInset = rail + gutter;
  const footRight = viewportWidth - rightInset;
  const footLeft = footRight - footWidthPx;
  const sidebarLeft = sidebarHidden ? null : viewportWidth - rail;
  const sidebarRight = sidebarHidden ? null : viewportWidth;
  const intersects =
    !sidebarHidden &&
    footRight > sidebarLeft &&
    footLeft < sidebarRight;
  const clearancePx = sidebarHidden ? null : sidebarLeft - footRight;
  return {
    viewportWidth,
    viewportHeight,
    sidebarVisible: !sidebarHidden,
    rail,
    gutter,
    rightInset,
    footLeft,
    footRight,
    sidebarLeft,
    sidebarRight,
    clearancePx,
    intersects,
    floorPx: repoFootFloorPx(viewportHeight),
  };
}

test("UI-contract: desktop Keep crafting pill bottom offset is max(48px, 8vh)", () => {
  // Computed floor at the viewports Tyler reported (and Electron content area).
  assert.equal(repoFootFloorPx(900), 72, "1440x900 → 8vh = 72px");
  assert.equal(repoFootFloorPx(600), 48, "1024x600 → max(48, 48) = 48px");
  assert.equal(repoFootFloorPx(820), 66, "Electron default ~820h → 66px");
  assert.ok(repoFootFloorPx(900) >= 48);
  assert.ok(repoFootFloorPx(600) >= 48);

  // CSS must encode that floor on desktop and keep phone (#453) separate.
  assert.match(css, /--repo-foot-floor:\s*max\(\s*48px,\s*8vh\s*\)/);
  assert.match(css, /--repo-foot-floor:\s*max\(\s*48px,\s*8dvh\s*\)/);
  assert.match(css, /\.repo-surface__foot\s*\{[^}]*position:\s*fixed/s);
  assert.match(
    css,
    /\.repo-surface__foot\s*\{[^}]*bottom:\s*calc\(\s*var\(--repo-foot-floor\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\s*\)/s,
  );
  // Editor scroll area clears the fixed pill (floor + pill height).
  assert.match(
    css,
    /\.repo-surface\.writing\s+\.repo-pad\s*\{[^}]*padding-bottom:\s*calc\(\s*var\(--repo-foot-floor(?:,\s*max\(\s*48px,\s*8vh\s*\))?\s*\)\s*\+\s*56px\s*\)/s,
  );
  assert.match(
    css,
    /\.repo-surface\.writing\s*\{[^}]*padding-bottom:\s*calc\(\s*var\(--repo-foot-floor(?:,\s*max\(\s*48px,\s*8vh\s*\))?\s*\)\s*\+\s*72px/s,
  );
  // Write-mode ancestors must not clip a fixed foot (overflow visible / page scroll).
  assert.match(css, /body\.repo-page--write\s+\.repo-center\s*\{[^}]*overflow:\s*visible/s);
  assert.match(css, /\.repo-layout--write\s*\{[^}]*overflow:\s*visible/s);
  assert.match(css, /\.repo-surface\.writing\s*\{[^}]*overflow:\s*visible/s);
  // Phone keeps the tight #453 floor (not the desktop raise).
  assert.match(css, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*--repo-foot-floor:\s*12px/);
  assert.doesNotMatch(css, /\.repo-surface__foot\s*\{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(css, /\.repo-surface__foot\s*\{[^}]*bottom:\s*calc\(\s*40px/s);
});

test("UI-contract: desktop action pill never intersects essays sidebar", () => {
  // Shared rail token: grid track + fixed foot right offset.
  assert.match(css, /--repo-essays-rail:\s*320px/);
  assert.match(css, /--repo-foot-gutter:\s*24px/);
  assert.match(
    css,
    /\.repo-layout--write\s*\{[^}]*minmax\(\s*260px,\s*var\(--repo-essays-rail(?:,\s*320px)?\)/s,
  );
  assert.match(
    css,
    /\.repo-surface__foot\s*\{[^}]*right:\s*calc\(\s*var\(--repo-essays-rail\)\s*\+\s*var\(--repo-foot-gutter\)\s*\)/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*--repo-essays-rail:\s*0px/,
  );

  for (const [w, h] of [
    [1440, 900],
    [1280, 800],
    [1024, 600],
  ]) {
    const geo = repoFootSidebarGeometry(w, h);
    assert.equal(geo.sidebarVisible, true, `${w}x${h} sidebar visible`);
    assert.equal(geo.intersects, false, `${w}x${h} no intersection`);
    assert.ok(
      geo.clearancePx >= 24,
      `${w}x${h} clearance ${geo.clearancePx}px >= 24px gutter`,
    );
    assert.ok(
      geo.footRight <= geo.sidebarLeft,
      `${w}x${h} footRight ${geo.footRight} <= sidebarLeft ${geo.sidebarLeft}`,
    );
  }
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
  assert.match(auth, /\/repo\/files/);
  assert.match(auth, /Sign in or sign up/);
  const indexHtml = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  assert.match(indexHtml, /id="auth-gate"/);
  assert.match(indexHtml, /Sign in or sign up/);
  assert.match(indexHtml, /New numbers create an account/);
  assert.match(indexHtml, /Sign-up and login use the same screen/);
  assert.match(css, /\.repo-top__nav--signin/);
  assert.match(css, /\.repo-top__account/);
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
  assert.equal(env.byId["repo-file-path"].textContent, "Merchant portal reliability");
  assert.doesNotMatch(env.byId["repo-file-path"].textContent, /\.md|stories\//);
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
  const btn = env.findStoryButton("Merchant portal reliability");
  assert.ok(btn, "expected essay title button on Files page");
  assert.doesNotMatch(btn.textContent, /\.md$/);
  assert.doesNotMatch(btn.textContent, /stories\//);
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

test("write page has no top-right account / Sign out / Download chrome", () => {
  assert.doesNotMatch(html, /id="repo-download-one"/);
  assert.doesNotMatch(html, /id="repo-download-all"/);
  assert.doesNotMatch(html, /Download all/);
  assert.doesNotMatch(html, /id="repo-signin"/);
  assert.doesNotMatch(html, /id="repo-account"/);
  assert.doesNotMatch(html, /id="repo-account-label"/);
  assert.doesNotMatch(html, /id="repo-signout"/);
  assert.doesNotMatch(html, />Sign out</);
  assert.doesNotMatch(html, /repo-top--auth/);
  assert.doesNotMatch(html, /<header[\s\S]*?<\/header>/);
  assert.doesNotMatch(page, /downloadOne|downloadAll|renderDownloads|triggerDownload/);
  // Location stays centered in the editor column.
  assert.match(css, /\.repo-location\s*\{[^}]*align-self:\s*center/s);
  assert.match(css, /\.repo-location\s*\{[^}]*margin-left:\s*auto/s);
  assert.match(css, /\.repo-location\s*\{[^}]*margin-right:\s*auto/s);
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)[\s\S]*\.repo-layout--write[\s\S]*align-items:\s*stretch/,
  );
  assert.match(html, /id="repo-location"/);
  assert.match(html, /placeholder="Where are you\?"/);
});

test("blank pad is the new essay without download chrome", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: false, mode: "write" });
  await env.flush();
  assert.equal(env.byId["repo-body"].value, "");
  assert.equal(env.byId["repo-file-path"].textContent, "");
  env.byId["repo-body"].value = "# Quiet morning\n\nA note.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  assert.equal(env.byId["repo-file-path"].textContent, "Quiet morning");
  assert.doesNotMatch(env.byId["repo-file-path"].textContent, /\.md|stories\//);
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

test("click-select place with no file open fills the field and remembers recent", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: true, mode: "write" });
  await env.flush();
  assert.equal(env.window.tinkerRepo.getPlace(), "");
  assert.equal(env.byId["repo-location-input"].value, "");
  env.click("repo-location-btn");
  assert.equal(env.byId["repo-location-panel"].hidden, false);
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
  assert.equal(env.byId["repo-location-panel"].hidden, true);
  const recent = JSON.parse(env.storage.get("tinker.repo.placesRecent.v1") || "[]");
  assert.equal(recent[0], "Home");
  // Session place carries onto the next new file.
  env.click("repo-new-piece");
  await env.flush();
  assert.equal(env.window.tinkerRepo.getPlace(), "Home");
  assert.equal(env.byId["repo-location-input"].value, "Home");
  assert.equal(env.byId["repo-file-place"].hidden, false);
  assert.match(env.byId["repo-file-place"].textContent, /Home/);
});

test("keyboard-select place with no file open fills the field", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: true, mode: "write" });
  await env.flush();
  env.click("repo-location-btn");
  assert.equal(env.byId["repo-location-panel"].hidden, false);
  env.byId["repo-location-list"].dispatch("keydown", {
    type: "keydown",
    key: "ArrowDown",
    target: env.byId["repo-location-list"],
    preventDefault() {},
    stopPropagation() {},
  });
  env.byId["repo-location-list"].dispatch("keydown", {
    type: "keydown",
    key: "Enter",
    target: env.byId["repo-location-list"],
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  const place = env.window.tinkerRepo.getPlace();
  assert.ok(place);
  assert.equal(env.byId["repo-location-input"].value, place);
  assert.equal(env.byId["repo-location-panel"].hidden, true);
});

test("custom typed place commits on blur with no file open", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: true, mode: "write" });
  await env.flush();
  env.document.activeElement = env.byId["repo-location-input"];
  env.byId["repo-location-input"].value = "Train car";
  env.byId["repo-location-input"].dispatch("input", {
    type: "input",
    target: env.byId["repo-location-input"],
  });
  env.byId["repo-location-input"].dispatch("blur", {
    type: "blur",
    target: env.byId["repo-location-input"],
  });
  await env.flush();
  assert.equal(env.window.tinkerRepo.getPlace(), "Train car");
  assert.equal(env.byId["repo-location-input"].value, "Train car");
  const recent = JSON.parse(env.storage.get("tinker.repo.placesRecent.v1") || "[]");
  assert.equal(recent[0], "Train car");
});

test("pad actions stay hidden while typing and show after idle", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: true, mode: "write" });
  await env.flush();
  env.window.tinkerRepo.setPadIdleMs(25);
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "Learning in the quiet.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  assert.equal(env.window.tinkerRepo.arePadActionsVisible(), false);
  assert.ok(!env.byId["repo-pad-actions"].classList.contains("is-visible"));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(env.window.tinkerRepo.arePadActionsVisible(), true);
  assert.ok(env.byId["repo-pad-actions"].classList.contains("is-visible"));
  assert.equal(env.byId["repo-keep-crafting"].tabIndex, 0);
  assert.equal(env.byId["repo-this-is-everything"].tabIndex, 0);
  assert.equal(env.byId["repo-this-is-everything"].disabled, false);
  env.byId["repo-body"].value = "Learning in the quiet.\nAnother line.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  assert.equal(env.window.tinkerRepo.arePadActionsVisible(), false);
  assert.ok(!env.byId["repo-pad-actions"].classList.contains("is-visible"));
});

test("pad actions hide on keystroke and restart the adaptive timer", async () => {
  const revealed = [];
  const env = bootRepoPage({ token: "jwt-test", desktop: true, mode: "write" });
  await env.flush();
  env.window.tinkerAnalytics = {
    padActionsRevealed(delayMs, medianGapMs) {
      revealed.push({ delayMs, medianGapMs });
    },
  };
  env.window.tinkerRepo.setPadIdleMs(30);
  env.byId["repo-body"].value = "Pace matches typing.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(env.window.tinkerRepo.arePadActionsVisible(), true);
  assert.ok(revealed.length >= 1);

  const turns = env.byId["repo-pad"].querySelectorAll("textarea.repo-pad__turn");
  assert.ok(turns.length >= 1);
  turns[turns.length - 1].dispatch("keydown", {
    type: "keydown",
    key: "x",
    target: turns[turns.length - 1],
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(env.window.tinkerRepo.arePadActionsVisible(), false);
  assert.ok(!env.byId["repo-pad-actions"].classList.contains("is-visible"));
  // Cmd+Enter still works while hidden.
  let builds = 0;
  env.window.tinkerInterview.buildFollowupRequest = function (args) {
    builds += 1;
    return { mode: "freeform", system: "sys", user: "user:" + args.draft };
  };
  turns[turns.length - 1].dispatch("keydown", {
    type: "keydown",
    key: "Enter",
    metaKey: true,
    target: turns[turns.length - 1],
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  assert.equal(builds, 1);
});

test("This is everything saves the pad essay", async () => {
  const puts = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    onPutEssays(list) { puts.push(list); },
  });
  await env.flush();
  env.window.tinkerRepo.setPadIdleMs(15);
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "A quiet note about learning.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(env.window.tinkerRepo.arePadActionsVisible(), true);
  await env.window.tinkerRepo.savePad();
  await env.flush();
  assert.equal(puts.length, 1);
  assert.equal(puts[0].length, 1);
  assert.equal(puts[0][0].body, "A quiet note about learning.");
  assert.match(puts[0][0].title, /quiet note/i);
  assert.ok(String(puts[0][0].id || "").startsWith("e_"));
  const stories = env.window.tinkerRepo.getStories();
  assert.ok(stories.some((s) => s.id === puts[0][0].id));
});

test("pad Markdown round-trip keeps user text and stores questions as blockquotes", async () => {
  const env = bootRepoPage({ token: "jwt-test", desktop: true, mode: "write" });
  await env.flush();
  const samples = [
    "Just a note with no questions.\nSecond line.",
    "Lead-in paragraph.\n\n> What are you noticing about this?\n\nMy answer stays intact.",
    "> First question alone?\n\nAnswer after a leading question.",
    "Trailing space case.  \n\n> What changed when you sat with that longer?\n\n",
  ];
  for (const sample of samples) {
    const parsed = env.window.tinkerRepo.parsePadMarkdown(sample);
    const again = env.window.tinkerRepo.serializePadSegments(parsed);
    assert.equal(again, sample);
  }
  env.window.tinkerRepo.setPadMarkdown(
    "Lead-in paragraph.\n\n> What are you noticing about this?\n\nMy answer stays intact."
  );
  assert.equal(
    env.window.tinkerRepo.getPadMarkdown(),
    "Lead-in paragraph.\n\n> What are you noticing about this?\n\nMy answer stays intact."
  );
  assert.equal(
    JSON.stringify(env.window.tinkerRepo.visibleQuestionTexts()),
    JSON.stringify(["What are you noticing about this?"])
  );
  const qNode = env.byId["repo-pad"].children.find(
    (n) => n.getAttribute && n.getAttribute("data-pad-q") === "1"
  );
  assert.ok(qNode);
  assert.equal(qNode.textContent, "What are you noticing about this?");
  assert.doesNotMatch(qNode.textContent, /^>\s/);
  assert.match(env.byId["repo-body"].value, /^Lead-in paragraph\.\n\n> What are you noticing about this\?/);
});

test("Keep crafting inserts the follow-up question inline in the pad", async () => {
  const calls = [];
  const builds = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    onCallClaude(payload) { calls.push(payload); },
    onBuildFollowup(args) { builds.push(args); },
  });
  await env.flush();
  env.window.tinkerRepo.setPadIdleMs(15);
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "I keep noticing the same pattern.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 25));
  await env.window.tinkerRepo.keepCraftingPad();
  await env.flush();
  assert.equal(builds.length, 1);
  assert.equal(builds[0].draft, "I keep noticing the same pattern.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].system, "sys");
  assert.equal(env.window.tinkerRepo.getFollowupQuestion(), "What are you noticing about this?");
  assert.match(env.byId["repo-body"].value, /> What are you noticing about this\?\n\n$/);
  assert.equal(env.byId["repo-body"].selectionStart, env.byId["repo-body"].value.length);
  assert.equal(env.byId["repo-body"].selectionEnd, env.byId["repo-body"].value.length);
  assert.equal(
    JSON.stringify(env.window.tinkerRepo.visibleQuestionTexts()),
    JSON.stringify(["What are you noticing about this?"])
  );
  assert.equal(env.byId["repo-followup"].hidden, true);
  assert.equal(env.byId["repo-pad-error"].hidden, true);
});

test("Keep crafting second click appends after new writing and skips repeats", async () => {
  let n = 0;
  const builds = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    onBuildFollowup(args) { builds.push(args); },
    callClaude() {
      n += 1;
      const q = n === 1
        ? "What are you noticing about this?"
        : "What changed when you sat with that longer?";
      return Promise.resolve({ text: JSON.stringify({ questions: [q] }) });
    },
  });
  await env.flush();
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "I keep noticing the same pattern.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.keepCraftingPad();
  await env.flush();
  env.byId["repo-body"].value += "It shows up when I rush.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.keepCraftingPad();
  await env.flush();
  assert.equal(builds.length, 2);
  assert.equal(
    JSON.stringify(builds[1].priorTurns || []),
    JSON.stringify(["What are you noticing about this?"])
  );
  assert.match(
    env.byId["repo-body"].value,
    /> What are you noticing about this\?\n\nIt shows up when I rush\.\n\n> What changed when you sat with that longer\?\n\n$/
  );
  assert.equal(
    JSON.stringify(env.window.tinkerRepo.extractAskedQuestions(env.byId["repo-body"].value)),
    JSON.stringify([
      "What are you noticing about this?",
      "What changed when you sat with that longer?",
    ])
  );
});

test("This is everything persists inline questions with the essay", async () => {
  const puts = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    onPutEssays(list) { puts.push(list); },
    callClaude() {
      return Promise.resolve({
        text: JSON.stringify({ questions: ["What are you noticing about this?"] }),
      });
    },
  });
  await env.flush();
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "A quiet note about learning.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.keepCraftingPad();
  await env.window.tinkerRepo.savePad();
  await env.flush();
  assert.equal(puts.length, 1);
  assert.match(puts[0][0].body, /A quiet note about learning\./);
  assert.match(puts[0][0].body, /> What are you noticing about this\?/);
});

test("signed-out write page has no Sign in header; Files still does", async () => {
  const write = bootRepoPage({ desktop: true, mode: "write" });
  await write.flush();
  assert.equal(write.byId["repo-signin"], undefined);
  assert.equal(write.byId["repo-account"], undefined);
  assert.equal(write.byId["repo-signout"], undefined);

  const files = bootRepoPage({ desktop: true, mode: "files" });
  await files.flush();
  assert.equal(files.byId["repo-signin"].hidden, false);
  assert.equal(files.byId["repo-account"].hidden, true);
  files.click("repo-signin");
  assert.deepEqual(files.assigned, ["/?signin=1"]);
  assert.equal(files.session.get("tinker_mcp_return"), "/repo/files");
});

test("signed-in Files shows account chrome", async () => {
  const signedIn = bootRepoPage({
    token: "jwt-test",
    phone: "5551234567",
    desktop: true,
    mode: "files",
  });
  await signedIn.flush();
  assert.equal(signedIn.byId["repo-signin"].hidden, true);
  assert.equal(signedIn.byId["repo-account"].hidden, false);
  assert.match(signedIn.byId["repo-account-label"].textContent, /4567/);
});

test("signed-out Files Sign in returns to /repo/files", async () => {
  const env = bootRepoPage({ desktop: true, mode: "files" });
  await env.flush();
  assert.equal(env.byId["repo-signin"].hidden, false);
  env.click("repo-signin");
  assert.deepEqual(env.assigned, ["/?signin=1"]);
  assert.equal(env.session.get("tinker_mcp_return"), "/repo/files");
});

test("savePad signed-out sends to /?signin=1 without writing essays", async () => {
  let puts = 0;
  const env = bootRepoPage({
    desktop: true,
    mode: "write",
    onPutEssays() { puts += 1; },
  });
  await env.flush();
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "Unsigned draft that should not save.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.savePad();
  assert.equal(puts, 0);
  assert.deepEqual(env.assigned, ["/?signin=1"]);
  assert.ok(env.session.get("tinker.repo.padDraft.v1"));
});

test("This is everything button click saves, blanks the pad, and lists the essay", async () => {
  const puts = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    onPutEssays(list) { puts.push(list); },
  });
  await env.flush();
  env.window.tinkerRepo.setPadIdleMs(15);
  env.byId["repo-body"].value = "Finished thought about the work.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(env.window.tinkerRepo.arePadActionsVisible(), true);
  env.byId["repo-this-is-everything"].dispatch("click", {
    type: "click",
    target: env.byId["repo-this-is-everything"],
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  assert.equal(puts.length, 1);
  assert.equal(puts[0][0].body, "Finished thought about the work.");
  assert.match(puts[0][0].title, /Finished thought/i);
  // Blank starting screen — no Saved. / Saving… notice.
  assert.equal(String(env.byId["repo-body"].value || "").trim(), "");
  assert.equal(env.byId["repo-pad-error"].hidden, true);
  assert.doesNotMatch(String(env.byId["repo-pad-error-text"].textContent || ""), /Saved|Saving/);
  assert.equal(env.window.tinkerRepo.arePadActionsVisible(), false);
  const stories = env.window.tinkerRepo.getStories();
  assert.ok(stories.length >= 1);
  assert.equal(stories[0].id, puts[0][0].id);
  const treeText = String(env.byId["repo-tree"].textContent || "");
  assert.match(treeText, /Finished thought about the work/i);
});

test("This is everything failed save keeps the editor text and shows an inline error", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    failPutEssays: true,
  });
  await env.flush();
  env.window.tinkerRepo.setPadIdleMs(15);
  const draft = "Keep this writing if save fails.";
  env.byId["repo-body"].value = draft;
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 25));
  env.byId["repo-this-is-everything"].dispatch("click", {
    type: "click",
    target: env.byId["repo-this-is-everything"],
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  assert.match(String(env.byId["repo-body"].value || ""), /Keep this writing if save fails/);
  assert.equal(env.byId["repo-pad-error"].hidden, false);
  assert.match(String(env.byId["repo-pad-error-text"].textContent || ""), /Could not save this piece/);
  assert.doesNotMatch(String(env.byId["repo-pad-error-text"].textContent || ""), /\u2014/);
  assert.ok(!env.byId["repo-pad-error"].classList.contains("repo-pad-error--ok"));
});

test("This is everything double click does not create two essays", async () => {
  const puts = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    onPutEssays(list) { puts.push(list); },
  });
  await env.flush();
  env.window.tinkerRepo.setPadIdleMs(15);
  env.byId["repo-body"].value = "Only one essay please.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 25));
  const first = env.window.tinkerRepo.savePad();
  const second = env.window.tinkerRepo.savePad();
  await Promise.all([first, second]);
  await env.flush();
  assert.equal(puts.length, 1);
  assert.equal(String(env.byId["repo-body"].value || "").trim(), "");
});

test("This is everything signed-out click navigates to sign-in", async () => {
  const env = bootRepoPage({
    desktop: true,
    mode: "write",
  });
  await env.flush();
  env.window.tinkerRepo.setPadIdleMs(15);
  env.byId["repo-body"].value = "Need an account before this is everything.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 25));
  env.byId["repo-this-is-everything"].dispatch("click", {
    type: "click",
    target: env.byId["repo-this-is-everything"],
    preventDefault() {},
    stopPropagation() {},
  });
  await env.flush();
  assert.deepEqual(env.assigned, ["/?signin=1"]);
});

test("Keep crafting signed-out shows Sign in and starts auth return to /repo", async () => {
  const env = bootRepoPage({
    desktop: true,
    mode: "write",
  });
  await env.flush();
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "Signed-out draft about the work.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.keepCraftingPad();
  assert.equal(env.byId["repo-pad-error"].hidden, false);
  assert.match(env.byId["repo-pad-error-text"].textContent, /Sign in to get follow-up questions/);
  assert.equal(env.byId["repo-pad-error-signin"].hidden, false);
  assert.equal(env.byId["repo-pad-error-retry"].hidden, true);
  env.click("repo-pad-error-signin");
  assert.deepEqual(env.assigned, ["/?signin=1"]);
  assert.equal(env.session.get("tinker_mcp_return"), "/repo");
  const draft = JSON.parse(env.session.get("tinker.repo.padDraft.v1") || "{}");
  assert.match(draft.body || "", /Signed-out draft about the work/);
});

test("stale-token Sign in clears jwt and opens /?signin=1 without bounce", async () => {
  const env = bootRepoPage({
    token: "stale-rejected-token",
    desktop: true,
    mode: "write",
    callClaude() {
      const err = new Error("Session expired. Sign in again.");
      err.code = "SESSION_EXPIRED";
      err.status = 401;
      return Promise.reject(err);
    },
  });
  await env.flush();
  assert.equal(env.storage.get("tinker_jwt"), "stale-rejected-token");
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "Draft kept across reauth.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.keepCraftingPad();
  assert.equal(env.byId["repo-pad-error-signin"].hidden, false);
  env.click("repo-pad-error-signin");
  assert.equal(env.storage.get("tinker_jwt"), undefined);
  assert.ok(!env.storage.has("tinker_jwt"));
  assert.deepEqual(env.assigned, ["/?signin=1"]);
  assert.equal(env.session.get("tinker_mcp_return"), "/repo");
  const draft = JSON.parse(env.session.get("tinker.repo.padDraft.v1") || "{}");
  assert.match(draft.body || "", /Draft kept across reauth/);
});

test("draft restores after auth return to /repo", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    sessionDraft: JSON.stringify({
      body: "Restored after phone code.\n\n> What stayed with you?\n\n",
      place: "Coffee shop",
      at: Date.now(),
    }),
  });
  await env.flush();
  assert.match(env.window.tinkerRepo.getPadMarkdown(), /Restored after phone code/);
  assert.match(env.window.tinkerRepo.getPadMarkdown(), /> What stayed with you\?/);
  assert.equal(
    JSON.stringify(env.window.tinkerRepo.visibleQuestionTexts()),
    JSON.stringify(["What stayed with you?"])
  );
  assert.ok(!env.session.has("tinker.repo.padDraft.v1"));
});

test("Keep crafting signed-in inserts without sign-in prompt", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
  });
  await env.flush();
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "Signed-in draft.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.keepCraftingPad();
  assert.equal(env.byId["repo-pad-error"].hidden, true);
  assert.equal(env.byId["repo-pad-error-signin"].hidden, true);
  assert.match(env.byId["repo-body"].value, /> What are you noticing about this\?/);
});

test("Keep crafting error shows Retry and retries the request", async () => {
  let n = 0;
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    callClaude() {
      n += 1;
      if (n === 1) {
        const err = new Error("Upstream failed");
        err.code = "UPSTREAM";
        err.status = 502;
        return Promise.reject(err);
      }
      return Promise.resolve({
        text: JSON.stringify({ questions: ["What are you noticing about this?"] }),
      });
    },
  });
  await env.flush();
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "A draft that needs a retry.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.keepCraftingPad();
  assert.equal(env.byId["repo-pad-error"].hidden, false);
  assert.match(env.byId["repo-pad-error-text"].textContent, /Upstream failed/);
  assert.equal(env.byId["repo-pad-error-retry"].hidden, false);
  assert.equal(env.byId["repo-pad-error-signin"].hidden, true);
  env.click("repo-pad-error-retry");
  await env.flush();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(n, 2);
  assert.equal(env.byId["repo-pad-error"].hidden, true);
  assert.match(env.byId["repo-body"].value, /> What are you noticing about this\?/);
});

test("non-auth Keep crafting failure with Sign in wording still shows Retry", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    callClaude() {
      const err = new Error("Model overloaded — sign in later and retry.");
      err.code = "UPSTREAM";
      err.status = 529;
      return Promise.reject(err);
    },
  });
  await env.flush();
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "Should not treat this as auth.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.keepCraftingPad();
  assert.equal(env.byId["repo-pad-error"].hidden, false);
  assert.equal(env.byId["repo-pad-error-retry"].hidden, false);
  assert.equal(env.byId["repo-pad-error-signin"].hidden, true);
  assert.equal(env.storage.get("tinker_jwt"), "jwt-test");
  assert.equal(env.assigned.length, 0);
});

test("/repo write page has no header chrome", () => {
  assert.doesNotMatch(html, /<header[\s\S]*?<\/header>/);
  assert.doesNotMatch(html, /repo-top__back/);
  assert.doesNotMatch(html, /href="\/\?write=1"/);
  assert.doesNotMatch(html, /id="repo-signin"/);
  assert.doesNotMatch(html, /href="\/repo\/files"/);
});

test("sidebar and Files show essay titles without .md or path", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    search: "?file=self_1",
  });
  await env.flush();
  const btn = env.findStoryButton("Merchant portal reliability");
  assert.ok(btn, "sidebar should show the essay title");
  assert.doesNotMatch(btn.textContent, /\.md$/);
  assert.doesNotMatch(btn.textContent, /stories\//);
  assert.equal(env.byId["repo-file-path"].textContent, "Merchant portal reliability");
  assert.doesNotMatch(env.byId["repo-file-path"].textContent, /\.md|stories\//);
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

test("repo.js never tells signed-in users to Reload the page for missing helpers", () => {
  assert.doesNotMatch(page, /Reload the page/);
  assert.match(page, /resolveTinkerApi/);
  assert.match(page, /tinkerApi/);
  assert.match(page, /callClaude\) did not load/);
  assert.match(page, /buildFollowupRequest\) did not load/);
});

test("Keep crafting works with frozen Electron window.tinker (no callClaude on preload)", async () => {
  const calls = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    frozenPreload: true,
    pickNotesFolder() {
      return Promise.resolve("/Users/tyler/notes");
    },
    onCallClaude(payload) { calls.push(payload); },
  });
  await env.flush();

  assert.equal(Object.isFrozen(env.window.tinker), true);
  assert.equal(typeof env.window.tinker.callClaude, "undefined");
  assert.equal(typeof env.window.tinker.pickNotesFolder, "function");
  assert.equal(typeof env.window.tinkerApi.callClaude, "function");
  assert.equal(typeof env.window.tinkerApi.pickNotesFolder, "function");
  assert.equal(env.window.tinkerRepo.ensureClaudeClient(), true);
  assert.equal(env.window.tinkerRepo.resolveTinkerApi(), env.window.tinkerApi);

  env.window.tinkerRepo.setPadIdleMs(15);
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "I keep noticing the same pattern.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 25));
  await env.window.tinkerRepo.keepCraftingPad();
  await env.flush();

  assert.equal(calls.length, 1);
  assert.equal(env.window.tinkerRepo.getFollowupQuestion(), "What are you noticing about this?");
  assert.equal(env.byId["repo-pad-error"].hidden, true);
  assert.doesNotMatch(
    String(env.byId["repo-pad-error-text"].textContent || ""),
    /Reload the page/
  );
});

test("Keep crafting names the missing helper when interview API is absent", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    frozenPreload: true,
    tinkerInterview: {},
  });
  await env.flush();
  env.click("repo-new-piece");
  env.byId["repo-body"].value = "Draft with no interview helpers.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.window.tinkerRepo.keepCraftingPad();
  await env.flush();
  assert.equal(env.byId["repo-pad-error"].hidden, false);
  assert.equal(env.byId["repo-pad-error-retry"].hidden, false);
  assert.match(
    String(env.byId["repo-pad-error-text"].textContent || ""),
    /buildFollowupRequest/
  );
  assert.doesNotMatch(
    String(env.byId["repo-pad-error-text"].textContent || ""),
    /Reload the page/
  );
});

test("visualViewport inset lifts mobile action bar above the keyboard", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: false,
    mode: "write",
    innerHeight: 844,
    vvHeight: 500,
    vvOffsetTop: 0,
  });
  await env.flush();
  env.window.tinkerRepo.syncVisualViewportInset();
  assert.equal(
    env.document.documentElement.style.getPropertyValue("--repo-keyboard-inset"),
    "344px"
  );
});

test("tap blank writing space focuses the editor at the end", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
  });
  await env.flush();
  env.byId["repo-body"].value = "I’m afraid to complete formation modules";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.flush();
  const turns = env.byId["repo-pad"].querySelectorAll("textarea.repo-pad__turn");
  assert.ok(turns.length >= 1);
  // Simulate caret not at end, then tap blank surface (not a control).
  turns[turns.length - 1].selectionStart = 0;
  turns[turns.length - 1].selectionEnd = 0;
  env.byId["repo-surface"].dispatch("click", {
    type: "click",
    target: env.byId["repo-surface"],
    preventDefault() {},
    stopPropagation() {},
  });
  const focused = env.document.activeElement;
  assert.ok(focused);
  assert.equal(focused.tagName, "TEXTAREA");
  assert.ok(String(focused.className || "").includes("repo-pad__turn"));
  assert.equal(focused.selectionStart, String(focused.value || "").length);
  assert.equal(focused.selectionEnd, String(focused.value || "").length);
});

test("tap on location / action controls does not steal focus for typing", async () => {
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
  });
  await env.flush();
  env.byId["repo-body"].value = "Keep this caret alone.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await env.flush();
  env.document.activeElement = null;
  env.byId["repo-surface"].dispatch("click", {
    type: "click",
    target: env.byId["repo-location-btn"],
    preventDefault() {},
    stopPropagation() {},
  });
  // Location click is ignored by blank-pad handler (no focusLastPadTurn).
  assert.equal(env.document.activeElement, null);
});

test("Keep crafting kbd hint is desktop-only and uses ⌘/Ctrl", async () => {
  assert.match(css, /\.repo-surface__kbd\s*\{[^}]*display:\s*none/s);
  assert.match(
    css,
    /@media\s*\(\s*hover:\s*hover\s*\)\s*and\s*\(\s*pointer:\s*fine\s*\)\s*\{[\s\S]*\.repo-surface__kbd\s*\{[^}]*display:\s*inline/s,
  );
  assert.match(html, /aria-keyshortcuts="Meta\+Enter Control\+Enter"/);
  assert.match(html, /id="repo-keep-crafting-kbd"/);

  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
  });
  await env.flush();
  const btn = env.byId["repo-keep-crafting"];
  assert.ok(btn);
  assert.equal(btn.getAttribute("aria-keyshortcuts"), "Meta+Enter Control+Enter");
  const kbd = env.document.getElementById("repo-keep-crafting-kbd");
  assert.ok(kbd);
  assert.match(String(kbd.textContent || ""), /^(⌘↵|Ctrl↵)$/);

  // Non-Mac desktop → Ctrl↵
  env.window.navigator = { platform: "Win32", userAgent: "Windows NT 10.0" };
  env.window.tinkerRepo.syncKeepCraftingShortcutHint();
  assert.equal(kbd.textContent, "Ctrl↵");

  // Mac desktop → ⌘↵
  env.window.navigator = { platform: "MacIntel", userAgent: "Macintosh; Intel Mac OS X" };
  env.window.tinkerRepo.syncKeepCraftingShortcutHint();
  assert.equal(kbd.textContent, "⌘↵");

  // iPhone must not claim the ⌘ label (CSS also hides the hint on touch).
  env.window.navigator = { platform: "iPhone", userAgent: "iPhone; CPU iPhone OS 17_0" };
  env.window.tinkerRepo.syncKeepCraftingShortcutHint();
  assert.equal(kbd.textContent, "Ctrl↵");
});

test("Cmd/Ctrl+Enter on the pad triggers Keep crafting without inserting a newline", async () => {
  const builds = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    onBuildFollowup(args) { builds.push(args); },
  });
  await env.flush();
  env.window.tinkerRepo.setPadIdleMs(15);
  env.byId["repo-body"].value = "I keep noticing the same pattern.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 25));
  const turns = env.byId["repo-pad"].querySelectorAll("textarea.repo-pad__turn");
  assert.ok(turns.length >= 1);
  const turn = turns[turns.length - 1];
  const before = String(turn.value || "");
  let prevented = false;
  turn.dispatch("keydown", {
    type: "keydown",
    key: "Enter",
    metaKey: true,
    ctrlKey: false,
    target: turn,
    preventDefault() { prevented = true; },
    stopPropagation() {},
  });
  await env.flush();
  assert.equal(prevented, true);
  assert.equal(String(turn.value || ""), before);
  assert.equal(builds.length, 1);
  assert.match(env.byId["repo-body"].value, /> What are you noticing about this\?/);
});

test("Cmd/Ctrl+Enter does not fire Keep crafting while a request is in flight", async () => {
  let resolveClaude;
  const builds = [];
  const env = bootRepoPage({
    token: "jwt-test",
    desktop: true,
    mode: "write",
    onBuildFollowup(args) { builds.push(args); },
    callClaude() {
      return new Promise((resolve) => {
        resolveClaude = resolve;
      });
    },
  });
  await env.flush();
  env.window.tinkerRepo.setPadIdleMs(15);
  env.byId["repo-body"].value = "Still figuring this out.";
  env.byId["repo-body"].dispatch("input", {
    type: "input",
    target: env.byId["repo-body"],
  });
  await new Promise((r) => setTimeout(r, 25));
  const first = env.window.tinkerRepo.keepCraftingPad();
  await new Promise((r) => setImmediate(r));
  assert.equal(builds.length, 1);
  const turns = env.byId["repo-pad"].querySelectorAll("textarea.repo-pad__turn");
  turns[turns.length - 1].dispatch("keydown", {
    type: "keydown",
    key: "Enter",
    ctrlKey: true,
    metaKey: false,
    target: turns[turns.length - 1],
    preventDefault() {},
    stopPropagation() {},
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(builds.length, 1);
  resolveClaude({ text: JSON.stringify({ questions: ["What are you figuring out next?"] }) });
  await first;
  await env.flush();
});
