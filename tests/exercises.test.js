/* Exercises: manifest, page wiring, clone path, IDE open, GitHub fallback. */
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

test("manifest lists Tinker modules and readings, easy to extend", () => {
  assert.equal(manifest.repo, "beginner-work/tinker");
  assert.equal(manifest.exercisesRoot, "exercises");
  assert.ok(Array.isArray(manifest.modules));
  assert.equal(manifest.modules.length, 4);
  const ids = manifest.modules.map((m) => m.id);
  assert.deepEqual(ids, [
    "formation-persistent-storage",
    "pacific-wall-time",
    "mark-touch-sent",
    "stripe-payment-intent",
  ]);
  assert.equal(manifest.modules[0].externalUrl, "https://formation.dev");
  assert.equal(manifest.modules[0].path, undefined);
  assert.equal(manifest.modules[1].path, "exercises/pacific-wall-time.js");
  assert.equal(manifest.modules[2].path, "exercises/mark-touch-sent.js");
  assert.equal(manifest.modules[3].path, "exercises/stripe-payment-intent.js");
  for (const mod of manifest.modules) {
    assert.match(mod.id, lab.MODULE_ID_RE);
    assert.equal(typeof mod.name, "string");
    assert.ok(mod.name.length > 0);
    assert.equal(typeof mod.description, "string");
    assert.ok(mod.description.length > 0);
    assert.equal(mod.description.includes("—"), false);
    assert.equal(mod.description.includes("–"), false);
    assert.equal(typeof mod.topic, "string");
    assert.equal(typeof mod.status, "string");
    assert.equal(/lindowlabs/i.test(mod.description), false);
  }
  assert.ok(Array.isArray(manifest.readings));
  assert.equal(manifest.readings.length, 4);
  assert.deepEqual(
    manifest.readings.map((r) => r.name),
    [
      "Site Reliability Engineering",
      "Domain-Driven Design",
      "How can we develop transformative tools for thought?",
      "TypeScript and React foundations",
    ]
  );
  assert.equal(manifest.readings[0].author, "Google");
  assert.equal(manifest.readings[0].topic, "Reliability");
  assert.equal(manifest.readings[0].status, "Not started");
  assert.equal(manifest.readings[0].note, "Chapters 3, 4, 6, 14 and 15.");
  assert.equal(
    manifest.readings[0].link,
    "https://sre.google/sre-book/table-of-contents/"
  );
  assert.equal(manifest.readings[1].author, "Eric Evans");
  assert.equal(manifest.readings[1].status, "In progress");
  assert.equal(
    manifest.readings[1].note,
    "Cover to cover, picking up at Chapter 3."
  );
  assert.equal(manifest.readings[1].link, undefined);
  assert.equal(
    manifest.readings[2].author,
    "Andy Matuschak and Michael Nielsen"
  );
  assert.equal(manifest.readings[2].topic, "Tools for thought");
  assert.equal(manifest.readings[2].note, "Free essay.");
  assert.equal(manifest.readings[2].link, "https://numinous.productions/ttft/");
  assert.equal(manifest.readings[3].author, "Official docs");
  assert.equal(manifest.readings[3].topic, "Web");
  assert.equal(
    manifest.readings[3].note,
    "Three short official pieces, each under an hour."
  );
  assert.equal(manifest.readings[3].links.length, 3);
  assert.deepEqual(
    manifest.readings[3].links.map((l) => l.label),
    [
      "Thinking in React",
      "TypeScript for JavaScript Programmers",
      "Using TypeScript",
    ]
  );
  assert.equal(
    manifest.readings.some((r) => /Kleppmann|Glenbrook|Data-Intensive|Payments Systems/i.test(r.name)),
    false
  );
  for (const book of manifest.readings) {
    assert.equal(String(book.note || "").includes("—"), false);
    assert.equal(String(book.note || "").includes("–"), false);
    assert.equal(String(book.name || "").includes("—"), false);
  }
  const src = fs.readFileSync(
    path.join(root, "src/renderer/exercises/manifest.js"),
    "utf8"
  );
  assert.match(src, /TODO: add api-design/);
  assert.match(src, /Reading order is fixed/);
  assert.equal(src.includes("—"), false);
});

test("module files live in beginner-work/tinker with specs and failing tests", () => {
  for (const rel of [
    "exercises/pacific-wall-time.js",
    "exercises/mark-touch-sent.js",
    "exercises/stripe-payment-intent.js",
  ]) {
    const abs = path.join(root, rel);
    assert.equal(fs.existsSync(abs), true, rel);
    const body = fs.readFileSync(abs, "utf8");
    assert.match(body, /tests:\s*\[/);
    assert.equal(body.includes("—"), false);
    assert.equal(body.includes("–"), false);
  }
  const pacific = fs.readFileSync(
    path.join(root, "exercises/pacific-wall-time.js"),
    "utf8"
  );
  assert.equal((pacific.match(/name:\s*"/g) || []).length, 3);
  const touch = fs.readFileSync(
    path.join(root, "exercises/mark-touch-sent.js"),
    "utf8"
  );
  assert.equal((touch.match(/name:\s*"/g) || []).length, 3);
  const stripe = fs.readFileSync(
    path.join(root, "exercises/stripe-payment-intent.js"),
    "utf8"
  );
  assert.equal((stripe.match(/name:\s*"/g) || []).length, 4);
  assert.equal(
    fs.existsSync(
      path.join(root, "src/renderer/practice/fixtures/stripe-payment-intent-create.json")
    ),
    true
  );
});

test("exercises page copy is Tinker-home, with logo and reading section", () => {
  assert.match(html, /Exercises/);
  assert.match(html, /id="exercises-list"/);
  assert.match(html, /id="exercises-reading-list"/);
  assert.match(html, /Tinker's hands-on modules/);
  assert.match(html, /tinker-mark\.svg/);
  assert.match(html, /Reading/);
  assert.match(html, /never stores non-owners' writing/);
  assert.equal(/lindowlabs/i.test(html), false);
  assert.equal(html.includes("beginner.work"), false);
  assert.match(html, /src="\/exercises\/manifest\.js\?v=33"/);
  assert.match(html, /src="\/exercises\/exercises-open\.js\?v=33"/);
  assert.match(html, /src="\/exercises\/exercises\.js\?v=33"/);
  assert.match(pageJs, /Open in IDE/);
  assert.match(pageJs, /View on GitHub/);
  assert.match(pageJs, /Open link/);
  assert.match(pageJs, /Open Formation/);
  assert.equal(html.includes("cursor://"), false);
  assert.equal(pageJs.includes("cursor://"), false);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(pageJs.includes("innerHTML"), false);
  assert.match(pageJs, /textContent/);
  assert.match(pageJs, /sessionStorage.setItem\(RETURN_KEY, "\/exercises"\)/);
  assert.equal(html.includes("—"), false);
  assert.equal(pageJs.includes("—"), false);
  assert.equal(pageJs.includes("beginner.work"), false);
});

test("signed-out /exercises is wired for return after sign-in", () => {
  assert.match(auth, /\/exercises/);
  assert.match(auth, /path !== "\/exercises"/);
  assert.match(sw, /pathname === "\/exercises"/);
  assert.match(vercel, /\/exercises\/index\.html/);
  assert.match(settingsHtml, /href="\/exercises"/);
  assert.match(leadsHtml, /href="\/exercises"/);
});

test("page render lists each manifest module and reading", () => {
  const open = loadOpen();
  const moduleKids = [];
  const readingKids = [];
  function listEl(kids) {
    return {
      get firstChild() {
        return kids[0] || null;
      },
      set firstChild(_value) {},
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
  }

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
        if (id === "exercises-list") return listEl(moduleKids);
        if (id === "exercises-reading-list") return listEl(readingKids);
        return null;
      },
      createElement: el,
    },
  };
  vm.runInNewContext(pageJs, vm.createContext(sandbox));

  assert.equal(moduleKids.length, manifest.modules.length);
  for (let i = 0; i < manifest.modules.length; i += 1) {
    const row = moduleKids[i];
    const mod = manifest.modules[i];
    assert.equal(row.attrs["data-module-id"], mod.id);
    const name = row.children.find((c) => c.className === "exercises__name");
    const desc = row.children.find((c) => c.className === "exercises__desc");
    const actions = row.children.find((c) => c.className === "exercises__actions");
    assert.equal(name.textContent, mod.name);
    assert.equal(desc.textContent, mod.description);
    const openBtn = actions.children.find((c) => c.className === "exercises__open");
    const gh = actions.children.find((c) => c.className === "exercises__github");
    if (mod.externalUrl) {
      assert.equal(openBtn.textContent, "Open link");
      assert.equal(gh.textContent, "Open Formation");
      assert.equal(gh.href, "https://formation.dev");
    } else {
      assert.equal(openBtn.textContent, "Open in IDE");
      assert.equal(gh.textContent, "View on GitHub");
      assert.equal(
        gh.href,
        "https://github.com/beginner-work/tinker/blob/main/" + mod.path
      );
    }
  }

  assert.equal(readingKids.length, manifest.readings.length);
  const firstName = readingKids[0].children.find((c) => c.className === "exercises__name");
  const firstLink = firstName.children.find(
    (c) => c.className === "exercises__reading-title-link"
  );
  assert.ok(firstLink);
  assert.equal(firstLink.textContent, "Site Reliability Engineering");
  assert.equal(firstLink.href, "https://sre.google/sre-book/table-of-contents/");
  assert.equal(firstLink.target, "_blank");
  assert.equal(firstLink.rel, "noopener noreferrer");

  const ddd = readingKids[1];
  assert.equal(
    ddd.children.find((c) => c.className === "exercises__name").textContent,
    "Domain-Driven Design"
  );
  assert.equal(
    ddd.children.find((c) => c.className === "exercises__desc").textContent,
    "Cover to cover, picking up at Chapter 3."
  );

  const essay = readingKids[2];
  const essayLink = essay.children
    .find((c) => c.className === "exercises__name")
    .children.find((c) => c.className === "exercises__reading-title-link");
  assert.equal(essayLink.href, "https://numinous.productions/ttft/");
  assert.equal(essayLink.target, "_blank");

  const tsRow = readingKids[3];
  assert.equal(
    tsRow.children.find((c) => c.className === "exercises__name").textContent,
    "TypeScript and React foundations"
  );
  const linkList = tsRow.children.find((c) => c.className === "exercises__reading-links");
  assert.ok(linkList);
  assert.equal(linkList.children.length, 3);
  assert.equal(
    linkList.children[0].children[0].href,
    "https://react.dev/learn/thinking-in-react"
  );
  assert.equal(linkList.children[0].children[0].target, "_blank");
  assert.equal(linkList.children[0].children[0].rel, "noopener noreferrer");
  assert.equal(
    linkList.children[1].children[0].href,
    "https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html"
  );
  assert.equal(
    linkList.children[2].children[0].href,
    "https://react.dev/learn/typescript"
  );
});

test("resolveClonePath defaults to ~/tinker and expands ~", () => {
  const home = "/Users/tyler";
  assert.equal(lab.defaultClonePath(home), path.join(home, "tinker"));
  assert.equal(lab.resolveClonePath("", home), path.join(home, "tinker"));
  assert.equal(lab.resolveClonePath("  ", home), path.join(home, "tinker"));
  assert.equal(
    lab.resolveClonePath("~/Projects/lab", home),
    path.join(home, "Projects/lab")
  );
  assert.equal(
    lab.resolveClonePath("/opt/tinker", home),
    path.resolve("/opt/tinker")
  );
  const normalized = lab.normalizeSettings(
    { clonePath: "", ideCommand: "  code --new-window  " },
    home
  );
  assert.equal(normalized.clonePath, path.join(home, "tinker"));
  assert.equal(normalized.ideCommand, "code --new-window");
  assert.equal(normalized.defaultClonePath, path.join(home, "tinker"));
  assert.equal(normalized.repo, "beginner-work/tinker");
});

test("chooseOpenAction uses external URL, GitHub fallback, or IDE", () => {
  assert.deepEqual(
    lab.chooseOpenAction({
      isDesktop: true,
      externalUrl: "https://formation.dev",
      moduleAbsPath: "",
      githubUrl: "",
    }),
    { kind: "external", url: "https://formation.dev" }
  );
  const url = lab.githubModuleUrl("pacific-wall-time", {
    path: "exercises/pacific-wall-time.js",
  });
  assert.deepEqual(
    lab.chooseOpenAction({
      isDesktop: false,
      ideCommand: "code",
      moduleAbsPath: "/tmp/tinker/exercises/pacific-wall-time.js",
      githubUrl: url,
    }),
    { kind: "github", url }
  );
});

test("chooseOpenAction prefers IDE command then OS default on desktop", () => {
  const file = "/tmp/tinker/exercises/mark-touch-sent.js";
  assert.deepEqual(
    lab.chooseOpenAction({
      isDesktop: true,
      ideCommand: "",
      moduleAbsPath: file,
      githubUrl: lab.githubModuleUrl("mark-touch-sent", {
        path: "exercises/mark-touch-sent.js",
      }),
    }),
    { kind: "openPath", path: file }
  );
  assert.deepEqual(
    lab.chooseOpenAction({
      isDesktop: true,
      ideCommand: "code",
      moduleAbsPath: file,
      githubUrl: lab.githubModuleUrl("mark-touch-sent", {
        path: "exercises/mark-touch-sent.js",
      }),
    }),
    { kind: "command", command: "code", args: [file] }
  );
  assert.deepEqual(
    lab.chooseOpenAction({
      isDesktop: true,
      ideCommand: "cursor --folder-uri",
      moduleAbsPath: file,
      githubUrl: lab.githubModuleUrl("mark-touch-sent", {
        path: "exercises/mark-touch-sent.js",
      }),
    }),
    {
      kind: "command",
      command: "cursor",
      args: ["--folder-uri", file],
    }
  );
});

test("renderer openModule falls back to GitHub when desktop bridge is missing", async () => {
  const open = loadOpen();
  const opened = [];
  const api = {
    openExternal(url) { opened.push(url); },
  };
  const result = await open.openModule("mark-touch-sent", api);
  assert.equal(result.ok, true);
  assert.equal(result.via, "github");
  assert.deepEqual(opened, [
    "https://github.com/beginner-work/tinker/blob/main/exercises/mark-touch-sent.js",
  ]);
  assert.equal(open.isDesktopShell(api), false);
  assert.equal(
    open.isDesktopShell({ openExerciseModule() {}, isDesktopApp: true }),
    true
  );
});

test("renderer openModule opens Formation externally", async () => {
  const open = loadOpen();
  const opened = [];
  const result = await open.openModule("formation-persistent-storage", {
    openExternal(url) { opened.push(url); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, "external");
  assert.deepEqual(opened, ["https://formation.dev"]);
});

test("renderer openModule uses the desktop bridge when present", async () => {
  const open = loadOpen();
  const result = await open.openModule("pacific-wall-time", {
    isDesktopApp: true,
    openExerciseModule(id) {
      return Promise.resolve({ ok: true, via: "desktop", id });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, "desktop");
  assert.equal(result.id, "pacific-wall-time");
});

test("ensureLabRepo clones when missing and pulls when present", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tinker-ex-"));
  const clonePath = path.join(tmp, "tinker");
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
  const rootDir = "/tmp/tinker";
  assert.equal(
    lab.moduleAbsPath(
      rootDir,
      "pacific-wall-time",
      ["pacific-wall-time"],
      "exercises/pacific-wall-time.js"
    ),
    path.join(rootDir, "exercises", "pacific-wall-time.js")
  );
  assert.throws(
    () => lab.moduleAbsPath(rootDir, "../secret", ["pacific-wall-time"]),
    /Unknown exercise module/
  );
  assert.throws(
    () => lab.moduleAbsPath(rootDir, "nope", ["pacific-wall-time"]),
    /Unknown exercise module/
  );
});

test("desktop shell exposes exercises IPC bridges", () => {
  assert.match(preload, /openExerciseModule/);
  assert.match(preload, /getExerciseLabSettings/);
  assert.match(preload, /setExerciseLabSettings/);
  assert.match(preload, /pickExerciseLabPath/);
  assert.match(preload, /beginner-work\/tinker/);
  assert.equal(/tlindow\/lindowlabs/.test(preload), false);
  assert.match(mainJs, /exercises:openModule/);
  assert.match(mainJs, /exercises:getSettings/);
  assert.match(mainJs, /exercises:setSettings/);
  assert.match(mainJs, /exercises-lab\.json/);
  assert.match(settingsJs, /getExerciseLabSettings/);
  assert.match(settingsJs, /setExerciseLabSettings/);
  assert.match(settingsHtml, /data-exercises-clone-path/);
  assert.match(settingsHtml, /data-exercises-ide-command/);
  assert.match(settingsHtml, /id="settings-exercises"/);
  assert.match(settingsHtml, /beginner-work\/tinker/);
  assert.match(settingsHtml, /~\/tinker/);
  const exercisesSection = settingsHtml.slice(
    settingsHtml.indexOf('id="settings-exercises"'),
    settingsHtml.indexOf('id="settings-outreach"')
  );
  assert.ok(exercisesSection.length > 50);
  assert.equal(/lindowlabs/i.test(exercisesSection), false);
  assert.equal(/tlindow\//i.test(exercisesSection), false);
});
