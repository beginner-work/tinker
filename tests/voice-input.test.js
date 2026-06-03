/* Voice-to-text dictation tests.
 *
 * Two layers, matching how the repo tests renderer code:
 *
 *   1. Behavioural unit tests of the pure pieces — the recognition state
 *      machine (createVoiceController) and the transcript merge
 *      (mergeTranscript) — driven with a fake SpeechRecognition. The Web
 *      Speech API only exists in the browser, so the fake stands in.
 *   2. Structural contract tests (like welcome-shell.test.js): the shipped
 *      source must keep the mic wired — script loaded in index.html, the
 *      eligible writing fields present, and the styling shipped — so a diff
 *      that quietly unwires dictation fails CI.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createVoiceController,
  mergeTranscript,
  ELIGIBLE,
} = require("../src/renderer/voice-input.js");

// ── Fake recognition ───────────────────────────────────────────────────────

class FakeRecognition {
  constructor() {
    this.started = false;
    this.stopped = false;
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
  }
  start() {
    this.started = true;
    if (this.onstart) this.onstart();
  }
  stop() {
    this.stopped = true;
    if (this.onend) this.onend();
  }
  emitResult(chunks) {
    const results = chunks.map((c) => {
      const arr = [{ transcript: c.transcript }];
      arr.isFinal = !!c.isFinal;
      return arr;
    });
    this.onresult({ resultIndex: 0, results });
  }
  emitError(code) {
    this.onerror({ error: code });
  }
}

// ── createVoiceController ────────────────────────────────────────────────────

test("controller starts idle and transitions to listening", () => {
  let rec;
  const states = [];
  const ctrl = createVoiceController({
    createRecognition: () => (rec = new FakeRecognition()),
    onState: (s) => states.push(s),
  });
  assert.equal(ctrl.state, "idle");
  ctrl.start();
  assert.equal(rec.started, true);
  assert.equal(ctrl.state, "listening");
  assert.deepEqual(states, ["listening"]);
});

test("controller forwards interim then final results", () => {
  let rec;
  const results = [];
  const ctrl = createVoiceController({
    createRecognition: () => (rec = new FakeRecognition()),
    onResult: (r) => results.push(r),
  });
  ctrl.start();
  rec.emitResult([{ transcript: "the seed", isFinal: false }]);
  rec.emitResult([{ transcript: "the seed of an idea", isFinal: true }]);
  assert.deepEqual(results[0], { interim: "the seed", final: "" });
  assert.deepEqual(results[1], { interim: "", final: "the seed of an idea" });
});

test("controller stop ends the session and returns to idle", () => {
  let rec;
  const ctrl = createVoiceController({
    createRecognition: () => (rec = new FakeRecognition()),
  });
  ctrl.start();
  ctrl.stop();
  assert.equal(rec.stopped, true);
  assert.equal(ctrl.state, "idle");
});

test("controller toggle flips start and stop", () => {
  const recs = [];
  const ctrl = createVoiceController({
    createRecognition: () => {
      const r = new FakeRecognition();
      recs.push(r);
      return r;
    },
  });
  ctrl.toggle();
  assert.equal(ctrl.state, "listening");
  ctrl.toggle();
  assert.equal(ctrl.state, "idle");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].stopped, true);
});

test("controller surfaces recognition errors", () => {
  let rec;
  const errors = [];
  const ctrl = createVoiceController({
    createRecognition: () => (rec = new FakeRecognition()),
    onError: (c) => errors.push(c),
  });
  ctrl.start();
  rec.emitError("not-allowed");
  assert.deepEqual(errors, ["not-allowed"]);
});

test("controller primes the mic, then starts recognition once granted", async () => {
  let rec;
  let stopped = false;
  const stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };
  const ctrl = createVoiceController({
    createRecognition: () => (rec = new FakeRecognition()),
    requestMic: () => Promise.resolve(stream),
  });
  ctrl.start();
  // Recognition must not start until the mic permission resolves.
  assert.equal(rec, undefined);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(rec, "recognition should start after the mic is granted");
  assert.equal(rec.started, true);
  assert.equal(stopped, true, "the primer stream should be released");
  assert.equal(ctrl.state, "listening");
});

test("controller surfaces a denied mic prompt as an error and stays idle", async () => {
  const errors = [];
  const ctrl = createVoiceController({
    createRecognition: () => new FakeRecognition(),
    requestMic: () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })),
    onError: (c) => errors.push(c),
  });
  ctrl.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(errors, ["NotAllowedError"]);
  assert.equal(ctrl.state, "idle");
});

test("controller catches a synchronous start() throw and stays idle", () => {
  // Several browsers throw straight out of .start() (InvalidStateError,
  // NotAllowedError). That must not bubble out of the click — it should
  // surface as an error and leave the controller usable.
  const errors = [];
  const ctrl = createVoiceController({
    createRecognition: () => ({
      start() {
        const e = new Error("blocked");
        e.name = "NotAllowedError";
        throw e;
      },
    }),
    onError: (c) => errors.push(c),
  });
  assert.doesNotThrow(() => ctrl.start());
  assert.equal(ctrl.state, "idle");
  assert.deepEqual(errors, ["NotAllowedError"]);
});

// ── mergeTranscript ──────────────────────────────────────────────────────────

test("mergeTranscript renders interim after the committed base", () => {
  const out = mergeTranscript("I was at the", { interim: "cafe", final: "" });
  assert.deepEqual(out, { value: "I was at the cafe", base: "I was at the" });
});

test("mergeTranscript commits a final result into the new base", () => {
  const out = mergeTranscript("I was at the", { interim: "", final: "cafe today" });
  assert.deepEqual(out, { value: "I was at the cafe today", base: "I was at the cafe today" });
});

test("mergeTranscript handles an empty base without a leading space", () => {
  assert.deepEqual(mergeTranscript("", { interim: "hello", final: "" }), {
    value: "hello",
    base: "",
  });
  assert.deepEqual(mergeTranscript("", { interim: "", final: "hello there" }), {
    value: "hello there",
    base: "hello there",
  });
});

// ── Structural contract ──────────────────────────────────────────────────────

const RENDERER = path.join(__dirname, "..", "src", "renderer");
const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
const css = fs.readFileSync(path.join(RENDERER, "styles.css"), "utf8");

test("index.html loads the voice-input script", () => {
  assert.match(html, /src="\.\/voice-input\.js"/, "voice-input.js is not loaded in index.html");
});

test("the eligible dictation fields exist in the renderer", () => {
  // The selector the mic follows must keep matching real fields.
  assert.match(html, /id="welcome-input"/, "welcome-input is missing");
  assert.match(html, /id="status-composer-input"/, "status-composer-input is missing");
  assert.equal(
    ELIGIBLE.includes(".writing-input"),
    true,
    "the guided writing flow input class dropped out of the eligible selector"
  );
});

test("styles.css ships the mic button styling", () => {
  assert.match(css, /\.voice-mic\b/, ".voice-mic styling is missing");
  assert.match(css, /voice-mic--listening/, "listening state styling is missing");
});
