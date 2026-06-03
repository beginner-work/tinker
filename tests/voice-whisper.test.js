/* Voice recording + server-transcription engine tests.
 *
 * MediaRecorder and the network only exist in the browser, so we drive the
 * record→upload→transcribe state machine (createRecorderController) and the
 * upload helper (transcribeViaServer) with fakes. What we pin: the
 * idle→listening→working→idle lifecycle, that the recorded clip flows into a
 * final transcript, that the mic stream is released, that mic/transcription
 * failures surface as errors, and that the upload maps HTTP status to codes.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  createRecorderController,
  transcribeViaServer,
  isSupported,
} = require("../src/renderer/voice-whisper.js");

class FakeRecorder {
  constructor(stream) {
    this.stream = stream;
    this.mimeType = "audio/mp4";
    this.started = false;
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
  }
  start() {
    this.started = true;
  }
  stop() {
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

test("isSupported needs MediaRecorder + getUserMedia", () => {
  assert.equal(isSupported({}), false);
  assert.equal(isSupported({ MediaRecorder: function () {}, navigator: {} }), false);
  assert.equal(
    isSupported({
      MediaRecorder: function () {},
      navigator: { mediaDevices: { getUserMedia: function () {} } },
    }),
    true
  );
});

test("records, uploads, and emits the final transcript", async () => {
  const { controller, events, stream } = makeController();
  controller.start();
  await tick();
  assert.equal(controller.state, "listening");
  assert.equal(events.recorder.started, true);

  controller.stop();
  assert.equal(events.states.includes("working"), true, "should enter the uploading state");
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
    transcribe: () => Promise.reject(Object.assign(new Error("nope"), { name: "transcribe-failed" })),
  });
  controller.start();
  await tick();
  controller.stop();
  await tick();
  await tick();
  assert.deepEqual(events.errors, ["transcribe-failed"]);
  assert.equal(controller.state, "idle");
});

test("taps are ignored while uploading/transcribing", async () => {
  let recorders = 0;
  const { controller } = makeController({
    createRecorder: (s) => {
      recorders++;
      return new FakeRecorder(s);
    },
    transcribe: () => new Promise(() => {}), // hang in "working"
  });
  controller.start();
  await tick();
  controller.stop();
  await tick();
  assert.equal(controller.state, "working");
  controller.toggle();
  await tick();
  assert.equal(controller.state, "working");
  assert.equal(recorders, 1);
});

// ── transcribeViaServer ──────────────────────────────────────────────────────

function fakeFetch(status, body) {
  return function (url, init) {
    fakeFetch.last = { url, init };
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  };
}

test("transcribeViaServer returns the text and sends the bearer token", async () => {
  const fetchImpl = fakeFetch(200, { text: "hello there" });
  const blob = { type: "audio/mp4" };
  const text = await transcribeViaServer(blob, { fetch: fetchImpl, token: "sess_123" });
  assert.equal(text, "hello there");
  assert.equal(fakeFetch.last.init.headers.Authorization, "Bearer sess_123");
  assert.equal(fakeFetch.last.init.headers["Content-Type"], "audio/mp4");
  assert.equal(fakeFetch.last.url, "/api/transcribe");
});

test("transcribeViaServer maps 401 to an unauthorized error", async () => {
  const fetchImpl = fakeFetch(401, { error: "Missing token." });
  await assert.rejects(
    () => transcribeViaServer({ type: "audio/webm" }, { fetch: fetchImpl }),
    (err) => err.name === "unauthorized"
  );
});

test("transcribeViaServer maps other failures to transcribe-failed", async () => {
  const fetchImpl = fakeFetch(502, { error: "upstream boom" });
  await assert.rejects(
    () => transcribeViaServer({ type: "audio/webm" }, { fetch: fetchImpl }),
    (err) => err.name === "transcribe-failed" && /upstream boom/.test(err.message)
  );
});
