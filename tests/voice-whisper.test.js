/* In-browser Whisper engine tests.
 *
 * The model and MediaRecorder only exist in the browser, so we drive the
 * record→transcribe state machine (createRecorderController) with fakes:
 * a fake getUserMedia, a fake MediaRecorder whose events we fire by hand,
 * and stubbed decode/transcribe steps. What we pin: the
 * idle→listening→working→idle lifecycle, that the recorded audio flows
 * through decode→transcribe into a final transcript, that the mic stream is
 * released, and that permission / transcription failures surface as errors.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createRecorderController, isSupported, MODEL } = require("../src/renderer/voice-whisper.js");

class FakeRecorder {
  constructor(stream) {
    this.stream = stream;
    this.mimeType = "audio/webm";
    this.started = false;
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
  }
  start() {
    this.started = true;
  }
  stop() {
    // Emulate the browser: emit a chunk, then fire onstop.
    if (this.ondataavailable) this.ondataavailable({ data: { size: 3, type: this.mimeType } });
    if (this.onstop) this.onstop();
  }
}

function fakeStream() {
  let stopped = 0;
  return {
    stopped: () => stopped,
    getTracks: () => [{ stop: () => { stopped++; } }],
  };
}

function makeController(over) {
  const stream = fakeStream();
  const events = { states: [], results: [], errors: [] };
  const opts = Object.assign(
    {
      getUserMedia: () => Promise.resolve(stream),
      createRecorder: (s) => (events.recorder = new FakeRecorder(s)),
      decode: () => Promise.resolve(new Float32Array([0.1, 0.2])),
      transcribe: () => Promise.resolve("a quiet idea  "),
      onState: (s) => events.states.push(s),
      onResult: (r) => events.results.push(r),
      onError: (e) => events.errors.push(e),
    },
    over || {}
  );
  return { controller: createRecorderController(opts), events, stream };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("isSupported is false without MediaRecorder / getUserMedia", () => {
  assert.equal(isSupported({}), false);
  assert.equal(
    isSupported({ MediaRecorder: function () {}, WebAssembly: {}, navigator: {} }),
    false
  );
  assert.equal(
    isSupported({
      MediaRecorder: function () {},
      WebAssembly: {},
      navigator: { mediaDevices: { getUserMedia: function () {} } },
    }),
    true
  );
});

test("default model is the small English Whisper", () => {
  assert.match(MODEL, /whisper-tiny\.en/);
});

test("records, transcribes, and emits the final transcript", async () => {
  const { controller, events, stream } = makeController();
  controller.start();
  await tick();
  assert.equal(controller.state, "listening");
  assert.equal(events.recorder.started, true);

  controller.stop();
  // stop → working → decode → transcribe → idle
  assert.equal(events.states.includes("working"), true, "should enter the transcribing state");
  await tick();
  await tick();

  assert.deepEqual(events.results, [{ interim: "", final: "a quiet idea" }]);
  assert.equal(controller.state, "idle");
  assert.equal(stream.stopped(), 1, "the mic stream should be released");
  assert.deepEqual(events.states, ["listening", "working", "idle"]);
});

test("a denied microphone surfaces as an error and stays idle", async () => {
  const { controller, events } = makeController({
    getUserMedia: () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })),
  });
  controller.start();
  await tick();
  assert.deepEqual(events.errors, ["NotAllowedError"]);
  assert.equal(controller.state, "idle");
});

test("a transcription failure surfaces as an error and stays idle", async () => {
  const { controller, events } = makeController({
    transcribe: () => Promise.reject(new Error("model exploded")),
  });
  controller.start();
  await tick();
  controller.stop();
  await tick();
  await tick();
  assert.equal(events.errors.length, 1);
  assert.equal(controller.state, "idle");
});

test("taps are ignored while transcribing", async () => {
  let recorders = 0;
  const { controller } = makeController({
    createRecorder: (s) => {
      recorders++;
      return new FakeRecorder(s);
    },
    // Never resolve transcription, so we stay in "working".
    transcribe: () => new Promise(() => {}),
  });
  controller.start();
  await tick();
  controller.stop(); // → working (transcription hangs)
  await tick();
  assert.equal(controller.state, "working");
  controller.toggle(); // ignored
  await tick();
  assert.equal(controller.state, "working");
  assert.equal(recorders, 1, "no new recording should start while transcribing");
});
