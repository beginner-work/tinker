/* Adaptive pad action reveal timing — pure delay math. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const reveal = require("../src/renderer/lib/repo-pad-reveal.js");

test("cold start uses the default delay before enough samples", () => {
  assert.equal(reveal.computeRevealDelayMs([]), reveal.PAD_REVEAL.DEFAULT_DELAY_MS);
  assert.equal(reveal.computeRevealDelayMs([100, 120, 110, 90]), reveal.PAD_REVEAL.DEFAULT_DELAY_MS);
  assert.equal(reveal.PAD_REVEAL.MIN_SAMPLES, 5);
});

test("fast typing yields a short delay clamped at the minimum", () => {
  // 80ms median × 4 = 320 → clamp to 600
  const gaps = [70, 80, 75, 90, 85, 80, 78];
  const delay = reveal.computeRevealDelayMs(gaps);
  assert.equal(delay, reveal.PAD_REVEAL.MIN_DELAY_MS);
  assert.ok(delay >= 600 && delay <= 4000);
});

test("slow typing yields a longer delay within clamps", () => {
  // median([500,550,600,650,700]) = 600 → 600×4 = 2400
  const gaps = [500, 550, 600, 650, 700];
  const delay = reveal.computeRevealDelayMs(gaps);
  assert.equal(delay, 2400);
});

test("very slow gaps clamp at the maximum delay", () => {
  // 2000ms median × 4 = 8000 → clamp to 4000
  const gaps = [1900, 2100, 2000, 2050, 1950];
  assert.equal(reveal.computeRevealDelayMs(gaps), reveal.PAD_REVEAL.MAX_DELAY_MS);
});

test("recordGap keeps a rolling window and ignores long pauses", () => {
  let gaps = [];
  let lastAt = 0;
  let t = 1000;
  for (let i = 0; i < 25; i++) {
    t += 100;
    const next = reveal.recordGap(gaps, lastAt, t);
    gaps = next.gaps;
    lastAt = next.lastAt;
  }
  assert.equal(gaps.length, reveal.PAD_REVEAL.GAP_WINDOW);
  assert.ok(gaps.every((g) => g === 100));

  // 15s pause is ignored; next gap after resume still starts fresh.
  const afterPause = reveal.recordGap(gaps, lastAt, lastAt + 15000);
  assert.equal(afterPause.gaps.length, gaps.length);
  const resumed = reveal.recordGap(afterPause.gaps, afterPause.lastAt, afterPause.lastAt + 120);
  assert.equal(resumed.gaps[resumed.gaps.length - 1], 120);
});

test("config knobs live in one PAD_REVEAL object", () => {
  assert.equal(reveal.PAD_REVEAL.MULTIPLIER, 4);
  assert.equal(reveal.PAD_REVEAL.MIN_DELAY_MS, 600);
  assert.equal(reveal.PAD_REVEAL.MAX_DELAY_MS, 4000);
  assert.equal(reveal.PAD_REVEAL.DEFAULT_DELAY_MS, 1500);
  assert.equal(reveal.PAD_REVEAL.GAP_WINDOW, 20);
  assert.equal(reveal.PAD_REVEAL.MAX_GAP_MS, 10000);
});

test("isTypingKey and isRevealResetKey treat modifiers and Cmd+Enter correctly", () => {
  assert.equal(reveal.isTypingKey({ key: "a" }), true);
  assert.equal(reveal.isTypingKey({ key: "Backspace" }), true);
  assert.equal(reveal.isTypingKey({ key: "Enter" }), true);
  assert.equal(reveal.isTypingKey({ key: "a", metaKey: true }), false);
  assert.equal(reveal.isTypingKey({ key: "Shift" }), false);
  assert.equal(reveal.isRevealResetKey({ key: "a" }), true);
  assert.equal(reveal.isRevealResetKey({ key: "Meta" }), false);
  assert.equal(reveal.isRevealResetKey({ key: "Enter", metaKey: true }), false);
  assert.equal(reveal.isRevealResetKey({ key: "Enter", ctrlKey: true }), false);
});
