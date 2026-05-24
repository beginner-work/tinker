/* tinker — pitch-script (v0.2)
 *
 * The "prepare a script for a video" surface. Opened from the play
 * button on a pitch row in the sidebar; renders into #pitch-script.
 *
 * It is NOT a publish step. The founder isn't shipping anything to
 * the daily beginner here — this is the pre-step where they get a
 * storyboard they can record a video from. Publishing happens later
 * (today via the founders opt-in, which auto-publishes when the
 * founder makes the pitch discoverable).
 *
 * Content shape: one block per slide that has at least one resolved
 * phrase. Each block shows the deck heading, a suggested on-camera
 * duration (computed from word count at ~130 wpm), and the founder's
 * resolved phrases verbatim. Plus a copy-to-clipboard button so the
 * whole script lands in a teleprompter or notes app in one tap.
 *
 * v0.2 — adds an in-app pitch recorder. The "Record your pitch" CTA
 * at the top of the surface opens a sticky panel with a live camera
 * self-view, a 3-second self-timer, an elapsed-time readout, and a
 * stop control. The storyboard stays visible above the panel so the
 * founder can scroll through their lines while recording. On stop,
 * the panel flips to playback with download + re-record actions.
 *
 * Entry point: window.tinkerPitchScript.show(pitchId). Wired in
 * renderer.js when the sidebar play button is tapped.
 */

(() => {
  "use strict";

  const STR = {
    surfaceTitle: "Prepare a script for a video",
    back: "Back",
    copy: "Copy script",
    copied: "Copied",
    totalLabel: "Total",
    secondsAbbrev: "s",
    minutesAbbrev: "m",
    emptyHint:
      "This pitch doesn't have any resolved phrases yet. Add writing under the pitch's headings, then come back.",
    recordCta: "Record your pitch",
    recorderTitle: "Pitch recorder",
    recorderHint:
      "Camera + mic open below. We count down 3, 2, 1, then record. The script stays on screen so you can glance at it while you talk.",
    permissionDenied:
      "Camera or microphone access was blocked. Allow access in your OS settings and try again.",
    unsupported:
      "Recording isn't supported in this browser. Try the desktop app or a recent Chrome / Safari.",
    starting: "Starting…",
    countdownPrefix: "Recording in ",
    recording: "Recording",
    stop: "Stop",
    cancel: "Cancel",
    recordAgain: "Record again",
    download: "Download",
    close: "Close",
    playbackTitle: "Your take",
  };

  let viewEl = null;
  let currentPitchId = null;
  let copiedTimer = null;

  // ── Recorder state ──────────────────────────────────────────────
  // Single recorder instance per view-render. Lives on the closure
  // so toggling between idle/countdown/recording/playback doesn't
  // tear down the whole storyboard.
  //
  // mode: "idle" | "arming" | "countdown" | "recording" | "playback" | "error"
  let recorderMode = "idle";
  let recorderError = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlobUrl = null;
  let countdownValue = 0;
  let countdownTimer = null;
  let elapsedSeconds = 0;
  let elapsedTimer = null;
  let startedAt = 0;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return `${s}${STR.secondsAbbrev}`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (!rem) return `${m}${STR.minutesAbbrev}`;
    return `${m}${STR.minutesAbbrev} ${rem}${STR.secondsAbbrev}`;
  }

  // mm:ss readout for the live elapsed-time chip.
  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }

  function getScript(pitchId) {
    const pm = window.tinkerPitches;
    if (!pm || typeof pm.getPitchScript !== "function") return null;
    return pm.getPitchScript(pitchId);
  }

  // Flat plain-text rendering for clipboard. Mirrors the on-screen
  // storyboard so the founder can paste it straight into a teleprompter
  // and read top to bottom.
  function scriptToPlainText(script) {
    if (!script) return "";
    const lines = [];
    lines.push(script.title || "");
    const total = (script.slides || []).reduce((n, s) => n + s.seconds, 0);
    if (total) lines.push(`${STR.totalLabel}: ${formatDuration(total)}`);
    lines.push("");
    (script.slides || []).forEach((slide, i) => {
      lines.push(`SLIDE ${i + 1} — ${slide.heading}  (~${formatDuration(slide.seconds)})`);
      lines.push("");
      slide.phrases.forEach((p) => {
        lines.push(p);
        lines.push("");
      });
    });
    return lines.join("\n").trimEnd() + "\n";
  }

  // Mirror the storyboard HTML so render() and renderRecorderOpen()
  // share one source of truth.
  function storyboardHtml(script) {
    if (!script || !script.slides.length) return "";
    return script.slides.map((slide, i) => {
      const phrasesHtml = slide.phrases
        .map((p) => `<p class="pitch-script__phrase" data-audit-ignore>${escapeHtml(p)}</p>`)
        .join("");
      return (
        `<section class="pitch-script__slide" aria-labelledby="pitch-script-slide-${i}">` +
          `<header class="pitch-script__slide-header">` +
            `<span class="pitch-script__slide-index">SLIDE ${i + 1}</span>` +
            `<span class="pitch-script__slide-heading" id="pitch-script-slide-${i}" data-audit-ignore>${escapeHtml(slide.heading)}</span>` +
            `<span class="pitch-script__slide-time">~${escapeHtml(formatDuration(slide.seconds))}</span>` +
          `</header>` +
          `<div class="pitch-script__slide-body">${phrasesHtml}</div>` +
        `</section>`
      );
    }).join("");
  }

  function render() {
    if (!viewEl) return;
    const script = currentPitchId ? getScript(currentPitchId) : null;
    if (!script) {
      viewEl.innerHTML =
        `<div class="pitch-script__inner">` +
          `<button type="button" class="pitch-script__back" data-role="back">${escapeHtml(STR.back)}</button>` +
          `<h1 class="pitch-script__title">${escapeHtml(STR.surfaceTitle)}</h1>` +
          `<p class="pitch-script__empty">${escapeHtml(STR.emptyHint)}</p>` +
        `</div>`;
      wireBack();
      return;
    }

    if (!script.slides.length) {
      viewEl.innerHTML =
        `<div class="pitch-script__inner">` +
          `<button type="button" class="pitch-script__back" data-role="back">${escapeHtml(STR.back)}</button>` +
          `<h1 class="pitch-script__title">${escapeHtml(STR.surfaceTitle)}</h1>` +
          `<div class="pitch-script__pitch-title" data-audit-ignore>${escapeHtml(script.title)}</div>` +
          `<p class="pitch-script__empty">${escapeHtml(STR.emptyHint)}</p>` +
        `</div>`;
      wireBack();
      return;
    }

    const total = script.slides.reduce((n, s) => n + s.seconds, 0);
    const recorderActive = recorderMode !== "idle";

    viewEl.innerHTML =
      `<div class="pitch-script__inner${recorderActive ? " pitch-script__inner--recording" : ""}">` +
        `<button type="button" class="pitch-script__back" data-role="back">${escapeHtml(STR.back)}</button>` +
        `<h1 class="pitch-script__title">${escapeHtml(STR.surfaceTitle)}</h1>` +
        `<div class="pitch-script__pitch-title" data-audit-ignore>${escapeHtml(script.title)}</div>` +
        `<div class="pitch-script__total">${escapeHtml(STR.totalLabel)}: ${escapeHtml(formatDuration(total))}</div>` +
        `<div class="pitch-script__record-row">` +
          `<button type="button" class="pitch-script__record" data-role="record" ${recorderActive ? "disabled" : ""}>` +
            `<span class="pitch-script__record-glyph" aria-hidden="true">●</span>` +
            `<span class="pitch-script__record-label">${escapeHtml(STR.recordCta)}</span>` +
          `</button>` +
        `</div>` +
        `<div class="pitch-script__storyboard">${storyboardHtml(script)}</div>` +
        `<div class="pitch-script__actions">` +
          `<button type="button" class="pitch-script__copy" data-role="copy">${escapeHtml(STR.copy)}</button>` +
        `</div>` +
      `</div>` +
      recorderPanelHtml();

    wireBack();
    wireCopy(script);
    wireRecord();
    // The recorder panel only exists in the DOM while a session is
    // active; wire its controls if it's there.
    if (recorderActive) {
      wireRecorderPanel();
      // Re-attach the live MediaStream to the freshly-rendered <video>
      // element. innerHTML rewrites tear the old element out.
      attachStreamToPreview();
    }
  }

  // ── Recorder panel HTML ─────────────────────────────────────────
  // Sticky overlay at the bottom of the viewport. The storyboard
  // above remains scrollable so the founder can glance at their
  // lines while talking.
  function recorderPanelHtml() {
    if (recorderMode === "idle") return "";

    let statusHtml = "";
    let controlsHtml = "";
    let videoHtml = "";

    if (recorderMode === "arming") {
      statusHtml = `<span class="pitch-script__rec-status">${escapeHtml(STR.starting)}</span>`;
      controlsHtml =
        `<button type="button" class="pitch-script__rec-secondary" data-role="rec-cancel">${escapeHtml(STR.cancel)}</button>`;
    } else if (recorderMode === "error") {
      statusHtml = `<span class="pitch-script__rec-status pitch-script__rec-status--error">${escapeHtml(recorderError || STR.permissionDenied)}</span>`;
      controlsHtml =
        `<button type="button" class="pitch-script__rec-secondary" data-role="rec-close">${escapeHtml(STR.close)}</button>`;
    } else if (recorderMode === "countdown") {
      statusHtml =
        `<span class="pitch-script__rec-status">${escapeHtml(STR.countdownPrefix)}` +
        `<span class="pitch-script__rec-countdown">${escapeHtml(String(countdownValue))}</span></span>`;
      controlsHtml =
        `<button type="button" class="pitch-script__rec-secondary" data-role="rec-cancel">${escapeHtml(STR.cancel)}</button>`;
      videoHtml =
        `<video class="pitch-script__rec-video" data-role="rec-preview" autoplay muted playsinline></video>`;
    } else if (recorderMode === "recording") {
      statusHtml =
        `<span class="pitch-script__rec-status pitch-script__rec-status--live">` +
          `<span class="pitch-script__rec-dot" aria-hidden="true"></span>` +
          `${escapeHtml(STR.recording)} · ${escapeHtml(formatClock(elapsedSeconds))}` +
        `</span>`;
      controlsHtml =
        `<button type="button" class="pitch-script__rec-primary" data-role="rec-stop">${escapeHtml(STR.stop)}</button>`;
      videoHtml =
        `<video class="pitch-script__rec-video" data-role="rec-preview" autoplay muted playsinline></video>`;
    } else if (recorderMode === "playback") {
      statusHtml = `<span class="pitch-script__rec-status">${escapeHtml(STR.playbackTitle)} · ${escapeHtml(formatClock(elapsedSeconds))}</span>`;
      controlsHtml =
        `<button type="button" class="pitch-script__rec-secondary" data-role="rec-redo">${escapeHtml(STR.recordAgain)}</button>` +
        `<a class="pitch-script__rec-secondary pitch-script__rec-download" data-role="rec-download" href="${escapeHtml(recordedBlobUrl || "#")}" download="pitch.webm">${escapeHtml(STR.download)}</a>` +
        `<button type="button" class="pitch-script__rec-primary" data-role="rec-close">${escapeHtml(STR.close)}</button>`;
      videoHtml =
        `<video class="pitch-script__rec-video" data-role="rec-playback" src="${escapeHtml(recordedBlobUrl || "")}" controls playsinline></video>`;
    }

    return (
      `<div class="pitch-script__rec-panel" role="region" aria-label="${escapeHtml(STR.recorderTitle)}">` +
        `<div class="pitch-script__rec-panel-inner">` +
          `<div class="pitch-script__rec-video-wrap">${videoHtml}</div>` +
          `<div class="pitch-script__rec-meta">` +
            `<div class="pitch-script__rec-title">${escapeHtml(STR.recorderTitle)}</div>` +
            statusHtml +
          `</div>` +
          `<div class="pitch-script__rec-controls">${controlsHtml}</div>` +
        `</div>` +
      `</div>`
    );
  }

  function wireBack() {
    const back = viewEl.querySelector('[data-role="back"]');
    if (!back) return;
    back.addEventListener("click", () => {
      // Leaving the surface entirely — tear down any open camera so
      // the indicator turns off and the device frees up.
      teardownRecorder();
      if (typeof window.tinkerShowPitch === "function") {
        window.tinkerShowPitch();
      }
    });
  }

  function wireCopy(script) {
    const copyBtn = viewEl.querySelector('[data-role="copy"]');
    if (!copyBtn) return;
    copyBtn.addEventListener("click", async () => {
      const text = scriptToPlainText(script);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
      } catch (_) { /* clipboard blocked — swallow */ }
      copyBtn.textContent = STR.copied;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copyBtn.textContent = STR.copy;
        copiedTimer = null;
      }, 1500);
    });
  }

  function wireRecord() {
    const btn = viewEl.querySelector('[data-role="record"]');
    if (!btn) return;
    btn.addEventListener("click", () => startRecorder());
  }

  function wireRecorderPanel() {
    const stop = viewEl.querySelector('[data-role="rec-stop"]');
    if (stop) stop.addEventListener("click", () => stopRecording());

    const cancel = viewEl.querySelector('[data-role="rec-cancel"]');
    if (cancel) cancel.addEventListener("click", () => teardownRecorder(true));

    const close = viewEl.querySelector('[data-role="rec-close"]');
    if (close) close.addEventListener("click", () => teardownRecorder(true));

    const redo = viewEl.querySelector('[data-role="rec-redo"]');
    if (redo) redo.addEventListener("click", () => startRecorder());
  }

  // After render() rewrites innerHTML the live MediaStream needs to
  // be re-bound to the new <video> element.
  function attachStreamToPreview() {
    if (!mediaStream) return;
    const preview = viewEl.querySelector('[data-role="rec-preview"]');
    if (!preview) return;
    if (preview.srcObject !== mediaStream) {
      preview.srcObject = mediaStream;
    }
    // Some browsers need an explicit play() after src changes; if
    // it's blocked (e.g. by autoplay policy) we silently swallow —
    // the user can still see status text.
    preview.play && preview.play().catch(() => {});
  }

  // ── Recorder lifecycle ──────────────────────────────────────────
  async function startRecorder() {
    // From any state, restart cleanly.
    teardownStream();
    clearTimers();
    recordedChunks = [];
    if (recordedBlobUrl) {
      try { URL.revokeObjectURL(recordedBlobUrl); } catch (_) { /* noop */ }
      recordedBlobUrl = null;
    }
    elapsedSeconds = 0;
    recorderError = null;
    recorderMode = "arming";
    render();

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function" || typeof window.MediaRecorder !== "function") {
      recorderError = STR.unsupported;
      recorderMode = "error";
      render();
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (_) {
      recorderError = STR.permissionDenied;
      recorderMode = "error";
      render();
      return;
    }

    countdownValue = 3;
    recorderMode = "countdown";
    render();
    countdownTimer = setInterval(() => {
      countdownValue -= 1;
      if (countdownValue <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        beginCapture();
        return;
      }
      render();
    }, 1000);
  }

  function beginCapture() {
    if (!mediaStream) return;
    try {
      const options = pickRecorderOptions();
      mediaRecorder = options
        ? new MediaRecorder(mediaStream, options)
        : new MediaRecorder(mediaStream);
    } catch (_) {
      recorderError = STR.unsupported;
      recorderMode = "error";
      render();
      return;
    }

    recordedChunks = [];
    mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size) recordedChunks.push(e.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || "video/webm" });
      if (recordedBlobUrl) {
        try { URL.revokeObjectURL(recordedBlobUrl); } catch (_) { /* noop */ }
      }
      recordedBlobUrl = URL.createObjectURL(blob);
      recorderMode = "playback";
      // Free the camera/mic once we have the blob; playback uses the
      // blob URL, not the live stream.
      teardownStream();
      render();
    });

    elapsedSeconds = 0;
    startedAt = Date.now();
    recorderMode = "recording";
    render();
    mediaRecorder.start();

    elapsedTimer = setInterval(() => {
      elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      // Only re-render the status chip rather than the whole view —
      // that would tear the <video> element out every second.
      const statusEl = viewEl && viewEl.querySelector(".pitch-script__rec-status--live");
      if (statusEl) {
        statusEl.innerHTML =
          `<span class="pitch-script__rec-dot" aria-hidden="true"></span>` +
          `${escapeHtml(STR.recording)} · ${escapeHtml(formatClock(elapsedSeconds))}`;
      }
    }, 500);
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch (_) { /* noop */ }
    }
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  // Browser-by-browser: prefer mp4/h264 when available (Safari /
  // recent Chromium) so the downloaded file plays in QuickTime
  // without conversion; otherwise fall back to webm.
  function pickRecorderOptions() {
    if (typeof window.MediaRecorder !== "function" || typeof MediaRecorder.isTypeSupported !== "function") {
      return null;
    }
    const candidates = [
      "video/mp4;codecs=h264,aac",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    for (const mimeType of candidates) {
      if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType };
    }
    return null;
  }

  function teardownStream() {
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach((t) => t.stop());
      } catch (_) { /* noop */ }
      mediaStream = null;
    }
  }

  function clearTimers() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function teardownRecorder(rerender) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch (_) { /* noop */ }
    }
    mediaRecorder = null;
    teardownStream();
    clearTimers();
    if (recordedBlobUrl) {
      try { URL.revokeObjectURL(recordedBlobUrl); } catch (_) { /* noop */ }
      recordedBlobUrl = null;
    }
    recordedChunks = [];
    elapsedSeconds = 0;
    countdownValue = 0;
    recorderError = null;
    recorderMode = "idle";
    if (rerender) render();
  }

  window.tinkerPitchScript = {
    show(pitchId) {
      viewEl = document.getElementById("pitch-script");
      if (!viewEl) return;
      // Switching pitches mid-recording is a bug-magnet — tear it
      // down so the new pitch lands in a clean idle state.
      if (currentPitchId !== pitchId) {
        teardownRecorder();
      }
      currentPitchId = pitchId || null;
      render();
    },
    // Exposed for tests.
    _scriptToPlainText: scriptToPlainText,
    _formatDuration: formatDuration,
    _formatClock: formatClock,
  };
})();
