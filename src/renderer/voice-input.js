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
        return "Microphone access was blocked.";
      case "no-speech":
        return "Didn't catch that — try again.";
      case "audio-capture":
        return "No microphone was found.";
      case "network":
        return "Voice needs a connection right now.";
      default:
        return "Voice input isn't available right now.";
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

    function start() {
      if (state === "listening") return;
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

    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "voice-mic";
    button.setAttribute("aria-label", "Dictate");
    button.setAttribute("aria-pressed", "false");
    button.title = "Dictate";
    button.hidden = true;
    button.innerHTML = MIC_SVG;

    const status = doc.createElement("span");
    status.className = "voice-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    doc.body.appendChild(button);
    doc.body.appendChild(status);

    let target = null; // the field we're dictating into
    let base = ""; // committed text before the live utterance
    let prevPadRight = ""; // field's own padding-right, restored on release

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
      if (controller.state === "listening") return;
      button.hidden = true;
      releasePadding();
      target = null;
    }

    const controller = createVoiceController({
      createRecognition: function () {
        return new SpeechRecognition();
      },
      lang: doc.documentElement && doc.documentElement.lang ? doc.documentElement.lang : "en-US",
      onState: function (state) {
        const listening = state === "listening";
        button.classList.toggle("voice-mic--listening", listening);
        button.setAttribute("aria-pressed", String(listening));
        status.textContent = listening ? "Listening…" : "";
        if (listening) {
          base = target && target.value ? target.value.replace(/\s+$/, "") : "";
        } else if (target && typeof target.focus === "function") {
          target.focus();
        }
      },
      onResult: function (r) {
        if (!target) return;
        const merged = mergeTranscript(base, r);
        base = merged.base;
        target.value = merged.value;
        // Let the app react (enable Post/End buttons, autosave drafts).
        if (typeof win.Event === "function") {
          target.dispatchEvent(new win.Event("input", { bubbles: true }));
        }
      },
      onError: function (code) {
        status.textContent = errorMessage(code);
      },
    });

    // Keep focus in the field when the mic is pressed.
    button.addEventListener("mousedown", function (e) {
      e.preventDefault();
    });
    button.addEventListener("click", function () {
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
