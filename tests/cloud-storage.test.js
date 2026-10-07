/* Cloud storage roots + path mapping + storage adapters. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const cloudRoots = require("../src/main/lib/cloud-roots.js");
const pathCore = require("../src/renderer/lib/storage-path-core.js");
const adapters = require("../src/renderer/lib/storage-adapters.js");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
const repoHtml = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const storageSection = fs.readFileSync(
  path.join(root, "src/renderer/repo/storage-section.js"),
  "utf8"
);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseVersion = fs.readFileSync(path.join(root, ".release-version"), "utf8").trim();

function memFs(tree) {
  // tree: { "/abs/path": "dir" | "file" }
  const store = Object.assign({}, tree);
  return {
    existsSync(p) {
      return Object.prototype.hasOwnProperty.call(store, p);
    },
    statSync(p) {
      const kind = store[p];
      if (!kind) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return {
        isDirectory() {
          return kind === "dir";
        },
        isFile() {
          return kind === "file";
        },
      };
    },
    readdirSync(p) {
      const prefix = p.endsWith(path.sep) ? p : p + path.sep;
      const names = new Set();
      Object.keys(store).forEach((key) => {
        if (!key.startsWith(prefix)) return;
        const rest = key.slice(prefix.length);
        if (!rest) return;
        const name = rest.split(path.sep)[0];
        if (name) names.add(name);
      });
      return Array.from(names);
    },
    mkdirSync(p, opts) {
      if (opts && opts.recursive) {
        const parts = p.split(path.sep).filter(Boolean);
        let cur = p.startsWith(path.sep) ? path.sep : "";
        for (const part of parts) {
          cur = cur === path.sep ? path.sep + part : path.join(cur, part);
          store[cur] = "dir";
        }
        return;
      }
      store[p] = "dir";
    },
    _store: store,
  };
}

test("version bump is 0.1.12 in package.json and .release-version", () => {
  assert.equal(packageJson.version, "0.1.12");
  assert.equal(releaseVersion, "0.1.12");
});

test("main and preload expose storage cloud root and custom path IPC", () => {
  assert.match(mainJs, /storage:cloudRoots/);
  assert.match(mainJs, /storage:useCloudRoot/);
  assert.match(mainJs, /storage:useCustomPath/);
  assert.match(preloadJs, /cloudStorageRoots/);
  assert.match(preloadJs, /useCloudStorageRoot/);
  assert.match(preloadJs, /useCustomStoragePath/);
});

test("repo page loads storage scripts and registerLocationSection hook", () => {
  assert.match(repoHtml, /storage-path-core\.js/);
  assert.match(repoHtml, /fs-access-folder\.js/);
  assert.match(repoHtml, /storage-adapters\.js/);
  assert.match(repoHtml, /storage-section\.js/);
  assert.match(storageSection, /registerLocationSection/);
  assert.match(storageSection, /key:\s*["']storage["']/);
  assert.match(storageSection, /getOptions/);
  assert.match(storageSection, /Choose folder/);
  assert.match(storageSection, /Cloud folders sync from the Mac app\./);
  assert.match(storageSection, /not installed/);
  assert.equal(/\u2014/.test(storageSection), false);
  assert.match(repoHtml, /\?v=37/);
  const filesHtml = fs.readFileSync(path.join(root, "src/renderer/repo/files/index.html"), "utf8");
  assert.match(filesHtml, /Saved in/);
  assert.match(filesHtml, /storage-section\.js\?v=34/);
});

test("detectCloudRoots: iCloud missing and Google Drive missing on fake home", () => {
  const home = "/tmp/fake-home-empty";
  const fsApi = memFs({
    [home]: "dir",
    [path.join(home, "Library")]: "dir",
  });
  const roots = cloudRoots.detectCloudRoots({
    homeDir: home,
    platform: "darwin",
    fs: fsApi,
  });
  const icloud = roots.find((r) => r.id === "icloud");
  const gdrive = roots.find((r) => r.id === "google-drive");
  assert.ok(icloud);
  assert.equal(icloud.installed, false);
  assert.ok(gdrive);
  assert.equal(gdrive.installed, false);
});

test("detectCloudRoots: iCloud present and multiple GoogleDrive accounts", () => {
  const home = "/tmp/fake-home-cloud";
  const icloud = path.join(home, cloudRoots.ICLOUD_REL);
  const cloudStorage = path.join(home, cloudRoots.CLOUD_STORAGE_REL);
  const g1 = path.join(cloudStorage, "GoogleDrive-a@example.com");
  const g1Drive = path.join(g1, "My Drive");
  const g2 = path.join(cloudStorage, "GoogleDrive-b@example.com");
  const g2Drive = path.join(g2, "My Drive");
  const dropbox = path.join(cloudStorage, "Dropbox");
  const oneDrive = path.join(cloudStorage, "OneDrive-Personal");
  const fsApi = memFs({
    [home]: "dir",
    [path.join(home, "Library")]: "dir",
    [icloud]: "dir",
    [cloudStorage]: "dir",
    [g1]: "dir",
    [g1Drive]: "dir",
    [g2]: "dir",
    [g2Drive]: "dir",
    [dropbox]: "dir",
    [oneDrive]: "dir",
  });
  const roots = cloudRoots.detectCloudRoots({
    homeDir: home,
    platform: "darwin",
    fs: fsApi,
  });
  assert.equal(roots.find((r) => r.id === "icloud").installed, true);
  assert.equal(roots.find((r) => r.id === "icloud").path, icloud);
  const google = roots.filter((r) => String(r.id).startsWith("google-drive:"));
  assert.equal(google.length, 2);
  assert.ok(google.some((r) => r.label === "Google Drive (a@example.com)"));
  assert.ok(google.some((r) => r.path === g1Drive));
  const db = roots.find((r) => r.id === "cloud:Dropbox");
  assert.ok(db);
  assert.equal(db.label, "Dropbox");
  assert.equal(db.installed, true);
  const od = roots.find((r) => r.id === "cloud:OneDrive-Personal");
  assert.ok(od);
  assert.equal(od.label, "OneDrive (Personal)");
});

test("detectCloudRoots: localized My Drive fallback picks first child dir", () => {
  const home = "/tmp/fake-home-localized";
  const cloudStorage = path.join(home, cloudRoots.CLOUD_STORAGE_REL);
  const g1 = path.join(cloudStorage, "GoogleDrive-x@y.com");
  const localized = path.join(g1, "Mon Drive");
  const fsApi = memFs({
    [home]: "dir",
    [path.join(home, "Library")]: "dir",
    [cloudStorage]: "dir",
    [g1]: "dir",
    [localized]: "dir",
  });
  const roots = cloudRoots.detectCloudRoots({
    homeDir: home,
    platform: "darwin",
    fs: fsApi,
  });
  const g = roots.find((r) => r.id === "google-drive:x@y.com");
  assert.ok(g);
  assert.equal(g.path, localized);
});

test("detectCloudRoots: non-mac returns not installed", () => {
  const roots = cloudRoots.detectCloudRoots({
    homeDir: "/home/ubuntu",
    platform: "linux",
    fs: memFs({ "/home/ubuntu": "dir" }),
  });
  assert.equal(roots.every((r) => r.installed === false), true);
});

test("useCloudRoot creates Tinker under selected root", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tinker-cloud-"));
  try {
    const icloud = path.join(home, cloudRoots.ICLOUD_REL);
    fs.mkdirSync(icloud, { recursive: true });
    const picked = cloudRoots.useCloudRoot("icloud", {
      homeDir: home,
      platform: "darwin",
    });
    assert.ok(picked);
    assert.equal(picked.name, "Tinker");
    assert.equal(picked.path, path.join(icloud, "Tinker"));
    assert.equal(fs.existsSync(picked.path), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("path mapping: slugify, conflict names, folder tree to rel paths", () => {
  assert.equal(pathCore.slugify("Hello World!"), "hello-world");
  assert.equal(pathCore.slugify(""), "untitled");
  assert.match(
    pathCore.conflictRelPath("essays/note.md", new Date("2026-10-03T16:12:00Z")),
    /^essays\/note\.conflict-20261003-161200\.md$/
  );
  const folders = [
    { id: "f1", name: "Essays", parentId: null },
    { id: "f2", name: "Drafts", parentId: "f1" },
  ];
  const placements = { a1: "f2" };
  const rel = pathCore.fileRelPath(folders, placements, {
    id: "a1",
    title: "First Piece",
  });
  assert.equal(rel, "Essays/Drafts/first-piece.md");
  const mapped = pathCore.mapTreeToFiles(folders, placements, [
    { id: "a1", title: "First Piece", body: "hi" },
    { id: "a2", title: "First Piece", body: "other", folderId: "f2" },
  ]);
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].relPath, "Essays/Drafts/first-piece.md");
  assert.equal(mapped[1].relPath, "Essays/Drafts/first-piece-2.md");
  assert.equal(mapped[0].tinkerId, "a1");
});

test("storage adapters expose electron and fs-access factories", () => {
  assert.equal(typeof adapters.localFolderAdapter, "function");
  assert.equal(typeof adapters.cloudDesktopAdapter, "function");
  assert.equal(typeof adapters.fsAccessAdapter, "function");
  assert.equal(typeof adapters.hasCloudIpc, "function");
  assert.equal(adapters.hasCloudIpc(), false);
  assert.equal(adapters.hasFsAccess(), false);
  const local = adapters.localFolderAdapter("/tmp/Tinker", {
    id: "icloud",
    label: "iCloud Drive",
  });
  assert.equal(local.id, "icloud");
  assert.equal(local.available(), false);
});

test("useCustomPath expands ~, creates folder, and rejects non-writable", () => {
  const customPath = require("../src/main/lib/custom-path.js");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tinker-custom-home-"));
  try {
    const writing = customPath.useCustomPath("~/Documents/Writing", { homeDir: home });
    assert.equal(writing.path, path.join(home, "Documents", "Writing"));
    assert.equal(writing.id, "custom");
    assert.equal(writing.label, "~/Documents/Writing");
    assert.equal(fs.existsSync(writing.path), true);

    assert.throws(
      () => customPath.useCustomPath("   ", { homeDir: home }),
      /Enter a folder path/
    );

    const filePath = path.join(home, "not-a-dir.txt");
    fs.writeFileSync(filePath, "x");
    assert.throws(
      () => customPath.useCustomPath(filePath, { homeDir: home }),
      /not a folder/
    );

    const blocked = path.join(home, "blocked");
    fs.mkdirSync(blocked);
    const fsApi = {
      existsSync: fs.existsSync.bind(fs),
      mkdirSync: fs.mkdirSync.bind(fs),
      statSync: fs.statSync.bind(fs),
      accessSync() {
        const err = new Error("EACCES");
        err.code = "EACCES";
        throw err;
      },
      constants: fs.constants,
    };
    assert.throws(
      () => customPath.useCustomPath(blocked, { homeDir: home, fs: fsApi }),
      /not writable/
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("no em dashes in new storage modules", () => {
  const files = [
    "src/main/lib/cloud-roots.js",
    "src/main/lib/custom-path.js",
    "src/renderer/lib/storage-path-core.js",
    "src/renderer/lib/fs-access-folder.js",
    "src/renderer/lib/storage-adapters.js",
    "src/renderer/repo/storage-section.js",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    assert.equal(/\u2014/.test(src), false, rel + " contains em dash");
  }
});
