/* tinker — voice-to-text transcription
 *
 * Lets a founder dictate instead of type. A single microphone button
 * follows whichever writing field is focused — the welcome seed input,
 * the status composer, and every step of the guided writing flow — and
 * streams speech into it. Transcription runs entirely in the browser via
 * the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`):
 * no audio passes through tinker's serverless functions, no new API key,
 * no new dependency. On browsers without the API (e.g. Firefox) the mic
 * never appears, so nothing breaks.
 *
 * The "follow the focused field" design means dynamically-rendered inputs
 * (the writing flow builds a fresh input per question) are covered for
 * free, with zero coupling to writing.js / freewrite.js — we only listen
 * for focus and reposition one shared button.
 *
 * Loaded as a deferred classic script from src/renderer/index.html. The
 * pure pieces (createVoiceController, mergeTranscript) are also exported
 * for the node:test suite.
 */

(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TinkerVoiceInput = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // Fields that make sense to dictate into. Deliberately narrow: the auth
  // phone/PIN pills, the onboarding name/email, and file pickers are not
  // included — voice there would be noise.
  const ELIGIBLE = "#welcome-input, #status-composer-input, .writing-input";

  const MIC_SVG =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none">' +
    '<rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M6 11a6 6 0 0 0 12 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    '<line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    '<line x1="8.5" y1="21" x2="15.5" y2="21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    "</svg>";

  function errorMessage(code) {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone access was blocked.";
      case "no-speech":
        return "Didn't catch that — try again.";
      case "audio-capture":
      case "NotFoundError":
        return "No microphone was found.";
      case "network":
        return "Voice needs a connection right now.";
      case "InvalidStateError":
        return "Already listening — give it a moment.";
      case "unauthorized":
        return "Sign in to use voice.";
      case "transcribe-failed":
        return "Couldn't transcribe that — try again.";
      case "record-failed":
      case "stop-failed":
      case "encode-failed":
        return "Recording didn't work — try again.";
      default:
        return "Voice input isn't available here.";
    }
  }

  /**
   * Pure speech-recognition lifecycle: a tiny idle⇄listening state machine
   * over a SpeechRecognition-like object. No DOM, so tests drive it with a
   * fake recognition.
   */
  function createVoiceController(opts) {
    const createRecognition = opts.createRecognition;
    const lang = opts.lang || "en-US";
    const onState = opts.onState || function () {};
    const onResult = opts.onResult || function () {};
    const onError = opts.onError || function () {};

    let recognition = null;
    let state = "idle";

    function setState(next) {
      if (state === next) return;
      state = next;
      onState(state);
    }

    // Build the recognition object and start it. Guarded because in several
    // browsers `.start()` (and even touching the object) throws
    // *synchronously* — a second start (InvalidStateError), a blocked mic
    // (NotAllowedError), an insecure context (SecurityError). An uncaught
    // throw here would make the click look like it did nothing.
    function beginRecognition() {
      try {
        recognition = createRecognition();
        recognition.lang = lang;
        recognition.interimResults = true;
        recognition.continuous = false;

        recognition.onstart = function () {
          setState("listening");
        };
        recognition.onresult = function (event) {
          let interim = "";
          let final = "";
          const results = event.results || [];
          for (let i = event.resultIndex || 0; i < results.length; i++) {
            const res = results[i];
            const alt = res && res[0];
            const text = alt && alt.transcript ? alt.transcript : "";
            if (res && res.isFinal) final += text;
            else interim += text;
          }
          onResult({ interim: interim, final: final });
        };
        recognition.onerror = function (event) {
          onError(event && event.error ? event.error : "unknown");
        };
        recognition.onend = function () {
          recognition = null;
          setState("idle");
        };

        recognition.start();
      } catch (err) {
        recognition = null;
        setState("idle");
        onError((err && (err.name || err.message)) || "start-failed");
      }
    }

    // Start synchronously. This is deliberate: Safari only allows
    // SpeechRecognition.start() inside the user's click gesture ("transient
    // activation"), so we must NOT await anything (e.g. a getUserMedia
    // permission prompt) before calling it — doing so loses the gesture and
    // Safari answers "not-allowed". Microphone permission is handled
    // separately, out of band, by the caller.
    function start() {
      if (state === "listening") return;
      beginRecognition();
    }

    function stop() {
      if (recognition && typeof recognition.stop === "function") recognition.stop();
      else setState("idle");
    }

    function toggle() {
      if (state === "listening") stop();
      else start();
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

  /**
   * Fold a recognition result into the field's text. `base` is the text the
   * user had before the current utterance; interim results render after it
   * live, and a final result commits to a new base.
   *
   * @returns {{value: string, base: string}}
   */
  function mergeTranscript(base, result) {
    const prefix = base ? base + " " : "";
    if (result.final) {
      const next = (prefix + result.final).trim();
      return { value: next, base: next };
    }
    return { value: prefix + (result.interim || ""), base: base };
  }

  // ── Browser glue ──────────────────────────────────────────────────────

  function isEligible(el) {
    return !!(el && typeof el.matches === "function" && el.matches(ELIGIBLE));
  }

  /**
   * Mount one shared mic button that follows the focused writing field.
   * Returns null when the Web Speech API is unavailable. Exposed (and
   * returns its internals) so tests can drive it with stubs.
   */
  function initFollowingMic(opts) {
    opts = opts || {};
    const win = opts.win || (typeof window !== "undefined" ? window : null);
    const doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!win || !doc || !doc.body) return null;

    // Pick an engine. Web Speech (live, no download) where it actually works;
    // the in-browser Whisper recorder (record→transcribe) as a fallback —
    // notably on Safari, which exposes SpeechRecognition but refuses to run
    // it even with the mic granted. Whisper also covers Firefox and anywhere
    // Web Speech is missing.
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;
    const Whisper = win.TinkerWhisper;
    const whisperReady = !!(Whisper && Whisper.isSupported && Whisper.isSupported(win));
    const ua = (win.navigator && win.navigator.userAgent) || "";
    const isSafari = /^((?!chrome|chromium|crios|android|fxios|edg|edge|opr).)*safari/i.test(ua);
    const useWhisper = whisperReady && (!SpeechRecognition || isSafari);
    if (!SpeechRecognition && !useWhisper) return null;

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "voice-mic";
    button.setAttribute("aria-label", "Dictate");
    button.setAttribute("aria-pressed", "false");
    button.title = "Dictate";
    button.hidden = true;
    button.innerHTML = MIC_SVG;

    // A visible bubble that sits to the left of the mic (positioned in CSS,
    // relative to the fixed button). Doubles as a polite live region. It
    // stays empty/hidden until there's something to say — "Listening…" or an
    // error — so the user always gets feedback when they press the mic.
    const status = doc.createElement("span");
    status.className = "voice-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    button.appendChild(status);

    doc.body.appendChild(button);

    let target = null; // the field we're dictating into
    let base = ""; // committed text before the live utterance
    let prevPadRight = ""; // field's own padding-right, restored on release
    let statusTimer = null;
    let engaged = false; // mic in use (priming or listening) — don't hide
    const listenLabel = useWhisper ? "Recording… tap to finish" : "Listening…";

    function setStatus(message, isError) {
      if (statusTimer) {
        win.clearTimeout(statusTimer);
        statusTimer = null;
      }
      status.textContent = message || "";
      status.hidden = !message;
      button.classList.toggle("voice-mic--error", !!isError);
      // Errors clear themselves so a stale message doesn't linger.
      if (isError) {
        statusTimer = win.setTimeout(function () {
          status.hidden = true;
          status.textContent = "";
          button.classList.remove("voice-mic--error");
        }, 4000);
      }
    }

    function position() {
      if (!target || button.hidden || typeof target.getBoundingClientRect !== "function") return;
      const r = target.getBoundingClientRect();
      const size = button.offsetWidth || 34;
      // Sit just inside the field's right edge; near the top for tall
      // textareas, vertically centred for single-line inputs.
      const top = r.height > 64 ? r.top + 8 : r.top + (r.height - size) / 2;
      button.style.left = r.right - size - 8 + "px";
      button.style.top = top + "px";
    }

    function bindTarget(el) {
      releasePadding();
      target = el;
      // Reserve room so the glyph never sits on top of the text.
      prevPadRight = el.style.paddingRight || "";
      el.style.paddingRight = "44px";
    }

    function releasePadding() {
      if (target) target.style.paddingRight = prevPadRight;
      prevPadRight = "";
    }

    function show(el) {
      bindTarget(el);
      button.hidden = false;
      position();
    }

    function hide() {
      // Never pull the mic out from under an in-flight session: the native
      // permission prompt can blur the page, which would otherwise hide it.
      if (engaged) return;
      button.hidden = true;
      releasePadding();
      target = null;
    }

    let primed = false; // have we already run the one-time mic prompt?

    // Trigger the OS/browser microphone permission dialog. Safari won't raise
    // it from SpeechRecognition itself, so we do it here, out of band — never
    // in the start() path, which must stay synchronous to keep Safari's click
    // gesture. After a grant the founder taps the mic again and recognition
    // starts within a fresh gesture, with permission already in hand.
    function primeMic() {
      const md = win.navigator && win.navigator.mediaDevices;
      if (!md || typeof md.getUserMedia !== "function") return null;
      return md.getUserMedia({ audio: true });
    }

    // Shared callbacks — both engines speak the same idle/listening/working
    // vocabulary, so the glue doesn't care which one is driving.
    function handleState(state) {
      const listening = state === "listening";
      const working = state === "working"; // Whisper: transcribing
      button.classList.toggle("voice-mic--listening", listening);
      button.classList.toggle("voice-mic--working", working);
      button.setAttribute("aria-pressed", String(listening || working));
      if (listening) {
        setStatus(listenLabel, false);
        base = target && target.value ? target.value.replace(/\s+$/, "") : "";
      } else if (working) {
        setStatus("Transcribing…", false);
      } else {
        engaged = false;
        // Leave an error message in place if one was just set.
        if (!button.classList.contains("voice-mic--error")) setStatus("", false);
        if (target && typeof target.focus === "function") target.focus();
      }
    }

    function handleResult(r) {
      if (!target) return;
      const merged = mergeTranscript(base, r);
      base = merged.base;
      target.value = merged.value;
      // Let the app react (enable Post/End buttons, autosave drafts).
      if (typeof win.Event === "function") {
        target.dispatchEvent(new win.Event("input", { bubbles: true }));
      }
    }

    function handleError(code, detail) {
      engaged = false;
      // Surface it both visibly (the bubble) and in the console so a
      // "nothing happens" report is diagnosable.
      if (win.console && typeof win.console.warn === "function") {
        win.console.warn("[tinker] voice input:", code, detail || "");
      }

      // Web Speech on Safari: the first denial raises the real mic prompt out
      // of band, then asks the founder to tap again (the retry runs inside a
      // fresh gesture, which Safari requires). The Whisper engine gets its
      // permission straight from getUserMedia, so it never needs this.
      const denied =
        code === "not-allowed" ||
        code === "service-not-allowed" ||
        code === "NotAllowedError" ||
        code === "SecurityError";
      if (!useWhisper && denied && !primed) {
        const prompt = primeMic();
        if (prompt && typeof prompt.then === "function") {
          primed = true;
          setStatus("Allow the microphone, then tap again.", false);
          prompt.then(
            function (stream) {
              if (stream && typeof stream.getTracks === "function") {
                stream.getTracks().forEach(function (t) {
                  if (t && typeof t.stop === "function") t.stop();
                });
              }
              setStatus("Microphone ready — tap to dictate.", false);
            },
            function () {
              setStatus(errorMessage("not-allowed"), true);
            }
          );
          return;
        }
      }

      // Append the raw reason when we have one — on a phone with no console
      // this is the only way to see whether it was a blocked host, a CSP
      // refusal, or a plain network failure.
      let message = errorMessage(code);
      if (detail) message += " [" + String(detail).slice(0, 80) + "]";
      setStatus(message, true);
    }

    const controller = useWhisper
      ? Whisper.createRecorderController({
          getUserMedia: function () {
            return win.navigator.mediaDevices.getUserMedia({ audio: true });
          },
          createRecorder: function (stream) {
            return new win.MediaRecorder(stream);
          },
          transcribe: function (blob) {
            // Upload the clip to our endpoint, carrying the founder's session
            // so the server-side transcription key isn't open to the world.
            return Whisper.transcribeViaServer(blob, {
              token: win.tinkerAuth && win.tinkerAuth.token,
              fetch: win.fetch ? win.fetch.bind(win) : undefined,
            });
          },
          onState: handleState,
          onResult: handleResult,
          onError: handleError,
        })
      : createVoiceController({
          createRecognition: function () {
            return new SpeechRecognition();
          },
          lang: doc.documentElement && doc.documentElement.lang ? doc.documentElement.lang : "en-US",
          onState: handleState,
          onResult: handleResult,
          onError: handleError,
        });

    // Keep focus in the field when the mic is pressed.
    button.addEventListener("mousedown", function (e) {
      e.preventDefault();
    });
    button.addEventListener("click", function () {
      const st = controller.state;
      if (st === "working") return; // busy transcribing — ignore taps
      if (st === "idle") {
        // Immediate feedback: starting (and on Web Speech/Safari a native
        // permission dialog) can take a beat — say so up front.
        engaged = true;
        setStatus("Starting…", false);
      }
      controller.toggle();
    });

    doc.addEventListener("focusin", function (e) {
      if (isEligible(e.target)) show(e.target);
    });
    doc.addEventListener("focusout", function () {
      // Defer so a click on the mic (which we keep from stealing focus)
      // doesn't trip an immediate hide.
      win.setTimeout(function () {
        const active = doc.activeElement;
        if (active === button) return;
        if (isEligible(active)) return;
        hide();
      }, 120);
    });

    function reposition() {
      if (!button.hidden) win.requestAnimationFrame(position);
    }
    win.addEventListener("scroll", reposition, true);
    win.addEventListener("resize", reposition);

    return {
      button: button,
      status: status,
      controller: controller,
      show: show,
      hide: hide,
      position: position,
    };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        initFollowingMic({});
      });
    } else {
      initFollowingMic({});
    }
  }

  return {
    ELIGIBLE: ELIGIBLE,
    createVoiceController: createVoiceController,
    mergeTranscript: mergeTranscript,
    initFollowingMic: initFollowingMic,
  };
});
