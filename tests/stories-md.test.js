/* Story → Markdown: verbatim body, date+slug names, zip, write guards. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const md = require("../src/renderer/lib/stories-md.js");

test("storyMarkdown is title heading, blank line, then body byte for byte", () => {
  const body = "Merchant portal reliability.... I don't feel comfortable\n\nWhile managing 10 incidents";
  const out = md.storyMarkdown("Merchant portal reliability", body);
  assert.equal(out, "# Merchant portal reliability\n\n" + body);
  // No trimming or newline rewriting of the body.
  const weird = "  leading spaces\r\nkept\n";
  assert.equal(
    md.storyMarkdown("Title", weird),
    "# Title\n\n  leading spaces\r\nkept\n"
  );
});

test("slug and date naming match stories/<YYYY-MM-DD>-<slug>.md", () => {
  assert.equal(md.slugifyTitle("Merchant portal reliability"), "merchant-portal-reliability");
  assert.equal(md.slugifyTitle("affirm.com"), "affirm-com");
  assert.equal(md.slugifyTitle("I'm taking trips to LA"), "im-taking-trips-to-la");
  assert.equal(md.slugifyTitle(""), "untitled");

  // Midday UTC so local TZ cannot shift the calendar day in CI.
  const when = "2026-10-02T17:33:00.000Z";
  const story = { title: "Merchant portal reliability", createdAt: when, body: "x" };
  assert.equal(md.storyFileName(story, new Date(when)), md.storyDate(when) + "-merchant-portal-reliability.md");
  assert.equal(md.storyRelPath(story, new Date(when)), "stories/" + md.storyFileName(story, new Date(when)));
  assert.match(md.storyRelPath(story, new Date(when)), /^stories\/\d{4}-\d{2}-\d{2}-merchant-portal-reliability\.md$/);
});

test("uniqueStoryFiles keeps verbatim markdown and resolves collisions", () => {
  const when = "2026-10-02T17:33:00.000Z";
  const rows = [
    { id: "a", title: "Same", body: "one", createdAt: when },
    { id: "b", title: "Same", body: "two", createdAt: when },
  ];
  const files = md.uniqueStoryFiles(rows, new Date(when));
  assert.equal(files.length, 2);
  assert.equal(files[0].markdown, "# Same\n\none");
  assert.equal(files[1].markdown, "# Same\n\ntwo");
  assert.equal(files[0].relPath, "stories/" + md.storyDate(when) + "-same.md");
  assert.notEqual(files[0].relPath, files[1].relPath);
  assert.match(files[1].relPath, /same-b\.md$|same-.*\.md$/);
});

test("shouldWriteStoryFile skips differing local content", () => {
  assert.equal(md.shouldWriteStoryFile(null, "# A\n\nx"), true);
  assert.equal(md.shouldWriteStoryFile("# A\n\nx", "# A\n\nx"), true);
  assert.equal(md.shouldWriteStoryFile("# A\n\nlocal edit", "# A\n\nx"), false);
  assert.equal(md.needsStoryFileWrite(null, "# A\n\nx"), true);
  assert.equal(md.needsStoryFileWrite("# A\n\nx", "# A\n\nx"), false);
});

test("buildZip returns a zip with local file headers", () => {
  const bytes = md.buildZip([
    { name: "stories/a.md", text: "# A\n\nhello" },
    { name: "stories/b.md", text: "# B\n\nworld" },
  ]);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 40);
  // PK\x03\x04 local header magic
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
  const asText = Buffer.from(bytes).toString("binary");
  assert.match(asText, /stories\/a\.md/);
  assert.match(asText, /stories\/b\.md/);
});

test("inbox chrome is gone; /repo is the landing surface", () => {
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
  const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
  const repoHtml = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
  const filesHtml = fs.readFileSync(path.join(root, "src/renderer/repo/files/index.html"), "utf8");
  const you = fs.readFileSync(path.join(root, "src/renderer/messages-you.js"), "utf8");

  assert.doesNotMatch(html, />Inbox</);
  assert.doesNotMatch(html, /No people yet\./);
  assert.doesNotMatch(html, /sidebar--inbox/);
  assert.match(html, /write-surface|Stories/);
  assert.match(shell, /goRepoHome|\/repo/);
  assert.match(shell, /wantsWriteSurface|write=1/);
  assert.match(mainJs, /\/repo/);
  assert.match(mainJs, /APP_URL[\s\S]*\/repo/);
  assert.match(repoHtml, /href="\/repo\/files"/);
  assert.match(repoHtml, /Files|Stories/);
  assert.match(repoHtml, /Write/);
  assert.match(repoHtml, /id="repo-body"/);
  assert.doesNotMatch(repoHtml, /← Inbox|Inbox/);
  assert.match(filesHtml, /id="repo-tree"/);
  assert.match(filesHtml, /New folder/);
  // Story cards no longer mount above the writing flow.
  assert.match(you, /Stories live on \/repo|Do not render story cards/);
  assert.doesNotMatch(you, /host\.appendChild\(renderSelfPosts/);
  // CDN cache bust for shell scripts that left the inbox / story cards.
  assert.match(html, /messages-shell\.js\?v=\d+/);
  assert.match(html, /messages-you\.js\?v=\d+/);
  assert.match(html, /repo-redirect\.js\?v=\d+/);
});
