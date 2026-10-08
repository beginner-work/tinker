/* Structural contract for the Electron desktop shell.
 *
 * The Mac app must load production Tinker in a hardened BrowserWindow
 * (not a quiet-browser / local file shell), keep notes-folder IPC, match
 * the web app (auth, routes, fresh deploys), and paint a seamless
 * title-bar surface — never revive address-bar search or <webview>.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
const platformJs = fs.readFileSync(path.join(root, "src/renderer/platform-mobile.js"), "utf8");
const authJs = fs.readFileSync(path.join(root, "src/renderer/auth.js"), "utf8");
const profileJs = fs.readFileSync(path.join(root, "src/renderer/profile.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const builderYml = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const marker = fs.readFileSync(path.join(root, ".release-version"), "utf8").trim();
const releaseYml = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
const markerYml = fs.readFileSync(path.join(root, ".github/workflows/release-on-marker.yml"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

test("desktop shell loads production Tinker in a BrowserWindow", () => {
  assert.match(mainJs, /tinker\.beginner\.work/);
  assert.match(mainJs, /loadURL\(/);
  assert.match(mainJs, /partition:\s*"persist:tinker"/);
  assert.match(mainJs, /contextIsolation:\s*true/);
  assert.match(mainJs, /nodeIntegration:\s*false/);
  assert.match(mainJs, /sandbox:\s*true/);
  assert.match(mainJs, /webviewTag:\s*false/);
  assert.doesNotMatch(mainJs, /loadFile\(/);
  assert.doesNotMatch(mainJs, /search:query|SEARCH_SYSTEM_PROMPT|@anthropic-ai\/sdk/);
  assert.doesNotMatch(mainJs, /webviewTag:\s*true/);
});

test("desktop shell remembers window size and builds native menus", () => {
  assert.match(mainJs, /window-state\.json/);
  assert.match(mainJs, /buildAppMenu|setApplicationMenu/);
  assert.match(mainJs, /Menu\.buildFromTemplate/);
});

test("desktop title bar is seamless with app background", () => {
  assert.match(mainJs, /titleBarStyle:\s*"hiddenInset"/);
  assert.match(mainJs, /trafficLightPosition/);
  assert.match(mainJs, /titleBarOverlay/);
  assert.match(mainJs, /#FFFDF7/);
  assert.match(mainJs, /nativeTheme/);
  assert.match(mainJs, /setBackgroundColor|backgroundColor/);
});

test("desktop session bypasses long-lived HTTP cache and reloads after deploys", () => {
  assert.match(mainJs, /onHeadersReceived/);
  assert.match(mainJs, /Cache-Control/);
  assert.match(mainJs, /no-cache/);
  assert.match(mainJs, /reloadIgnoringCache/);
  assert.match(mainJs, /etag|last-modified/);
  assert.match(mainJs, /win\.on\(\s*"focus"/);
});

test("preload marks desktop document and keeps notes folder bridges", () => {
  assert.match(preloadJs, /pickNotesFolder/);
  assert.match(preloadJs, /listNotesFiles/);
  assert.match(preloadJs, /isDesktopApp:\s*true/);
  assert.match(preloadJs, /data-tinker-desktop|tinker-desktop/);
  assert.doesNotMatch(preloadJs, /searchQuery/);
});

test("desktop CSS chrome is gated so browsers stay unchanged", () => {
  assert.match(stylesCss, /data-tinker-desktop/);
  assert.match(stylesCss, /-webkit-app-region:\s*drag/);
  assert.match(stylesCss, /-webkit-app-region:\s*no-drag/);
  assert.match(stylesCss, /--tinker-desktop-traffic-inset/);
  // Desktop must NOT invent a separate titlebar padding-top — only left inset.
  assert.doesNotMatch(stylesCss, /--tinker-desktop-titlebar/);
  // Default sidebar padding is web-safe; Electron offset is gated to left only.
  assert.match(stylesCss, /\.sidebar__top\s*\{[^}]*padding-top:\s*calc\(env\(safe-area-inset-top/);
  assert.match(
    stylesCss,
    /html\[data-tinker-desktop\][\s\S]*\.sidebar__top[\s\S]*--tinker-desktop-traffic-inset/
  );
  // Must not restyle the whole sidebar as drag (breaks avatar paint) or
  // override messages-pane padding (web/desktop parity).
  assert.doesNotMatch(
    stylesCss,
    /html\[data-tinker-desktop\]\s*\.sidebar\s*,\s*html\.tinker-desktop\s*\.sidebar\s*\{[^}]*-webkit-app-region:\s*drag/
  );
  // Desktop pane top may set drag, but must not override padding.
  assert.doesNotMatch(
    stylesCss,
    /html\[data-tinker-desktop\][^{]*\.messages-pane__top\s*,\s*html\.tinker-desktop\s*\.messages-pane__top\s*\{[^}]*padding/
  );
  // Critical CSS also clears traffic lights via left inset only.
  assert.match(indexHtml, /html\[data-tinker-desktop\][\s\S]*\.sidebar__top[\s\S]*padding-left:\s*78px/);
  assert.doesNotMatch(
    indexHtml,
    /html\[data-tinker-desktop\][\s\S]*\.sidebar__top[\s\S]*padding-top:\s*12px/
  );
});

test("desktop shell inserts chrome CSS and re-marks on navigation", () => {
  assert.match(mainJs, /insertCSS|DESKTOP_CHROME_CSS/);
  assert.match(mainJs, /data-tinker-desktop/);
  assert.match(mainJs, /dom-ready/);
  assert.match(mainJs, /trafficLightPosition:\s*\{\s*x:\s*16,\s*y:\s*18/);
  assert.match(preloadJs, /setInterval|DOMContentLoaded/);
  assert.match(platformJs, /data-tinker-desktop/);
  // insertCSS may only add left inset + drag — not pane/settings padding.
  assert.match(mainJs, /padding-left:\s*78px\s*!important/);
  assert.doesNotMatch(mainJs, /messages-pane__top[\s\S]*padding-top:\s*12px/);
  assert.doesNotMatch(mainJs, /body\.settings-page[\s\S]*padding-top/);
  // Desktop Chrome UA — never bare "linux" / Electron token.
  assert.match(mainJs, /X11; Linux x86_64|Macintosh; Intel Mac OS X/);
  assert.doesNotMatch(mainJs, /Electron\//);
});

test("settings gear has intrinsic size and critical CSS to avoid FOUC", () => {
  assert.match(
    indexHtml,
    /messages-rail__settings-icon"[^>]*width="15"[^>]*height="15"|messages-rail__settings-icon"[^>]*height="15"[^>]*width="15"/
  );
  assert.match(indexHtml, /\.messages-rail__settings-icon\s*\{[^}]*width:\s*15px/);
  assert.match(indexHtml, /\.messages-rail__settings-icon\s*\{[^}]*height:\s*15px/);
});

test("desktop shell uses the same Stytch auth gate as the web app", () => {
  assert.match(authJs, /isDesktopApp/);
  assert.match(authJs, /data-tinker-desktop/);
  assert.doesNotMatch(authJs, /supportsWebview === true\) return false/);
  assert.doesNotMatch(authJs, /ANTHROPIC_API_KEY/);
  assert.match(profileJs, /isDesktopApp/);
  assert.doesNotMatch(profileJs, /supportsWebview === true\) return false/);
});

test("platform-mobile merges Electron bridges instead of overwriting", () => {
  assert.match(platformJs, /Object\.assign/);
  assert.match(platformJs, /supportsWebview|isDesktopApp/);
  assert.match(platformJs, /callClaude/);
  assert.match(platformJs, /existing/);
  assert.match(platformJs, /tinkerApi/);
});

test("platform-mobile installs callClaude when contextBridge freezes window.tinker", () => {
  const vm = require("node:vm");
  const document = {
    documentElement: {
      attrs: {},
      classList: {
        _c: new Set(),
        add(x) { this._c.add(x); },
        remove(x) { this._c.delete(x); },
      },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    },
  };
  const window = {
    localStorage: {
      store: { tinker_jwt: "jwt-test" },
      getItem(k) { return this.store[k] || ""; },
      setItem(k, v) { this.store[k] = String(v); },
      removeItem(k) { delete this.store[k]; },
    },
    document,
  };
  const frozen = Object.freeze({
    version: () => Promise.resolve("0.1.0"),
    platform: () => Promise.resolve("darwin"),
    pickNotesFolder: () => Promise.resolve("/notes"),
    writeNotesFile: () => Promise.resolve(true),
    supportsWebview: true,
    isDesktopApp: true,
  });
  Object.defineProperty(window, "tinker", {
    value: frozen,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  vm.runInNewContext(platformJs, {
    window,
    document,
    Object,
    Promise,
    setTimeout,
    clearTimeout,
    fetch: undefined,
    console,
    Date,
    JSON,
  });

  assert.equal(window.tinker, frozen, "frozen preload tinker must remain");
  assert.equal(typeof window.tinker.callClaude, "undefined");
  assert.equal(typeof window.tinker.pickNotesFolder, "function");
  assert.ok(window.tinkerApi);
  assert.equal(typeof window.tinkerApi.callClaude, "function");
  assert.equal(typeof window.tinkerApi.pickNotesFolder, "function");
  assert.equal(window.tinkerApi.isDesktopApp, true);
});

test("platform-mobile still owns window.tinker on plain web (no preload)", () => {
  const vm = require("node:vm");
  const document = {
    documentElement: {
      attrs: {},
      classList: {
        _c: new Set(),
        add(x) { this._c.add(x); },
        remove(x) { this._c.delete(x); },
      },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    },
  };
  const window = {
    localStorage: {
      store: {},
      getItem(k) { return this.store[k] || ""; },
      setItem(k, v) { this.store[k] = String(v); },
      removeItem(k) { delete this.store[k]; },
    },
    document,
  };

  vm.runInNewContext(platformJs, {
    window,
    document,
    Object,
    Promise,
    setTimeout,
    clearTimeout,
    fetch: undefined,
    console,
    Date,
    JSON,
  });

  assert.equal(typeof window.tinker.callClaude, "function");
  assert.equal(typeof window.tinkerApi.callClaude, "function");
  assert.equal(window.tinker, window.tinkerApi);
  assert.equal(window.tinker.isDesktopApp, false);
});

test("packaging targets universal Mac dmg named tinker-mac", () => {
  assert.match(builderYml, /artifactName:\s*tinker-mac\.\$\{ext\}/);
  assert.match(builderYml, /arch:\s*universal/);
  assert.match(builderYml, /identity:\s*null/);
  assert.match(builderYml, /src\/main\/\*\*\/\*/);
});

test("release marker matches package version; workflows publish on marker", () => {
  assert.equal(marker, pkg.version);
  assert.equal(pkg.version, "0.1.14");
  assert.match(markerYml, /\.release-version/);
  assert.match(markerYml, /publish:\s*true/);
  assert.match(releaseYml, /macos-latest/);
  assert.match(releaseYml, /MAC_CSC_LINK/);
  assert.match(releaseYml, /APPLE_TEAM_ID/);
});

test("README documents Open Anyway and unsigned secrets", () => {
  assert.match(readme, /Open Anyway/);
  assert.match(readme, /unsigned/i);
  assert.match(readme, /MAC_CSC_LINK/);
  assert.match(readme, /APPLE_APP_SPECIFIC_PASSWORD/);
  assert.match(readme, /releases\/latest\/download\/tinker-mac\.dmg/);
  assert.match(readme, /release-on-marker/);
  assert.doesNotMatch(readme, /Focus address bar|falls through to Google/);
});

test("desktop runtime dependency no longer needs Anthropic SDK", () => {
  assert.equal(pkg.dependencies["@anthropic-ai/sdk"], undefined);
  assert.ok(pkg.devDependencies["@anthropic-ai/sdk"]);
  assert.equal(pkg.name, "tinker");
});
