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

test("previous peek stays under the fade; question never rises into the titlebar", () => {
  const safeTop = 64;
  const questionTop = 500;
  // Previous turn ends just above the question. Aligning to safeTop leaves
  // prior text only in the fade band — covered by the fixed overlay, not
  // snapped away (snapping would pull the question under the traffic lights).
  const prevBottom = 450;
  const top = scroll.computeQuestionScrollTop({
    questionTop,
    safeTop,
    prevBottom,
    lineHeight: 26,
    fadePx: 48,
  });
  assert.equal(top, questionTop - safeTop);
  assert.equal(questionTop - top, safeTop);
  assert.ok(prevBottom - top > 0 && prevBottom - top <= safeTop);
});

test("full previous paragraphs keep question aligned to safe top", () => {
  const safeTop = 64;
  const questionTop = 900;
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
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /--repo-write-safe-top/);
  assert.match(css, /--repo-write-fade/);
  assert.match(css, /linear-gradient\(\s*to bottom/);
  assert.match(css, /scroll-margin-top:\s*var\(--repo-write-safe-top/);
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

test("panel question scroll keeps prior text above the question and clears the foot", () => {
  const clientH = 280;
  const foot = 64;
  const prevBottom = 200;
  const questionOffsetTop = 210;
  const questionHeight = 72;
  const maxScroll = 600;
  const top = scroll.computePanelQuestionScrollTop({
    questionOffsetTop,
    questionHeight,
    prevOffsetBottom: prevBottom,
    containerClientHeight: clientH,
    topPadding: 8,
    bottomReserved: foot,
    maxScroll,
  });
  // Previous turn end sits at/near the top of the scrollport.
  assert.equal(top, prevBottom - 8);
  // Question fully above the foot reserve after scroll.
  assert.ok(questionOffsetTop - top >= 0, "question not above scrollport");
  assert.ok(
    questionOffsetTop + questionHeight - top <= clientH - foot + 0.5,
    "question clears sticky foot",
  );
  // Prior text is still in the visible band (not scrolled away under a fake safe-top).
  assert.ok(prevBottom - top <= 16, "latest typed lines remain near the top");
});

test("panel scroll never covers essay text by parking at titlebar safe-top", () => {
  // Short panel + tall prior turn: prefer showing prev bottom + question, not
  // a 64px window safe-top that would clip mid-paragraph over the card.
  const top = scroll.computePanelQuestionScrollTop({
    questionOffsetTop: 400,
    questionHeight: 80,
    prevOffsetBottom: 390,
    containerClientHeight: 278,
    topPadding: 8,
    bottomReserved: 64,
    maxScroll: 900,
  });
  assert.equal(top, 382); // 390 - 8
  assert.ok(400 - top > 8, "question below prior text in flow");
  assert.ok(top !== 400 - 64, "must not use window titlebar safe-top math");
});

test("short panel prefers foot clearance when prior text + question cannot both fit", () => {
  const clientH = 152;
  const foot = 70;
  const qTop = 246;
  const qH = 70;
  const top = scroll.computePanelQuestionScrollTop({
    questionOffsetTop: qTop,
    questionHeight: qH,
    prevOffsetBottom: 236,
    containerClientHeight: clientH,
    topPadding: 8,
    bottomReserved: foot,
    maxScroll: 400,
  });
  assert.ok(
    qTop + qH - top <= clientH - foot + 0.5,
    "question stays above sticky foot in a short panel",
  );
  assert.ok(top >= qTop + qH - (clientH - foot) - 0.5);
});

test("bottom-panel CSS keeps question in flow and reserves foot clearance", () => {
  assert.match(css, /--repo-panel-foot-clearance:\s*64px/);
  assert.match(
    css,
    /\.repo-panel__write\s+\.repo-pad__turn:last-of-type\s*\{[^}]*min-height:\s*6rem/s,
  );
  assert.match(
    css,
    /\.repo-panel__write\s+\.repo-pad__q\s*\{[^}]*position:\s*static/s,
  );
  assert.match(
    css,
    /\.repo-panel__write\s+\.repo-pad\s*\{[^}]*flex:\s*0\s+0\s+auto/s,
  );
  assert.match(
    css,
    /\.repo-panel__write\s+\.repo-surface\.writing\s*\{[^}]*padding:\s*12px\s+20px\s+var\(--repo-panel-foot-clearance\)/s,
  );
  assert.match(
    css,
    /\.repo-panel__write\s*>\s*\.repo-surface__foot\s*\{[^}]*position:\s*absolute/s,
  );
  assert.match(
    css,
    /\.repo-panel__write\s+\.repo-location\s*\{[^}]*position:\s*relative/s,
  );
  assert.match(page, /computePanelQuestionScrollTop/);
  assert.match(page, /findWriteScrollContainer/);
});
