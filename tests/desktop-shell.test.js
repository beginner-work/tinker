/* Structural contract for the Electron desktop shell.
 *
 * The Mac app must load production Tinker in a hardened BrowserWindow
 * (not a quiet-browser / local file shell), keep notes-folder IPC, and
 * never revive address-bar search or <webview> browsing.
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

test("preload keeps notes folder bridges and drops quiet-browser search", () => {
  assert.match(preloadJs, /pickNotesFolder/);
  assert.match(preloadJs, /listNotesFiles/);
  assert.match(preloadJs, /isDesktopApp:\s*true/);
  assert.doesNotMatch(preloadJs, /searchQuery/);
});

test("platform-mobile merges Electron bridges instead of overwriting", () => {
  assert.match(platformJs, /Object\.assign/);
  assert.match(platformJs, /supportsWebview|isDesktopApp/);
  assert.match(platformJs, /callClaude/);
  assert.match(platformJs, /existing/);
});

test("packaging targets universal Mac dmg named tinker-mac", () => {
  assert.match(builderYml, /artifactName:\s*tinker-mac\.\$\{ext\}/);
  assert.match(builderYml, /arch:\s*universal/);
  assert.match(builderYml, /identity:\s*null/);
  assert.match(builderYml, /src\/main\/\*\*\/\*/);
});

test("release marker matches package version; workflows publish on marker", () => {
  assert.equal(marker, pkg.version);
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
