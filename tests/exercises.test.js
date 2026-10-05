/* Exercises lab: manifest, page wiring, clone path, IDE open, GitHub fallback. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");

const root = path.join(__dirname, "..");
const lab = require("../src/main/lib/exercises-lab.js");
const manifest = require("../src/renderer/exercises/manifest.js");
const openSrc = fs.readFileSync(
  path.join(root, "src/renderer/exercises/exercises-open.js"),
  "utf8"
);
const pageJs = fs.readFileSync(
  path.join(root, "src/renderer/exercises/exercises.js"),
  "utf8"
);
const html = fs.readFileSync(
  path.join(root, "src/renderer/exercises/index.html"),
  "utf8"
);
const settingsHtml = fs.readFileSync(
  path.join(root, "src/renderer/settings/index.html"),
  "utf8"
);
const settingsJs = fs.readFileSync(
  path.join(root, "src/renderer/settings/settings.js"),
  "utf8"
);
const auth = fs.readFileSync(path.join(root, "src/renderer/auth.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const preload = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
const leadsHtml = fs.readFileSync(
  path.join(root, "src/renderer/leads/index.html"),
  "utf8"
);

function loadOpen() {
  const sandbox = { window: {}, module: { exports: {} }, exports: {} };
  sandbox.self = sandbox.window;
  vm.runInNewContext(openSrc, vm.createContext(sandbox));
  return sandbox.window.tinkerExercisesOpen || sandbox.module.exports;
}

test("manifest lists current modules and is easy to extend", () => {
  assert.equal(manifest.repo, "tlindow/lindowlabs");
  assert.equal(manifest.exercisesRoot, "exercises");
  assert.ok(Array.isArray(manifest.modules));
  assert.ok(manifest.modules.length >= 4);
  const ids = manifest.modules.map((m) => m.id);
  assert.deepEqual(
    ids.slice(0, 4),
    [
      "realtime-deal-room",
      "rest-api-trading",
      "proto-learning",
      "nextjs-learning",
    ]
  );
  for (const mod of manifest.modules) {
    assert.match(mod.id, lab.MODULE_ID_RE);
    assert.equal(typeof mod.name, "string");
    assert.ok(mod.name.length > 0);
    assert.equal(typeof mod.description, "string");
    assert.ok(mod.description.length > 0);
    assert.equal(mod.description.includes("—"), false);
    assert.equal(mod.description.includes("–"), false);
  }
  const src = fs.readFileSync(
    path.join(root, "src/renderer/exercises/manifest.js"),
    "utf8"
  );
  assert.match(src, /TODO: add api-design/);
});

test("exercises page renders Open in IDE and View on GitHub without cursor deep links", () => {
  assert.match(html, /Exercises/);
  assert.match(html, /id="exercises-list"/);
  assert.match(html, /src="\/exercises\/manifest\.js"/);
  assert.match(html, /src="\/exercises\/exercises-open\.js"/);
  assert.match(html, /src="\/exercises\/exercises\.js"/);
  assert.match(pageJs, /Open in IDE/);
  assert.match(pageJs, /View on GitHub/);
  assert.equal(html.includes("cursor://"), false);
  assert.equal(pageJs.includes("cursor://"), false);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(pageJs.includes("innerHTML"), false);
  assert.match(pageJs, /textContent/);
  assert.match(pageJs, /sessionStorage.setItem\(RETURN_KEY, "\/exercises"\)/);
  assert.equal(html.includes("—"), false);
  assert.equal(pageJs.includes("—"), false);
});

test("signed-out /exercises is wired for return after sign-in", () => {
  assert.match(auth, /\/exercises/);
  assert.match(auth, /path !== "\/exercises"/);
  assert.match(sw, /pathname === "\/exercises"/);
  assert.match(vercel, /\/exercises\/index\.html/);
  assert.match(settingsHtml, /href="\/exercises"/);
  assert.match(leadsHtml, /href="\/exercises"/);
});

test("page render lists each manifest module with actions", () => {
  const open = loadOpen();
  const kids = [];
  const listEl = {
    get firstChild() {
      return kids[0] || null;
    },
    set firstChild(_value) {
      // Some DOM shims assign firstChild; keep the getter authoritative.
    },
    appendChild(node) {
      kids.push(node);
      return node;
    },
    removeChild(node) {
      const idx = kids.indexOf(node);
      if (idx >= 0) kids.splice(idx, 1);
      return node;
    },
  };

  function el(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      className: "",
      type: "",
      textContent: "",
      href: "",
      target: "",
      rel: "",
      disabled: false,
      children: [],
      attrs: {},
      listeners: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
  }

  const sandbox = {
    window: {
      tinkerExercisesManifest: manifest,
      tinkerExercisesOpen: open,
      location: { assign() {} },
    },
    localStorage: { getItem() { return "signed-in"; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      getElementById(id) {
        if (id === "exercises-status") return el("p");
        if (id === "exercises-list") return listEl;
        return null;
      },
      createElement: el,
    },
  };
  vm.runInNewContext(pageJs, vm.createContext(sandbox));

  assert.equal(kids.length, manifest.modules.length);
  for (let i = 0; i < manifest.modules.length; i += 1) {
    const row = kids[i];
    assert.equal(row.attrs["data-module-id"], manifest.modules[i].id);
    const name = row.children.find((c) => c.className === "exercises__name");
    const desc = row.children.find((c) => c.className === "exercises__desc");
    const actions = row.children.find((c) => c.className === "exercises__actions");
    assert.equal(name.textContent, manifest.modules[i].name);
    assert.equal(desc.textContent, manifest.modules[i].description);
    const openBtn = actions.children.find((c) => c.className === "exercises__open");
    const gh = actions.children.find((c) => c.className === "exercises__github");
    assert.equal(openBtn.textContent, "Open in IDE");
    assert.equal(gh.textContent, "View on GitHub");
    assert.equal(
      gh.href,
      "https://github.com/tlindow/lindowlabs/tree/main/exercises/" +
        manifest.modules[i].id
    );
  }
});

test("resolveClonePath defaults to ~/lindowlabs and expands ~", () => {
  const home = "/Users/tyler";
  assert.equal(lab.defaultClonePath(home), path.join(home, "lindowlabs"));
  assert.equal(lab.resolveClonePath("", home), path.join(home, "lindowlabs"));
  assert.equal(lab.resolveClonePath("  ", home), path.join(home, "lindowlabs"));
  assert.equal(
    lab.resolveClonePath("~/Projects/lab", home),
    path.join(home, "Projects/lab")
  );
  assert.equal(
    lab.resolveClonePath("/opt/lindowlabs", home),
    path.resolve("/opt/lindowlabs")
  );
  const normalized = lab.normalizeSettings(
    { clonePath: "", ideCommand: "  code --new-window  " },
    home
  );
  assert.equal(normalized.clonePath, path.join(home, "lindowlabs"));
  assert.equal(normalized.ideCommand, "code --new-window");
  assert.equal(normalized.defaultClonePath, path.join(home, "lindowlabs"));
});

test("chooseOpenAction uses GitHub fallback off desktop", () => {
  const url = lab.githubModuleUrl("proto-learning");
  assert.deepEqual(
    lab.chooseOpenAction({
      isDesktop: false,
      ideCommand: "code",
      moduleAbsPath: "/tmp/lindowlabs/exercises/proto-learning",
      githubUrl: url,
    }),
    { kind: "github", url }
  );
});

test("chooseOpenAction prefers IDE command then OS default on desktop", () => {
  const folder = "/tmp/lindowlabs/exercises/nextjs-learning";
  assert.deepEqual(
    lab.chooseOpenAction({
      isDesktop: true,
      ideCommand: "",
      moduleAbsPath: folder,
      githubUrl: lab.githubModuleUrl("nextjs-learning"),
    }),
    { kind: "openPath", path: folder }
  );
  assert.deepEqual(
    lab.chooseOpenAction({
      isDesktop: true,
      ideCommand: "code",
      moduleAbsPath: folder,
      githubUrl: lab.githubModuleUrl("nextjs-learning"),
    }),
    { kind: "command", command: "code", args: [folder] }
  );
  assert.deepEqual(
    lab.chooseOpenAction({
      isDesktop: true,
      ideCommand: 'cursor --folder-uri',
      moduleAbsPath: folder,
      githubUrl: lab.githubModuleUrl("nextjs-learning"),
    }),
    {
      kind: "command",
      command: "cursor",
      args: ["--folder-uri", folder],
    }
  );
});

test("renderer openModule falls back to GitHub when desktop bridge is missing", async () => {
  const open = loadOpen();
  const opened = [];
  const api = {
    openExternal(url) { opened.push(url); },
  };
  const result = await open.openModule("rest-api-trading", api);
  assert.equal(result.ok, true);
  assert.equal(result.via, "github");
  assert.deepEqual(opened, [
    "https://github.com/tlindow/lindowlabs/tree/main/exercises/rest-api-trading",
  ]);
  assert.equal(open.isDesktopShell(api), false);
  assert.equal(
    open.isDesktopShell({ openExerciseModule() {}, isDesktopApp: true }),
    true
  );
});

test("renderer openModule uses the desktop bridge when present", async () => {
  const open = loadOpen();
  const result = await open.openModule("realtime-deal-room", {
    isDesktopApp: true,
    openExerciseModule(id) {
      return Promise.resolve({ ok: true, via: "desktop", id });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, "desktop");
  assert.equal(result.id, "realtime-deal-room");
});

test("ensureLabRepo clones when missing and pulls when present", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tinker-ex-"));
  const clonePath = path.join(tmp, "lindowlabs");
  const calls = [];
  const memFs = {
    existsSync(p) {
      if (p === clonePath) return false;
      if (p === path.dirname(clonePath)) return true;
      return fs.existsSync(p);
    },
    mkdirSync() {},
  };
  const cloned = await lab.ensureLabRepo({
    clonePath,
    fs: memFs,
    run(cmd, args, cwd) {
      calls.push({ cmd, args, cwd });
      return Promise.resolve(true);
    },
  });
  assert.equal(cloned.action, "clone");
  assert.equal(calls[0].cmd, "git");
  assert.deepEqual(calls[0].args, ["clone", lab.REPO_HTTPS, clonePath]);

  const gitDir = path.join(clonePath, ".git");
  fs.mkdirSync(gitDir, { recursive: true });
  calls.length = 0;
  const pulled = await lab.ensureLabRepo({
    clonePath,
    fs,
    run(cmd, args, cwd) {
      calls.push({ cmd, args, cwd });
      return Promise.resolve(true);
    },
  });
  assert.equal(pulled.action, "pull");
  assert.deepEqual(calls[0].args, ["pull", "--ff-only"]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("moduleAbsPath rejects unknown ids and path escape", () => {
  const rootDir = "/tmp/lindowlabs";
  assert.equal(
    lab.moduleAbsPath(rootDir, "proto-learning", ["proto-learning"]),
    path.join(rootDir, "exercises", "proto-learning")
  );
  assert.throws(
    () => lab.moduleAbsPath(rootDir, "../secret", ["proto-learning"]),
    /Unknown exercise module/
  );
  assert.throws(
    () => lab.moduleAbsPath(rootDir, "nope", ["proto-learning"]),
    /Unknown exercise module/
  );
});

test("desktop shell exposes exercises IPC bridges", () => {
  assert.match(preload, /openExerciseModule/);
  assert.match(preload, /getExerciseLabSettings/);
  assert.match(preload, /setExerciseLabSettings/);
  assert.match(preload, /pickExerciseLabPath/);
  assert.match(mainJs, /exercises:openModule/);
  assert.match(mainJs, /exercises:getSettings/);
  assert.match(mainJs, /exercises:setSettings/);
  assert.match(mainJs, /exercises-lab\.json/);
  assert.match(settingsJs, /getExerciseLabSettings/);
  assert.match(settingsJs, /setExerciseLabSettings/);
  assert.match(settingsHtml, /data-exercises-clone-path/);
  assert.match(settingsHtml, /data-exercises-ide-command/);
  assert.match(settingsHtml, /id="settings-exercises"/);
});
