/* tinker — voice recording + server-side transcription
 *
 * The browser-native Web Speech API doesn't work on Safari, and running a
 * speech model in the page proved too heavy/fragile on phones. So for those
 * browsers we record a short clip (MediaRecorder) and POST it to
 * /api/transcribe, which runs it through a Whisper API server-side and
 * returns the text. Reliable on iPhone Safari, fast, and the page never
 * needs an external CDN or a relaxed CSP.
 *
 * Exposed as window.TinkerWhisper. The recorder state machine
 * (createRecorderController) takes injected dependencies so it can be unit
 * tested without a microphone, MediaRecorder, or the network.
 */

(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TinkerWhisper = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const ENDPOINT = "/api/transcribe";

  function isSupported(win) {
    win = win || (typeof window !== "undefined" ? window : null);
    if (!win) return false;
    const md = win.navigator && win.navigator.mediaDevices;
    return !!(win.MediaRecorder && md && typeof md.getUserMedia === "function");
  }

  // Upload a recorded clip and get the transcript back. The blob is sent as
  // the raw request body; the server reads Content-Type to know the format.
  function transcribeViaServer(blob, opts) {
    opts = opts || {};
    const fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error("no-fetch"));
    const url = opts.url || ENDPOINT;
    const headers = {};
    if (blob && blob.type) headers["Content-Type"] = blob.type;
    if (opts.token) headers["Authorization"] = "Bearer " + opts.token;

    return fetchImpl(url, { method: "POST", headers: headers, body: blob }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!res.ok) {
            const err = new Error((data && (data.error || data.detail)) || "HTTP " + res.status);
            err.name = res.status === 401 ? "unauthorized" : "transcribe-failed";
            throw err;
          }
          return (data && data.text) || "";
        });
    });
  }

  /**
   * Record → transcribe lifecycle with the same surface as the Web Speech
   * controller (start/stop/toggle/state + onState/onResult/onError), so the
   * mic glue can drive either engine. States: idle → listening (recording) →
   * working (uploading + transcribing) → idle.
   *
   * @param {Object} opts
   * @param {() => Promise<MediaStream>} opts.getUserMedia
   * @param {(stream: any) => any} opts.createRecorder  → MediaRecorder-like
   * @param {(blob: Blob) => Promise<string>} opts.transcribe
   * @param {(blob: Blob) => (Blob|Promise<Blob>)} [opts.decode]  identity by default
   */
  function createRecorderController(opts) {
    const getUserMedia = opts.getUserMedia;
    const createRecorder = opts.createRecorder;
    const transcribe = opts.transcribe;
    const decode = opts.decode || function (blob) { return blob; };
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

    function fail(code, detail) {
      releaseStream();
      recorder = null;
      onError(code, detail);
      setState("idle");
    }

    function finish() {
      setState("working");
      const type = (recorder && recorder.mimeType) || (chunks[0] && chunks[0].type) || "audio/webm";
      let blob;
      try {
        blob = new BlobCtor(chunks, { type: type });
      } catch (e) {
        return fail("encode-failed", e && e.message);
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
          fail((err && err.name) || "transcribe-failed", err && err.message);
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
          fail((err && err.name) || "not-allowed", err && err.message);
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
      // "working" (uploading/transcribing) ignores taps.
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
    ENDPOINT: ENDPOINT,
    isSupported: isSupported,
    transcribeViaServer: transcribeViaServer,
    createRecorderController: createRecorderController,
  };
});
