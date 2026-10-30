/* TinkerVoice — embeddable browser recorder for speech-to-text.
 *
 * Posts recorded audio to a host-provided endpoint. The browser never
 * sees ELEVENLABS_API_KEY or TINKER_SERVICE_TOKEN: point `endpoint` at
 * your own proxy (e.g. lindowlabs.dev → Tinker POST /api/transcribe).
 *
 * Public API:
 *
 *   const rec = TinkerVoice.create({
 *     mount: "#ask-voice",          // element or selector (optional)
 *     endpoint: "/api/voice-proxy", // required for embeds
 *     headers: { },                 // or () => ({ Authorization: "…" })
 *     fieldName: "audio",
 *     onTranscript: (result) => {}, // { text, words, durationMs, requestId }
 *     onError: (err) => {},
 *     onStateChange: (state) => {}, // idle | recording | uploading | error
 *     labelIdle: "Ask by voice",
 *     labelStop: "Stop",
 *     labelUploading: "Listening…",
 *   });
 *   rec.start();
 *   rec.stop();
 *   rec.destroy();
 *   rec.getState();
 *
 * Works as a classic <script> tag (sets window.TinkerVoice) or as a
 * CommonJS module for tests.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TinkerVoice = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULTS = {
    endpoint: "/api/transcribe",
    fieldName: "audio",
    labelIdle: "Ask by voice",
    labelStop: "Stop",
    labelUploading: "Listening…",
    mimeCandidates: [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ],
  };

  function resolveMount(mount) {
    if (!mount) return null;
    if (typeof mount === "string") {
      if (typeof document === "undefined") return null;
      return document.querySelector(mount);
    }
    return mount;
  }

  function pickMimeType(MediaRecorderCtor, candidates) {
    if (!MediaRecorderCtor || typeof MediaRecorderCtor.isTypeSupported !== "function") {
      return "";
    }
    for (var i = 0; i < candidates.length; i += 1) {
      if (MediaRecorderCtor.isTypeSupported(candidates[i])) return candidates[i];
    }
    return "";
  }

  function extensionForMime(mime) {
    var base = String(mime || "").split(";")[0].toLowerCase();
    if (base.indexOf("ogg") >= 0) return "ogg";
    if (base.indexOf("mp4") >= 0 || base.indexOf("m4a") >= 0) return "mp4";
    if (base.indexOf("wav") >= 0) return "wav";
    return "webm";
  }

  function create(options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    if (typeof opts.onTranscript !== "function") {
      throw new Error("TinkerVoice.create requires onTranscript");
    }
    if (!opts.endpoint || typeof opts.endpoint !== "string") {
      throw new Error("TinkerVoice.create requires endpoint");
    }

    var state = "idle";
    var mediaStream = null;
    var mediaRecorder = null;
    var chunks = [];
    var destroyed = false;
    var rootEl = null;
    var buttonEl = null;
    var statusEl = null;
    var ownedDom = false;

    function setState(next) {
      if (destroyed) return;
      state = next;
      if (buttonEl) {
        if (next === "recording") buttonEl.textContent = opts.labelStop;
        else if (next === "uploading") buttonEl.textContent = opts.labelUploading;
        else buttonEl.textContent = opts.labelIdle;
        buttonEl.disabled = next === "uploading";
        buttonEl.setAttribute("aria-pressed", next === "recording" ? "true" : "false");
      }
      if (statusEl && next === "idle") statusEl.textContent = "";
      if (typeof opts.onStateChange === "function") {
        try { opts.onStateChange(next); } catch (e) { /* ignore */ }
      }
    }

    function fail(err) {
      var error = err instanceof Error ? err : new Error(String(err || "Voice failed"));
      setState("error");
      if (typeof opts.onError === "function") {
        try { opts.onError(error); } catch (e) { /* ignore */ }
      }
      setState("idle");
    }

    function resolveHeaders() {
      if (typeof opts.headers === "function") {
        return opts.headers() || {};
      }
      return opts.headers && typeof opts.headers === "object" ? opts.headers : {};
    }

    function cleanupStream() {
      if (mediaRecorder) {
        try {
          if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") {
            mediaRecorder.stop();
          }
        } catch (e) { /* ignore */ }
      }
      mediaRecorder = null;
      if (mediaStream) {
        mediaStream.getTracks().forEach(function (t) {
          try { t.stop(); } catch (e) { /* ignore */ }
        });
      }
      mediaStream = null;
      chunks = [];
    }

    function upload(blob, mimeType) {
      setState("uploading");
      var form = new FormData();
      var filename = "recording." + extensionForMime(mimeType);
      form.append(opts.fieldName || "audio", blob, filename);

      var headers = resolveHeaders();
      // Let the browser set multipart boundary; do not set Content-Type.
      var fetchHeaders = {};
      Object.keys(headers).forEach(function (key) {
        if (/^content-type$/i.test(key)) return;
        fetchHeaders[key] = headers[key];
      });

      return fetch(opts.endpoint, {
        method: "POST",
        headers: fetchHeaders,
        body: form,
        credentials: opts.credentials || "same-origin",
      }).then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) {
            throw new Error((json && json.error) || ("Transcribe failed (" + res.status + ")"));
          }
          return json;
        }).catch(function (err) {
          if (err && err.message && /Transcribe failed/.test(err.message)) throw err;
          if (!res.ok) throw new Error("Transcribe failed (" + res.status + ")");
          throw err;
        });
      }).then(function (json) {
        setState("idle");
        opts.onTranscript({
          text: json && typeof json.text === "string" ? json.text : "",
          words: json && Array.isArray(json.words) ? json.words : [],
          durationMs: json && typeof json.durationMs === "number" ? json.durationMs : null,
          requestId: json && json.requestId ? String(json.requestId) : "",
        });
      }).catch(function (err) {
        fail(err);
      });
    }

    function start() {
      if (destroyed) return Promise.reject(new Error("destroyed"));
      if (state === "recording" || state === "uploading") {
        return Promise.resolve();
      }
      if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        fail(new Error("Microphone is not available in this browser."));
        return Promise.reject(new Error("Microphone is not available in this browser."));
      }
      var MR = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
      if (!MR) {
        fail(new Error("MediaRecorder is not available in this browser."));
        return Promise.reject(new Error("MediaRecorder is not available in this browser."));
      }

      return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        mediaStream = stream;
        chunks = [];
        var mimeType = pickMimeType(MR, opts.mimeCandidates || DEFAULTS.mimeCandidates);
        try {
          mediaRecorder = mimeType ? new MR(stream, { mimeType: mimeType }) : new MR(stream);
        } catch (e) {
          mediaRecorder = new MR(stream);
        }
        var usedMime = mediaRecorder.mimeType || mimeType || "audio/webm";
        mediaRecorder.ondataavailable = function (ev) {
          if (ev && ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        mediaRecorder.onerror = function () {
          fail(new Error("Recording failed."));
          cleanupStream();
        };
        mediaRecorder.onstop = function () {
          var blob = new Blob(chunks, { type: usedMime });
          cleanupStream();
          if (!blob.size) {
            fail(new Error("No audio captured."));
            return;
          }
          upload(blob, usedMime);
        };
        mediaRecorder.start();
        setState("recording");
      }).catch(function (err) {
        cleanupStream();
        fail(err && err.name === "NotAllowedError"
          ? new Error("Microphone permission was denied.")
          : err || new Error("Could not start recording."));
      });
    }

    function stop() {
      if (destroyed) return;
      if (!mediaRecorder || state !== "recording") return;
      try {
        if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") {
          mediaRecorder.stop();
        }
      } catch (e) {
        fail(e);
        cleanupStream();
      }
    }

    function toggle() {
      if (state === "recording") stop();
      else if (state === "idle" || state === "error") start();
    }

    function mountUi() {
      var mount = resolveMount(opts.mount);
      if (!mount || typeof document === "undefined") return;
      rootEl = document.createElement("div");
      rootEl.className = "tinker-voice";
      rootEl.setAttribute("data-tinker-voice", "1");

      buttonEl = document.createElement("button");
      buttonEl.type = "button";
      buttonEl.className = "tinker-voice__btn";
      buttonEl.textContent = opts.labelIdle;
      buttonEl.setAttribute("aria-pressed", "false");
      buttonEl.addEventListener("click", toggle);

      statusEl = document.createElement("p");
      statusEl.className = "tinker-voice__status";
      statusEl.setAttribute("aria-live", "polite");

      rootEl.appendChild(buttonEl);
      rootEl.appendChild(statusEl);
      mount.appendChild(rootEl);
      ownedDom = true;

      var prevOnTranscript = opts.onTranscript;
      var prevOnError = opts.onError;
      opts.onTranscript = function (result) {
        if (statusEl) statusEl.textContent = result && result.text ? result.text : "(no speech detected)";
        prevOnTranscript(result);
      };
      opts.onError = function (err) {
        if (statusEl) statusEl.textContent = (err && err.message) || "Voice failed";
        if (typeof prevOnError === "function") prevOnError(err);
      };
    }

    function destroy() {
      destroyed = true;
      cleanupStream();
      if (ownedDom && rootEl && rootEl.parentNode) {
        rootEl.parentNode.removeChild(rootEl);
      }
      rootEl = null;
      buttonEl = null;
      statusEl = null;
      state = "idle";
    }

    if (opts.mount) mountUi();

    return {
      start: start,
      stop: stop,
      toggle: toggle,
      destroy: destroy,
      getState: function () { return state; },
    };
  }

  return {
    create: create,
    // Test hooks
    _pickMimeType: pickMimeType,
    _extensionForMime: extensionForMime,
  };
});
