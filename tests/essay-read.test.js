/* Rendered essay read view: Markdown → HTML, sanitize, questions toggle. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const essayRead = require("../src/renderer/lib/essay-read.js");
const repoHtml = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const feedHtml = fs.readFileSync(path.join(root, "src/renderer/feed/index.html"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const repoJs = fs.readFileSync(path.join(root, "src/renderer/repo/repo.js"), "utf8");
const rendererJs = fs.readFileSync(path.join(root, "src/renderer/renderer.js"), "utf8");
const feedJs = fs.readFileSync(path.join(root, "src/renderer/feed/feed.js"), "utf8");

test("## Title renders as h2 with no hash character", () => {
  const html = essayRead.renderMarkdown("## Title\n\nHello **world**");
  assert.match(html, /<h2>Title<\/h2>/);
  assert.doesNotMatch(html, /#\s*Title/);
  assert.match(html, /<strong>world<\/strong>/);
  assert.doesNotMatch(html, /\*\*world\*\*/);
});

test("headings, lists, links, blockquotes, code, and paragraphs render", () => {
  const src = [
    "# One",
    "",
    "A paragraph with *italic* and **bold**.",
    "",
    "- item one",
    "- item two",
    "",
    "> quoted line",
    "",
    "Visit [tinker](https://example.com).",
    "",
    "`inline`",
    "",
    "```",
    "code block",
    "```",
  ].join("\n");
  const html = essayRead.renderMarkdown(src);
  assert.match(html, /<h1>One<\/h1>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul>[\s\S]*<li>item one<\/li>/);
  assert.match(html, /<blockquote>[\s\S]*quoted line/);
  assert.match(html, /<a href="https:\/\/example\.com">tinker<\/a>/);
  assert.match(html, /<code>inline<\/code>/);
  assert.match(html, /<pre>[\s\S]*code block/);
  assert.doesNotMatch(html, /##\s*Title|#\s*One/);
  assert.doesNotMatch(html, /\*\*bold\*\*/);
  assert.doesNotMatch(html, /(^|[^*])\*italic\*(?!\*)/);
});

test("sanitizer blocks script tags and onerror handlers", () => {
  const withScript = essayRead.renderMarkdown('<script>alert(1)</script>\n\nHello');
  assert.doesNotMatch(withScript, /<script/i);
  assert.match(withScript, /Hello/);

  const withImg = essayRead.renderMarkdown('<img src=x onerror=alert(1)>');
  // Raw HTML must not execute: tag is escaped, never a live <img … onerror>.
  assert.doesNotMatch(withImg, /<img\b[^>]*\bonerror\b/i);
  assert.doesNotMatch(withImg, /<img\b/i);
  assert.match(withImg, /&lt;img/);

  const withJsLink = essayRead.renderMarkdown("[x](javascript:alert(1))");
  assert.doesNotMatch(withJsLink, /href=["']javascript:/i);

  const cleaned = essayRead.sanitize(
    '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>'
  );
  assert.doesNotMatch(cleaned, /<script/i);
  assert.doesNotMatch(cleaned, /<img\b[^>]*\bonerror\b/i);
  assert.match(cleaned, /<p>ok<\/p>/);
});

test("extractQuestions finds pad blockquotes and interview ### markers", () => {
  const md = [
    "# Essay",
    "",
    "Lead-in.",
    "",
    "> What are you noticing about this?",
    "",
    "My answer.",
    "",
    "### What comes next for you?",
    "",
    "More writing.",
  ].join("\n");
  const qs = essayRead.extractQuestions(md);
  assert.deepEqual(qs, [
    "What are you noticing about this?",
    "What comes next for you?",
  ]);
  assert.equal(essayRead.hasQuestions(md), true);
  assert.equal(essayRead.hasQuestions("# Only prose\n\nNo prompts."), false);
});

test("questions toggle is off by default and hidden when none", () => {
  const withQs = [
    "Open with a note.",
    "",
    "> What shifted?",
    "",
    "The pace.",
  ].join("\n");
  const shellOff = essayRead.renderShellHtml({
    markdown: withQs,
    showQuestions: false,
  });
  assert.match(shellOff, /Show questions/);
  assert.match(shellOff, /aria-pressed="false"/);
  assert.doesNotMatch(shellOff, /data-essay-q|repo-pad__q/);
  assert.doesNotMatch(shellOff, /What shifted\?/);
  assert.match(shellOff, /The pace/);
  assert.doesNotMatch(shellOff, />\s*What shifted/);

  const shellOn = essayRead.renderShellHtml({
    markdown: withQs,
    showQuestions: true,
  });
  assert.match(shellOn, /Hide questions/);
  assert.match(shellOn, /aria-pressed="true"/);
  assert.match(shellOn, /repo-pad__q/);
  assert.match(shellOn, /What shifted\?/);
  assert.match(shellOn, /The pace/);

  const none = essayRead.renderShellHtml({
    markdown: "## Quiet\n\nNo session prompts here.",
    showQuestions: false,
  });
  assert.doesNotMatch(none, /Show questions|Hide questions/);
  assert.doesNotMatch(none, /essay-read__questions-toggle/);
  assert.match(none, /<h2>Quiet<\/h2>/);
  assert.doesNotMatch(none, /#\s*Quiet/);
});

test("detached questions list falls back above the essay", () => {
  const html = essayRead.renderEssayHtml({
    markdown: "Just the finished prose.",
    showQuestions: true,
    questions: ["Where does this land?", "What feels unfinished?"],
  });
  assert.match(html, /essay-read__q-list/);
  assert.match(html, /Where does this land\?/);
  assert.match(html, /What feels unfinished\?/);
  assert.match(html, /Just the finished prose/);
});

test("mount starts with toggle off and reveals stored questions when turned on", () => {
  const dom = new JSDOM("<!doctype html><div id='host'></div>");
  const host = dom.window.document.getElementById("host");
  const md = "Intro.\n\n> What are you learning?\n\nI am learning to slow down.";
  const api = essayRead.mount(host, { markdown: md, showQuestions: false });
  assert.equal(api.getShowQuestions(), false);
  assert.equal(api.hasQuestions(), true);
  assert.match(host.innerHTML, /Show questions/);
  assert.doesNotMatch(host.innerHTML, /repo-pad__q/);
  assert.doesNotMatch(host.innerHTML, /What are you learning\?/);

  const btn = host.querySelector(".essay-read__questions-toggle");
  assert.ok(btn);
  btn.dispatchEvent(new dom.window.Event("click"));
  assert.equal(api.getShowQuestions(), true);
  assert.match(host.innerHTML, /repo-pad__q/);
  assert.match(host.innerHTML, /What are you learning\?/);
  assert.match(host.innerHTML, /I am learning to slow down/);

  // Fresh essay resets toggle off.
  api.setMarkdown("## Other\n\n> Second prompt?\n\nAnswer.");
  assert.equal(api.getShowQuestions(), false);
  assert.match(host.innerHTML, /Show questions/);
  assert.doesNotMatch(host.innerHTML, /Second prompt\?/);
});

test("mount hides the toggle when the session has no questions", () => {
  const dom = new JSDOM("<!doctype html><div id='host'></div>");
  const host = dom.window.document.getElementById("host");
  essayRead.mount(host, {
    markdown: "## Title\n\nOnly the essay body.",
    showQuestions: false,
  });
  assert.equal(host.querySelector(".essay-read__questions-toggle"), null);
  assert.match(host.innerHTML, /<h2>Title<\/h2>/);
});

test("UI copy has no em dashes", () => {
  assert.doesNotMatch(essayRead.renderShellHtml({
    markdown: "> Q?\n\nA",
    showQuestions: false,
  }), /\u2014/);
  assert.doesNotMatch(repoJs, /Show questions[\s\S]{0,40}\u2014/);
  assert.doesNotMatch(rendererJs, /Show questions[\s\S]{0,40}\u2014/);
});

test("repo / feed / shell wire essay-read + vendor scripts", () => {
  assert.match(repoHtml, /id="repo-essay-view"/);
  assert.match(repoHtml, /src="\/vendor\/markdown-it\.min\.js"/);
  assert.match(repoHtml, /src="\/vendor\/purify\.min\.js"/);
  assert.match(repoHtml, /src="\/lib\/essay-read\.js\?v=1"/);
  assert.match(repoHtml, /src="\/repo\/repo\.js\?v=49"/);
  assert.match(repoHtml, /href="\/repo\/repo\.css\?v=50"/);

  assert.match(feedHtml, /src="\/vendor\/markdown-it\.min\.js"/);
  assert.match(feedHtml, /src="\/lib\/essay-read\.js\?v=1"/);
  assert.match(feedJs, /tinkerEssayRead/);
  assert.match(feedJs, /mountFeedEssayBody|renderEssayHtml/);

  assert.match(indexHtml, /vendor\/markdown-it\.min\.js/);
  assert.match(indexHtml, /lib\/essay-read\.js\?v=1/);
  assert.match(rendererJs, /tinkerEssayRead/);
  assert.match(rendererJs, /paintReadEssay|Show questions|showQuestions:\s*false/);

  assert.match(repoJs, /tinkerEssayRead/);
  assert.match(repoJs, /showEssayReadView/);
  assert.match(repoJs, /isEssayReadMode/);
  assert.equal(repoJs.includes("innerHTML"), false);
});

test("vendor builds are present for CSP self scripts", () => {
  const mdPath = path.join(root, "src/renderer/vendor/markdown-it.min.js");
  const purifyPath = path.join(root, "src/renderer/vendor/purify.min.js");
  assert.ok(fs.existsSync(mdPath));
  assert.ok(fs.existsSync(purifyPath));
  assert.ok(fs.statSync(mdPath).size > 1000);
  assert.ok(fs.statSync(purifyPath).size > 1000);
});
