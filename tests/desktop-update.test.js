/**
 * Unit tests for the desktop shell update check.
 *
 * Detection: GitHub latest release body first line must be exactly
 * "Download needed", and tag semver must be newer than the installed app.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mod = require(path.join(root, "src/main/lib/desktop-update.js"));
const releaseYml = fs.readFileSync(
  path.join(root, ".github/workflows/release.yml"),
  "utf8"
);
const releaseNotes = fs.readFileSync(path.join(root, ".release-notes"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");

test("release notes first line is Download needed for this shell cut", () => {
  assert.equal(mod.releaseNotesFirstLine(releaseNotes), mod.DOWNLOAD_NEEDED_LINE);
  assert.equal(mod.isDownloadNeededRelease(releaseNotes), true);
});

test("workflow requires machine-checkable release notes first line", () => {
  assert.match(releaseYml, /Download needed/);
  assert.match(releaseYml, /No download needed, updates on next launch/);
  assert.match(releaseYml, /\.release-notes/);
  assert.match(releaseYml, /--notes-file/);
});

test("main + preload expose desktop update check and inject toolbar button", () => {
  assert.match(mainJs, /desktop-update/);
  assert.match(mainJs, /ensureDesktopUpdateCheck|checkDesktopUpdate/);
  assert.match(mainJs, /tinker-desktop-update/);
  assert.match(mainJs, /Update available: download v/);
  assert.match(mainJs, /app:checkDesktopUpdate/);
  assert.match(preloadJs, /checkDesktopUpdate/);
});

test("isDownloadNeededRelease matches exact first line only", () => {
  assert.equal(mod.isDownloadNeededRelease("Download needed\n\nShell change."), true);
  assert.equal(
    mod.isDownloadNeededRelease("No download needed, updates on next launch\n\nWeb only."),
    false
  );
  assert.equal(mod.isDownloadNeededRelease("download needed\n"), false);
  assert.equal(mod.isDownloadNeededRelease(" Download needed \n"), true);
  assert.equal(mod.isDownloadNeededRelease("tinker desktop v0.1.18"), false);
  assert.equal(mod.isDownloadNeededRelease(""), false);
});

test("isNewerVersion compares semver tags", () => {
  assert.equal(mod.isNewerVersion("0.1.19", "0.1.18"), true);
  assert.equal(mod.isNewerVersion("v0.1.19", "0.1.19"), false);
  assert.equal(mod.isNewerVersion("0.1.17", "0.1.18"), false);
  assert.equal(mod.isNewerVersion("0.2.0", "0.1.99"), true);
  assert.equal(mod.isNewerVersion("bad", "0.1.0"), false);
});

test("pickDownloadUrl prefers OS installer assets", () => {
  const release = {
    html_url: "https://github.com/beginner-work/tinker/releases/tag/v0.1.19",
    tag_name: "v0.1.19",
    assets: [
      { name: "tinker-mac.dmg", browser_download_url: "https://example.com/mac.dmg" },
      { name: "tinker-0.1.19-x64.exe", browser_download_url: "https://example.com/win.exe" },
      {
        name: "tinker-0.1.19-x64-portable.exe",
        browser_download_url: "https://example.com/portable.exe",
      },
      {
        name: "tinker-0.1.19-x86_64.AppImage",
        browser_download_url: "https://example.com/appimage",
      },
    ],
  };
  assert.equal(mod.pickDownloadUrl(release, "darwin"), "https://example.com/mac.dmg");
  assert.equal(mod.pickDownloadUrl(release, "win32"), "https://example.com/win.exe");
  assert.equal(mod.pickDownloadUrl(release, "linux"), "https://example.com/appimage");
});

test("checkDesktopUpdate returns null when notes say no download needed", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        tag_name: "v9.9.9",
        body: "No download needed, updates on next launch\n\nWeb only.",
        html_url: "https://github.com/beginner-work/tinker/releases/tag/v9.9.9",
        assets: [],
      };
    },
  });
  const result = await mod.checkDesktopUpdate({
    currentVersion: "0.1.0",
    platform: "darwin",
    fetchImpl,
  });
  assert.equal(result, null);
});

test("checkDesktopUpdate returns download when Download needed and newer", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        tag_name: "v0.1.19",
        body: "Download needed\n\nShell button.",
        html_url: "https://github.com/beginner-work/tinker/releases/tag/v0.1.19",
        assets: [
          {
            name: "tinker-mac.dmg",
            browser_download_url: "https://example.com/tinker-mac.dmg",
          },
        ],
      };
    },
  });
  const result = await mod.checkDesktopUpdate({
    currentVersion: "0.1.18",
    platform: "darwin",
    fetchImpl,
  });
  assert.deepEqual(result, {
    version: "0.1.19",
    downloadUrl: "https://example.com/tinker-mac.dmg",
    htmlUrl: "https://github.com/beginner-work/tinker/releases/tag/v0.1.19",
  });
});

test("checkDesktopUpdate returns null when same or older version", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        tag_name: "v0.1.18",
        body: "Download needed\n\nAlready installed.",
        html_url: "https://github.com/beginner-work/tinker/releases/tag/v0.1.18",
        assets: [],
      };
    },
  });
  const result = await mod.checkDesktopUpdate({
    currentVersion: "0.1.18",
    platform: "darwin",
    fetchImpl,
  });
  assert.equal(result, null);
});
