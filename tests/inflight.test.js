/* In-flight view removed from Tinker; tracking lives in Notion. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const redirect = fs.readFileSync(path.join(root, "src/renderer/repo-redirect.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "src/renderer/auth.js"), "utf8");
const repoHtml = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const repoCss = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const releaseNotes = fs.readFileSync(path.join(root, ".release-notes"), "utf8");

test("inflight route, API, and renderer are gone", () => {
  assert.equal(fs.existsSync(path.join(root, "api/inflight.js")), false);
  assert.equal(fs.existsSync(path.join(root, "api/_lib/inflight-agents.js")), false);
  assert.equal(fs.existsSync(path.join(root, "src/renderer/inflight")), false);
  assert.doesNotMatch(vercel, /"\/inflight"/);
  assert.doesNotMatch(sw, /\/inflight/);
  assert.doesNotMatch(auth, /\/inflight/);
});

test("signed-in landing is /repo on desktop and mobile", () => {
  assert.match(redirect, /location\.replace\("\/repo"\)/);
  assert.doesNotMatch(redirect, /\/inflight/);
  assert.doesNotMatch(redirect, /max-width:\s*720px/);
  assert.match(shell, /goRepoHome/);
  assert.match(shell, /location\.assign\("\/repo"\)/);
  assert.doesNotMatch(shell, /\/inflight/);
});

test("top bar has no In flight entry; tinker mark opens left drawer", () => {
  assert.doesNotMatch(repoHtml, /repo-inflight-link|repo-top__inflight/);
  assert.doesNotMatch(repoHtml, /In flight/);
  assert.doesNotMatch(repoCss, /\.repo-top__inflight/);
  assert.match(repoHtml, /id="repo-labs-link"/);
  assert.match(repoHtml, /aria-label="Technical essays"/);
  assert.match(repoHtml, /tinker-mark\.svg/);
  assert.doesNotMatch(repoHtml, /M18\.657 21\.485/);
  assert.doesNotMatch(repoHtml, /FlaskConical|beaker/i);
  assert.match(repoHtml, /id="repo-past-essays"/);
  assert.match(repoHtml, /repo-layout--learning/);
  assert.match(repoHtml, /data-technical-essays-nav/);
  assert.match(repoCss, /\.repo-top__labs/);
  assert.match(repoHtml, /tinker-mark\.svg/);
});

test("CURSOR_API_KEY remains documented as unused and harmless", () => {
  assert.match(envExample, /CURSOR_API_KEY/);
  assert.match(envExample, /unused|Notion|Harmless/i);
});

test("release notes first line is no-download web update", () => {
  const first = releaseNotes.split(/\r?\n/, 1)[0].trim();
  assert.equal(first, "No download needed, updates on next launch");
  assert.doesNotMatch(releaseNotes, /\u2014/);
});
