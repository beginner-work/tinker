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
    uploading: "Uploading…",
    uploaded: "Saved",
    uploadFailed: "Upload failed — tap to retry",
    retryUpload: "Retry upload",
    copyLink: "Copy link",
    linkCopied: "Link copied",
    notSignedIn: "Sign in first to save your pitch to the cloud.",
    savedTakeHeading: "Your latest take",
    savedTakeHint: "Play to re-watch what's already saved to the cloud.",
  };

  const TOKEN_KEY = "tinker_jwt";
  const UPLOAD_ENDPOINT = "/api/upload/pitch-video";

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
  let recordedBlob = null;
  let recordedMimeType = "video/webm";
  let countdownValue = 0;
  let countdownTimer = null;
  let elapsedSeconds = 0;
  let elapsedTimer = null;
  let startedAt = 0;

  // ── Upload state ────────────────────────────────────────────────
  // upload: "idle" | "uploading" | { ok: true, url, copied? } | { ok: false, error }
  let uploadState = "idle";
  let uploadCopiedTimer = null;

  // ── Saved take ──────────────────────────────────────────────────
  // The most recently uploaded take for the current pitch, fetched
  // from the server on show() so a thumbnail+playback shows up at
  // the top of the script across sessions.
  // savedTake: null | { url, contentType, uploadedAt, pitchId }
  let savedTake = null;
  let savedTakeFetchToken = 0;

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
        savedTakeHtml() +
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

  // ── Saved-take thumbnail ────────────────────────────────────────
  // Rendered when the founder has a previously-uploaded take for
  // this pitch (either from a prior session or from the most recent
  // recording in this one). preload="metadata" lets the browser
  // paint the first frame as a poster without downloading the whole
  // file. Hidden while the recorder panel is up so it doesn't
  // double the "video on screen" surface area.
  function savedTakeHtml() {
    if (!savedTake || !savedTake.url) return "";
    if (recorderMode !== "idle") return "";
    return (
      `<section class="pitch-script__saved" aria-label="${escapeHtml(STR.savedTakeHeading)}">` +
        `<header class="pitch-script__saved-header">` +
          `<span class="pitch-script__saved-heading">${escapeHtml(STR.savedTakeHeading)}</span>` +
          `<span class="pitch-script__saved-hint">${escapeHtml(STR.savedTakeHint)}</span>` +
        `</header>` +
        `<video class="pitch-script__saved-video" src="${escapeHtml(savedTake.url)}" controls preload="metadata" playsinline></video>` +
      `</section>`
    );
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
      const downloadName = recordedMimeType && recordedMimeType.includes("mp4") ? "pitch.mp4" : "pitch.webm";
      // Upload runs automatically the moment a take is captured, so the
      // status line is the only surface that reflects it. Failures get
      // a retry button next to the controls — no second button to
      // tap for the happy path.
      let uploadHtml = "";
      let statusSuffix = "";
      if (uploadState === "uploading") {
        statusSuffix = ` · ${escapeHtml(STR.uploading)}`;
      } else if (uploadState && uploadState.ok === true) {
        statusSuffix = ` · ${escapeHtml(STR.uploaded)}`;
        const copyLabel = uploadState.copied ? STR.linkCopied : STR.copyLink;
        uploadHtml = `<button type="button" class="pitch-script__rec-secondary" data-role="rec-copy-link">${escapeHtml(copyLabel)}</button>`;
      } else if (uploadState && uploadState.ok === false) {
        statusSuffix = ` · ${escapeHtml(STR.uploadFailed)}`;
        uploadHtml = `<button type="button" class="pitch-script__rec-secondary" data-role="rec-upload" title="${escapeHtml(uploadState.error || "")}">${escapeHtml(STR.retryUpload)}</button>`;
      }
      statusHtml =
        `<span class="pitch-script__rec-status">${escapeHtml(STR.playbackTitle)} · ${escapeHtml(formatClock(elapsedSeconds))}${statusSuffix}</span>`;
      controlsHtml =
        `<button type="button" class="pitch-script__rec-secondary" data-role="rec-redo">${escapeHtml(STR.recordAgain)}</button>` +
        uploadHtml +
        `<a class="pitch-script__rec-secondary pitch-script__rec-download" data-role="rec-download" href="${escapeHtml(recordedBlobUrl || "#")}" download="${escapeHtml(downloadName)}">${escapeHtml(STR.download)}</a>` +
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

    const upload = viewEl.querySelector('[data-role="rec-upload"]');
    if (upload) upload.addEventListener("click", () => uploadRecording());

    const copyLink = viewEl.querySelector('[data-role="rec-copy-link"]');
    if (copyLink) copyLink.addEventListener("click", () => copyUploadedLink());
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
    recordedBlob = null;
    uploadState = "idle";
    if (uploadCopiedTimer) { clearTimeout(uploadCopiedTimer); uploadCopiedTimer = null; }
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
      const blobType = recordedChunks[0]?.type || "video/webm";
      const blob = new Blob(recordedChunks, { type: blobType });
      if (recordedBlobUrl) {
        try { URL.revokeObjectURL(recordedBlobUrl); } catch (_) { /* noop */ }
      }
      recordedBlob = blob;
      recordedMimeType = blobType;
      recordedBlobUrl = URL.createObjectURL(blob);
      recorderMode = "playback";
      uploadState = "idle";
      // Free the camera/mic once we have the blob; playback uses the
      // blob URL, not the live stream.
      teardownStream();
      render();
      // Kick off the cloud upload automatically. The founder shouldn't
      // have to tap a second button for the obvious next step; if it
      // fails, the status flips to a retry affordance.
      uploadRecording().catch(() => { /* surfaced in uploadState */ });
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
    recordedBlob = null;
    recordedChunks = [];
    elapsedSeconds = 0;
    countdownValue = 0;
    recorderError = null;
    recorderMode = "idle";
    uploadState = "idle";
    if (uploadCopiedTimer) { clearTimeout(uploadCopiedTimer); uploadCopiedTimer = null; }
    if (rerender) render();
  }

  // ── Upload to Vercel Blob ───────────────────────────────────────
  //
  // Hand-rolled equivalent of @vercel/blob/client's `upload(...)` —
  // the SDK ships ESM-only and the tinker renderer has no bundler.
  // Two HTTP calls:
  //   1. POST our serverless function with the protocol envelope
  //      `{ type: "blob.generate-client-token", payload: {...} }`.
  //      The server authenticates the founder, validates the pathname,
  //      and returns a short-lived `vercel_blob_client_*` token.
  //   2. PUT the recording straight to Vercel Blob's API
  //      (`https://vercel.com/api/blob?pathname=...`) with that token.
  //      Vercel Blob will then POST `blob.upload-completed` back to our
  //      function, which upserts the TinkerUserData row keyed by the
  //      `pitch-video:<pitchId>` kind.
  function getAuthToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  }

  function extForMimeType(mt) {
    if (mt && mt.includes("mp4")) return "mp4";
    return "webm";
  }

  async function uploadRecording() {
    if (!recordedBlob || !currentPitchId) return;
    if (uploadState === "uploading") return;

    const token = getAuthToken();
    if (!token) {
      uploadState = { ok: false, error: STR.notSignedIn };
      render();
      return;
    }

    uploadState = "uploading";
    render();

    const ext = extForMimeType(recordedMimeType);
    const pathname = `pitch-videos/${currentPitchId}/${Date.now()}.${ext}`;
    const clientPayload = JSON.stringify({ pitchId: currentPitchId });

    try {
      // Step 1 — exchange auth for a client token scoped to this pathname.
      const tokenRes = await fetch(UPLOAD_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: "blob.generate-client-token",
          payload: { pathname, clientPayload, multipart: false },
        }),
      });
      if (!tokenRes.ok) {
        const detail = await tokenRes.json().catch(() => ({}));
        throw new Error(detail.error || `Token request failed (${tokenRes.status})`);
      }
      const tokenJson = await tokenRes.json();
      const clientToken = tokenJson && tokenJson.clientToken;
      if (!clientToken) throw new Error("Server did not return a client token");

      // Step 2 — direct PUT to Vercel Blob. The bytes bypass our
      // serverless function entirely; the function only sees the
      // signed completion callback Vercel fires afterwards.
      //
      // Headers mirror @vercel/blob/client's requestApi(): the
      // version + store-id are both required by Vercel's API.
      // The store-id is encoded in the client token at position 3
      // (`vercel_blob_client_<storeId>_<payload>`).
      const parts = clientToken.split("_");
      const storeId = parts[3] || "";
      if (!storeId) throw new Error("Client token is missing store id");
      const requestId =
        `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      const blobApiUrl =
        `https://vercel.com/api/blob/?` +
        new URLSearchParams({ pathname }).toString();
      const putRes = await fetch(blobApiUrl, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${clientToken}`,
          "x-api-version": "12",
          "x-vercel-blob-store-id": storeId,
          "x-api-blob-request-id": requestId,
          "x-api-blob-request-attempt": "0",
          "x-content-type": recordedMimeType || "video/webm",
        },
        body: recordedBlob,
      });
      if (!putRes.ok) {
        const detail = await putRes.text().catch(() => "");
        throw new Error(`Blob upload failed (${putRes.status}) ${detail}`);
      }
      const putJson = await putRes.json();
      if (!putJson || !putJson.url) {
        throw new Error("Blob upload did not return a URL");
      }
      uploadState = { ok: true, url: putJson.url };
      // Optimistically populate the saved-take thumbnail so it shows
      // up the moment the upload finishes — without waiting on the
      // upload-completed callback to round-trip through Vercel and
      // land in our database.
      savedTake = {
        url: putJson.url,
        contentType: recordedMimeType || "video/webm",
        uploadedAt: Date.now(),
        pitchId: currentPitchId,
      };
    } catch (err) {
      uploadState = { ok: false, error: String((err && err.message) || err) };
    }
    render();
  }

  async function copyUploadedLink() {
    if (!uploadState || uploadState.ok !== true || !uploadState.url) return;
    const url = uploadState.url;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch (_) { /* clipboard blocked — swallow */ }
    uploadState = { ...uploadState, copied: true };
    render();
    if (uploadCopiedTimer) clearTimeout(uploadCopiedTimer);
    uploadCopiedTimer = setTimeout(() => {
      if (uploadState && uploadState.ok === true) {
        uploadState = { ok: true, url: uploadState.url };
        render();
      }
      uploadCopiedTimer = null;
    }, 1500);
  }

  // Pulls the most recently uploaded take for the active pitch so
  // the saved-take thumbnail renders on first paint. Cancelled
  // implicitly when show() is called again for a different pitch —
  // the token guard drops any in-flight response that no longer
  // matches the current pitch.
  async function fetchSavedTake(pitchId) {
    const token = getAuthToken();
    if (!token) return;
    const fetchId = ++savedTakeFetchToken;
    try {
      const res = await fetch(
        `${UPLOAD_ENDPOINT}?pitchId=${encodeURIComponent(pitchId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      const json = await res.json();
      if (fetchId !== savedTakeFetchToken) return;
      if (pitchId !== currentPitchId) return;
      const data = json && json.data;
      if (data && data.url) {
        savedTake = {
          url: data.url,
          contentType: data.contentType || "video/webm",
          uploadedAt: data.uploadedAt || null,
          pitchId,
        };
        render();
      }
    } catch (_) {
      // Network blips just leave the thumbnail hidden; nothing
      // user-facing to flag.
    }
  }

  window.tinkerPitchScript = {
    show(pitchId) {
      viewEl = document.getElementById("pitch-script");
      if (!viewEl) return;
      // Switching pitches mid-recording is a bug-magnet — tear it
      // down so the new pitch lands in a clean idle state.
      if (currentPitchId !== pitchId) {
        teardownRecorder();
        savedTake = null;
      }
      currentPitchId = pitchId || null;
      render();
      if (currentPitchId) fetchSavedTake(currentPitchId);
    },
    // Exposed for tests.
    _scriptToPlainText: scriptToPlainText,
    _formatDuration: formatDuration,
    _formatClock: formatClock,
    _extForMimeType: extForMimeType,
  };
})();
