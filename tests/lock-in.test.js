/* Lock-in countdown + overlay contract. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = (() => {
  try { return require("jsdom"); }
  catch { return { JSDOM: null }; }
})();

const root = path.join(__dirname, "..");
const lockIn = require("../src/renderer/lib/lock-in.js");
const lockInUi = require("../src/renderer/lib/lock-in-ui.js");
const uiSrc = fs.readFileSync(
  path.join(root, "src/renderer/lib/lock-in-ui.js"),
  "utf8"
);

test("countdown ticks descend and complete", () => {
  assert.deepEqual(lockIn.countdownTicks(3), [3, 2, 1]);
  const seen = [];
  let done = false;
  const timers = [];
  const runner = lockIn.runCountdown({
    seconds: 2,
    tickMs: 10,
    setTimeoutFn(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeoutFn() {},
    onTick(n) { seen.push(n); },
    onDone() { done = true; },
  });
  assert.deepEqual(seen, [2]);
  timers[0]();
  assert.deepEqual(seen, [2, 1]);
  timers[1]();
  assert.equal(done, true);
  runner.cancel();
});

test("cancel prevents onDone", () => {
  let done = false;
  const timers = [];
  const runner = lockIn.runCountdown({
    seconds: 3,
    tickMs: 10,
    setTimeoutFn(fn) {
      timers.push(fn);
      return 1;
    },
    clearTimeoutFn() {},
    onTick() {},
    onDone() { done = true; },
  });
  runner.cancel();
  timers.forEach((fn) => fn());
  assert.equal(done, false);
});

test("soft chime uses AudioContext when provided", () => {
  const calls = [];
  const ctx = {
    currentTime: 0,
    createOscillator() {
      return {
        type: "",
        frequency: {
          setValueAtTime() { calls.push("freq"); },
          exponentialRampToValueAtTime() { calls.push("freq-ramp"); },
        },
        connect() { calls.push("osc-connect"); },
        start() { calls.push("start"); },
        stop() { calls.push("stop"); },
      };
    },
    createGain() {
      return {
        gain: {
          setValueAtTime() { calls.push("gain"); },
          exponentialRampToValueAtTime() { calls.push("gain-ramp"); },
        },
        connect() { calls.push("gain-connect"); },
      };
    },
    destination: {},
  };
  assert.equal(lockIn.playSoftChime(ctx), true);
  assert.ok(calls.includes("start"));
  assert.equal(lockIn.playSoftChime(null), false);
});

test("lock-in UI markup includes leave control and motions", () => {
  assert.match(uiSrc, /Not now/);
  assert.match(uiSrc, /tinker-lock-in-arrive/);
  assert.match(uiSrc, /tinker-lock-in-drift/);
  assert.match(uiSrc, /tinker-lock-in-progress/);
  assert.match(uiSrc, /lock-in__leave/);
  assert.match(uiSrc, /You left off|Pick up where you left off|resumeLabel/);
});

test("lock-in UI can mount in a document and leave early", () => {
  if (!JSDOM) {
    // jsdom is not a dependency; exercise ensureStyles + startLockIn via a shim.
    const doc = {
      head: { appendChild() {} },
      body: {
        children: [],
        appendChild(node) { this.children.push(node); },
      },
      getElementById() { return null; },
      createElement(tag) {
        const node = {
          tagName: tag,
          style: {},
          attributes: {},
          children: [],
          textContent: "",
          hidden: false,
          parentNode: null,
          setAttribute(k, v) { this.attributes[k] = v; },
          appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
          },
          remove() {
            if (this.parentNode) {
              this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
              this.parentNode = null;
            }
          },
          addEventListener(type, fn) {
            this["on" + type] = fn;
          },
        };
        if (tag === "style") node.textContent = "";
        return node;
      },
    };
    global.document = doc;
    let left = false;
    const session = lockInUi.startLockIn({
      name: "Stripe PaymentIntent (test mode)",
      resumeLabel: "You left off at README.md",
      lockIn: {
        runCountdown({ onTick, onDone }) {
          onTick(3);
          return { cancel() {} };
        },
        playSoftChime() { return false; },
      },
      onLeave() { left = true; },
      onComplete() { assert.fail("should not complete"); },
    });
    assert.ok(session.root);
    assert.equal(session.root.attributes["aria-modal"], "true");
    const leave = session.root.children[1].children.find(
      (c) => c.className === "lock-in__leave"
    );
    leave.onclick();
    assert.equal(left, true);
    delete global.document;
    return;
  }
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
  global.document = dom.window.document;
  let left = false;
  const session = lockInUi.startLockIn({
    name: "Demo",
    resumeLabel: "You left off at notes.ts",
    lockIn: {
      runCountdown({ onTick }) {
        onTick(2);
        return { cancel() {} };
      },
      playSoftChime() { return true; },
    },
    onLeave() { left = true; },
  });
  const btn = dom.window.document.querySelector(".lock-in__leave");
  btn.click();
  assert.equal(left, true);
  delete global.document;
});
