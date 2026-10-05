/* Writing-column top safe-area + question scroll-target math. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scroll = require("../src/renderer/lib/repo-write-scroll.js");

const ROOT = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "src/renderer/repo/repo.css"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "src/renderer/repo/index.html"), "utf8");
const page = fs.readFileSync(path.join(ROOT, "src/renderer/repo/repo.js"), "utf8");

test("desktop safe top clears the Electron titlebar + traffic-light band", () => {
  const top = scroll.resolveWriteSafeTopPx({ isDesktop: true, safeAreaInsetTop: 0 });
  assert.equal(top, scroll.WRITE_SCROLL.DESKTOP_TITLEBAR_PX + scroll.WRITE_SCROLL.DESKTOP_PAD_PX);
  assert.ok(top >= 52, "must clear trafficLightPosition y≈18");
});

test("phone safe top includes notch inset on top of the base pad", () => {
  assert.equal(
    scroll.resolveWriteSafeTopPx({ isPhone: true, safeAreaInsetTop: 47 }),
    scroll.WRITE_SCROLL.PHONE_BASE_PX + 47,
  );
  assert.equal(
    scroll.resolveWriteSafeTopPx({ isPhone: true, safeAreaInsetTop: 0 }),
    scroll.WRITE_SCROLL.PHONE_BASE_PX,
  );
});

test("web safe top stays modest without desktop chrome", () => {
  assert.equal(scroll.resolveWriteSafeTopPx({}), scroll.WRITE_SCROLL.WEB_BASE_PX);
  assert.equal(
    scroll.resolveWriteSafeTopPx({ safeAreaInsetTop: 20 }),
    scroll.WRITE_SCROLL.WEB_BASE_PX + 20,
  );
});

test("question scroll target lands at or below the safe-area offset", () => {
  const safeTop = 64;
  const questionTop = 800;
  const top = scroll.computeQuestionScrollTop({
    questionTop,
    safeTop,
    prevBottom: 790,
    lineHeight: 26,
  });
  // After scroll, question viewport Y = questionTop - top >= safeTop
  assert.ok(questionTop - top >= safeTop - 0.5, "question top at/below safe area");
  assert.equal(top, questionTop - safeTop);
});

test("partial previous line snaps fully away instead of peeking", () => {
  const safeTop = 64;
  const questionTop = 500;
  // Previous turn ends just above the question. Aligning question to safeTop
  // would leave only a thin band of previous text (one sliced line).
  const prevBottom = 450;
  const aligned = questionTop - safeTop; // 436
  assert.ok(prevBottom - aligned > 0 && prevBottom - aligned < 26 * 1.5);
  const top = scroll.computeQuestionScrollTop({
    questionTop,
    safeTop,
    prevBottom,
    lineHeight: 26,
  });
  assert.ok(top >= prevBottom, "previous paragraph fully above the fold");
  assert.ok(questionTop - top >= 0);
});

test("full previous paragraphs keep question aligned to safe top", () => {
  const safeTop = 64;
  const questionTop = 900;
  // Previous block ends well above the aligned viewport top — no partial peek.
  const prevBottom = 700;
  const top = scroll.computeQuestionScrollTop({
    questionTop,
    safeTop,
    prevBottom,
    lineHeight: 26,
  });
  assert.equal(top, questionTop - safeTop);
  assert.ok(prevBottom <= top, "previous block fully above the viewport top");
  assert.equal(questionTop - top, safeTop);
});

test("write page applies the safe-area class and fade overlay", () => {
  assert.match(html, /repo-center[^>]*repo-write-safe-top/);
  assert.match(html, /repo-write-scroll\.js/);
  assert.match(css, /\.repo-center\.repo-write-safe-top::before/);
  assert.match(css, /--repo-write-safe-top/);
  assert.match(css, /--repo-write-fade/);
  assert.match(css, /linear-gradient\(\s*to bottom/);
  assert.match(
    css,
    /html\[data-tinker-desktop\][\s\S]*--repo-write-safe-top:\s*calc\(\s*64px/,
  );
});

test("focusLastPadTurn uses safe-area scroll math instead of crude caret scroll", () => {
  assert.match(page, /tinkerRepoWriteScroll/);
  assert.match(page, /scrollQuestionIntoSafeView/);
  assert.match(page, /computeQuestionScrollTop/);
  assert.match(page, /resolveWriteSafeTopPx/);
  assert.doesNotMatch(
    page,
    /ta\.getBoundingClientRect\(\)\.bottom - \(window\.innerHeight \* 0\.72\)/,
  );
});
