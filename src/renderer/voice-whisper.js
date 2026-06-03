/* tinker — in-browser speech-to-text (Whisper via transformers.js)
 *
 * A free, private fallback for browsers where the Web Speech API doesn't
 * work — most importantly Safari, which refuses SpeechRecognition even with
 * the microphone granted. Instead of asking the browser to transcribe, we
 * record a short clip (MediaRecorder) and run OpenAI's open-source Whisper
 * model *on the device* with Hugging Face's transformers.js. No API key, no
 * server, no audio ever leaving the machine — at the cost of a one-time
 * model download (cached afterwards) and "record then transcribe" rather
 * than live word-by-word.
 *
 * The library and model are fetched lazily from a CDN the first time voice
 * is used, so the app pays nothing until a founder actually dictates.
 *
 * Exposed as window.TinkerWhisper. The recorder state machine
 * (createRecorderController) takes injected dependencies so it can be unit
 * tested without a microphone, MediaRecorder, or the model.
 */

(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TinkerWhisper = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // Pinned so a CDN-side major bump can't silently change behaviour. tiny.en
  // is ~40MB quantized — the smallest usable English model; bump to base.en
  // for more accuracy at ~3x the download.
  const LIB_URL = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
  const MODEL = "Xenova/whisper-tiny.en";
  const TARGET_RATE = 16000; // Whisper expects 16 kHz mono

  function isSupported(win) {
    win = win || (typeof window !== "undefined" ? window : null);
    if (!win) return false;
    const md = win.navigator && win.navigator.mediaDevices;
    return !!(
      win.MediaRecorder &&
      md &&
      typeof md.getUserMedia === "function" &&
      typeof win.WebAssembly !== "undefined"
    );
  }

  // ── Model loading (browser only) ──────────────────────────────────────

  let transcriberPromise = null;

  // Lazily import transformers.js and build the ASR pipeline. Cached: the
  // model downloads once, then every call resolves instantly.
  function loadTranscriber() {
    if (transcriberPromise) return transcriberPromise;
    transcriberPromise = (async function () {
      const mod = await import(/* @vite-ignore */ LIB_URL);
      const pipeline = mod.pipeline;
      const env = mod.env;
      // Keep it single-threaded and worker-free: that avoids needing
      // SharedArrayBuffer / cross-origin isolation (COOP+COEP), which would
      // break the app's other cross-origin resources.
      env.allowLocalModels = false;
      if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.proxy = false;
      }
      return pipeline("automatic-speech-recognition", MODEL);
    })();
    return transcriberPromise;
  }

  // Kick the download off early (e.g. when a field is focused) so the model
  // is ready by the time the founder finishes speaking. Failures are
  // swallowed — the real attempt will surface them.
  function warmup() {
    try {
      loadTranscriber().catch(function () {});
    } catch (e) {
      /* ignore */
    }
  }

  async function transcribe(samples) {
    const transcriber = await loadTranscriber();
    const out = await transcriber(samples);
    if (!out) return "";
    return (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) || "";
  }

  // Decode a recorded Blob to a 16 kHz mono Float32Array, the shape Whisper
  // wants. Uses the browser's own decoder (handles Safari's audio/mp4 and
  // Chrome's audio/webm alike) then resamples with an OfflineAudioContext.
  async function decodeBlob(blob, win) {
    win = win || (typeof window !== "undefined" ? window : null);
    const AudioCtx = win.AudioContext || win.webkitAudioContext;
    const OfflineCtx = win.OfflineAudioContext || win.webkitOfflineAudioContext;
    const arrayBuffer = await blob.arrayBuffer();

    const decodeCtx = new AudioCtx();
    let decoded;
    try {
      decoded = await decodeCtx.decodeAudioData(arrayBuffer);
    } finally {
      if (typeof decodeCtx.close === "function") decodeCtx.close();
    }

    if (decoded.sampleRate === TARGET_RATE && decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0);
    }

    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const offline = new OfflineCtx(1, frames, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  }

  // ── Recorder state machine (testable) ─────────────────────────────────

  /**
   * Record → transcribe lifecycle with the same surface as the Web Speech
   * controller (start/stop/toggle/state + onState/onResult/onError), so the
   * mic glue can drive either engine. States: idle → listening (recording) →
   * working (transcribing) → idle.
   *
   * @param {Object} opts
   * @param {() => Promise<MediaStream>} opts.getUserMedia
   * @param {(stream: any) => any} opts.createRecorder  → MediaRecorder-like
   * @param {(blob: Blob) => Promise<Float32Array>} opts.decode
   * @param {(samples: Float32Array) => Promise<string>} opts.transcribe
   */
  function createRecorderController(opts) {
    const getUserMedia = opts.getUserMedia;
    const createRecorder = opts.createRecorder;
    const decode = opts.decode;
    const transcribe = opts.transcribe;
    const BlobCtor = opts.Blob || (typeof Blob !== "undefined" ? Blob : null);
    const onState = opts.onState || function () {};
    const onResult = opts.onResult || function () {};
    const onError = opts.onError || function () {};

    let state = "idle";
    let recorder = null;
    let stream = null;
    let chunks = [];

    function setState(next) {
      if (state === next) return;
      state = next;
      onState(state);
    }

    function releaseStream() {
      try {
        if (stream && typeof stream.getTracks === "function") {
          stream.getTracks().forEach(function (t) {
            if (t && typeof t.stop === "function") t.stop();
          });
        }
      } catch (e) {
        /* ignore */
      }
      stream = null;
    }

    function fail(code) {
      releaseStream();
      recorder = null;
      onError(code);
      setState("idle");
    }

    function finish() {
      setState("working");
      const type = (recorder && recorder.mimeType) || (chunks[0] && chunks[0].type) || "audio/webm";
      let blob;
      try {
        blob = new BlobCtor(chunks, { type: type });
      } catch (e) {
        return fail("encode-failed");
      }
      releaseStream();
      recorder = null;
      Promise.resolve(blob)
        .then(decode)
        .then(transcribe)
        .then(function (text) {
          onResult({ interim: "", final: (text || "").trim() });
          setState("idle");
        })
        .catch(function (err) {
          fail((err && (err.name || err.message)) || "transcribe-failed");
        });
    }

    function start() {
      if (state !== "idle") return;
      Promise.resolve()
        .then(getUserMedia)
        .then(function (granted) {
          stream = granted;
          chunks = [];
          recorder = createRecorder(stream);
          recorder.ondataavailable = function (e) {
            if (e && e.data && (e.data.size === undefined || e.data.size > 0)) chunks.push(e.data);
          };
          recorder.onerror = function (e) {
            fail((e && e.error && e.error.name) || "record-failed");
          };
          recorder.onstop = function () {
            finish();
          };
          recorder.start();
          setState("listening");
        })
        .catch(function (err) {
          fail((err && (err.name || err.message)) || "not-allowed");
        });
    }

    function stop() {
      if (state !== "listening") return;
      try {
        if (recorder && typeof recorder.stop === "function") recorder.stop();
      } catch (e) {
        fail("stop-failed");
      }
    }

    function toggle() {
      if (state === "listening") stop();
      else if (state === "idle") start();
      // "working" (transcribing) ignores taps.
    }

    return {
      start: start,
      stop: stop,
      toggle: toggle,
      get state() {
        return state;
      },
    };
  }

  return {
    LIB_URL: LIB_URL,
    MODEL: MODEL,
    isSupported: isSupported,
    warmup: warmup,
    transcribe: transcribe,
    decodeBlob: decodeBlob,
    loadTranscriber: loadTranscriber,
    createRecorderController: createRecorderController,
  };
});
