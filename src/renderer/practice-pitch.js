/* practice-pitch.js — upload a pitch deck, then practice it in a recording
 * studio.
 *
 * Two profile-menu actions (wired in profile.js):
 *
 *   .upload()   — pick a PDF; pdf.js renders each page to a downscaled JPEG
 *                 and PUTs the slides to /api/pitch-deck.
 *   .practice() — open a full-screen recording studio: the deck plays full
 *                 screen, you navigate it, a live draggable webcam bubble of
 *                 yourself sits on top, and one tap records slides + face +
 *                 voice (composited on a <canvas>) to a downloadable video.
 *                 You present and record yourself in one take.
 *
 * Storage: one TinkerUserData row (kind "pitchDeck") via /api/pitch-deck.
 * With nothing uploaded yet, the studio falls back to a bundled sample deck.
 *
 * Self-contained + CSP-safe: same-origin assets, getUserMedia for the camera
 * (a permission), MediaRecorder for the capture, vendored pdf.js for upload.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var ENDPOINT = "/api/pitch-deck";
  var PDF_LIB = "./lib/pdfjs/pdf.min.js";
  var PDF_WORKER = "./lib/pdfjs/pdf.worker.min.js";
  var SLIDE_WIDTH = 1080;
  var JPEG_QUALITY = 0.7;
  var MAX_PAGES = 40;
  var BUDGET_BYTES = 3.6 * 1024 * 1024;

  // Bundled sample deck (rendered from the canonical pitch deck) so "Practice
  // my pitch" works before anything is uploaded.
  var SAMPLE_SLIDES = (function () {
    var a = [];
    for (var i = 1; i <= 13; i++) {
      a.push("./lib/sample-pitch/slide-" + (i < 10 ? "0" + i : i) + ".png");
    }
    return a;
  })();

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function authHeaders() { return { Authorization: "Bearer " + token() }; }

  // ── Styles ──────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("practice-pitch-styles")) return;
    var css = [
      "#pp-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;",
      "max-width:calc(100vw - 32px);background:#2d2a26;color:#fffdf7;font-size:14px;line-height:1.4;",
      "padding:12px 18px;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.28);",
      "font-family:'Instrument Sans',system-ui,sans-serif;opacity:0;transition:opacity .2s ease;}",
      "#pp-toast.is-in{opacity:1;}",
      "#pp-toast .pp-bar{margin-top:8px;height:4px;border-radius:999px;background:rgba(255,253,247,.25);overflow:hidden;}",
      "#pp-toast .pp-bar span{display:block;height:100%;width:0;background:#7bc47a;transition:width .2s linear;}",
      "#pp-studio{position:fixed;inset:0;z-index:2147483600;background:#0d0e0f;display:flex;flex-direction:column;",
      "font-family:'Instrument Sans',system-ui,sans-serif;color:#f5f3ef;}",
      "#pp-studio .pp-stage{flex:1;position:relative;display:flex;align-items:center;justify-content:center;min-height:0;padding:8px;}",
      "#pp-studio canvas{display:block;max-width:100%;max-height:100%;width:auto;height:auto;",
      "border-radius:10px;background:#0d0e0f;touch-action:none;box-shadow:0 18px 48px rgba(0,0,0,.5);}",
      "#pp-studio .pp-close{position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:50%;border:0;",
      "background:rgba(255,253,247,.14);color:#fffdf7;font-size:20px;cursor:pointer;z-index:2;}",
      "#pp-studio .pp-close:hover{background:rgba(255,253,247,.28);}",
      "#pp-studio .pp-status{text-align:center;font-size:12px;color:#a8a39b;padding:2px 12px 6px;min-height:16px;}",
      "#pp-studio .pp-bararea{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;",
      "padding:10px 12px calc(12px + env(safe-area-inset-bottom));background:#141517;border-top:1px solid #26282b;}",
      "#pp-studio .pp-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 14px;border-radius:10px;",
      "border:1px solid #2a2c2f;background:#1b1d20;color:#f5f3ef;font-size:13px;font-weight:600;cursor:pointer;",
      "font-family:inherit;-webkit-tap-highlight-color:transparent;}",
      "#pp-studio .pp-btn:hover{background:#23262a;}",
      "#pp-studio .pp-btn:disabled{opacity:.45;}",
      "#pp-studio .pp-btn.primary{background:#2d5a3d;border-color:#2d5a3d;}",
      "#pp-studio .pp-btn.rec.is-rec{background:#e5484d;border-color:#e5484d;}",
      "#pp-studio .pp-count{padding:10px 12px;color:#a8a39b;font-size:13px;}",
      "#pp-studio .pp-grp{display:inline-flex;gap:4px;padding:3px;border:1px solid #2a2c2f;border-radius:12px;}",
      "#pp-studio .pp-result{position:absolute;inset:0;background:rgba(13,14,15,.92);display:flex;flex-direction:column;",
      "align-items:center;justify-content:center;gap:14px;padding:20px;z-index:3;}",
      "#pp-studio .pp-result[hidden]{display:none;}",
      "#pp-studio .pp-result video{max-width:min(86vw,340px);width:100%;border-radius:10px;background:#000;border:1px solid #2a2c2f;}",
      "#pp-studio .pp-result .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}",
    ].join("");
    var style = document.createElement("style");
    style.id = "practice-pitch-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Toast ───────────────────────────────────────────────────────────
  var toastEl = null, toastTimer = null;
  function toast(msg, opts) {
    injectStyles();
    opts = opts || {};
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.id = "pp-toast"; document.body.appendChild(toastEl); }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    toastEl.innerHTML = "";
    var label = document.createElement("div"); label.textContent = msg; toastEl.appendChild(label);
    var fill = null;
    if (opts.progress) {
      var bar = document.createElement("div"); bar.className = "pp-bar";
      fill = document.createElement("span"); bar.appendChild(fill); toastEl.appendChild(bar);
    }
    requestAnimationFrame(function () { toastEl.classList.add("is-in"); });
    if (!opts.sticky) toastTimer = setTimeout(hideToast, opts.ms || 2600);
    return { progress: function (p) { if (fill) fill.style.width = Math.round(p * 100) + "%"; } };
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.classList.remove("is-in");
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  }

  // ── pdf.js loader + PDF → JPEG slides (upload) ──────────────────────
  var pdfReady = null;
  function loadPdfJs() {
    if (window.pdfjsLib) {
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER; } catch (e) {}
      return Promise.resolve(window.pdfjsLib);
    }
    if (pdfReady) return pdfReady;
    pdfReady = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = PDF_LIB;
      s.onload = function () {
        if (!window.pdfjsLib) { reject(new Error("pdf.js failed to load")); return; }
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER; } catch (e) {}
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error("pdf.js failed to load")); };
      document.head.appendChild(s);
    });
    return pdfReady;
  }
  function renderPdf(file, onProgress, opts) {
    opts = opts || {};
    var width = opts.width || SLIDE_WIDTH;
    var quality = opts.quality || JPEG_QUALITY;
    return loadPdfJs()
      .then(function (pdfjsLib) {
        return file.arrayBuffer().then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; });
      })
      .then(function (doc) {
        var n = Math.min(doc.numPages, MAX_PAGES);
        var slides = [], aspect = null, chain = Promise.resolve();
        for (var i = 1; i <= n; i++) {
          (function (pageNum) {
            chain = chain.then(function () {
              return doc.getPage(pageNum).then(function (page) {
                var base = page.getViewport({ scale: 1 });
                var vp = page.getViewport({ scale: width / base.width });
                var canvas = document.createElement("canvas");
                canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
                if (!aspect) aspect = canvas.width / canvas.height;
                return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise.then(function () {
                  slides.push(canvas.toDataURL("image/jpeg", quality));
                  if (onProgress) onProgress(pageNum / n);
                });
              });
            });
          })(i);
        }
        return chain.then(function () { return { slides: slides, aspect: aspect }; });
      });
  }
  function totalBytes(s) { var t = 0; for (var i = 0; i < s.length; i++) t += s[i].length; return t; }

  function upload() {
    var input = document.createElement("input");
    input.type = "file"; input.accept = "application/pdf,.pdf"; input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!file) return;
      if (!token()) { toast("Sign in to upload your pitch deck."); return; }
      var t = toast("Reading your deck…", { sticky: true, progress: true });
      renderPdf(file, function (p) { t.progress(p * 0.8); })
        .then(function (out) {
          if (!out.slides.length) throw new Error("No pages found in that PDF.");
          if (totalBytes(out.slides) > BUDGET_BYTES) {
            toast("Large deck — compressing…", { sticky: true, progress: true });
            return renderPdf(file, function (p) { t.progress(0.5 + p * 0.4); }, { width: 820, quality: 0.55 });
          }
          return out;
        })
        .then(function (out) {
          if (totalBytes(out.slides) > BUDGET_BYTES) throw new Error("That deck is too large to store. Try fewer slides.");
          t.progress(0.92);
          var name = (file.name || "Pitch deck").replace(/\.pdf$/i, "");
          return fetch(ENDPOINT, {
            method: "PUT",
            headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
            body: JSON.stringify({ data: { name: name, slides: out.slides, aspect: out.aspect, pages: out.slides.length } }),
          });
        })
        .then(function (res) {
          if (!res.ok) {
            if (res.status === 413) throw new Error("That deck is too large to store.");
            throw new Error("Upload failed (" + res.status + ").");
          }
          hideToast();
          toast("Deck uploaded — tap “Practice my pitch” to record.", { ms: 3600 });
        })
        .catch(function (err) { hideToast(); toast(err && err.message ? err.message : "Couldn't upload that deck."); });
    });
    input.click();
  }

  // ── Practice → recording studio ─────────────────────────────────────
  function practice() {
    if (!token()) { openStudio(SAMPLE_SLIDES, true); return; }
    var t = toast("Loading your deck…", { sticky: true });
    fetch(ENDPOINT, { method: "GET", headers: authHeaders() })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        hideToast();
        var deck = json && json.data;
        if (deck && Array.isArray(deck.slides) && deck.slides.length) openStudio(deck.slides, false);
        else openStudio(SAMPLE_SLIDES, true);
      })
      .catch(function () { hideToast(); openStudio(SAMPLE_SLIDES, true); });
  }

  function openStudio(slideSrcs, isSample) {
    injectStyles();

    var images = [], loaded = 0, idx = 0, ready = false;
    var camStream = null, camVideo = document.createElement("video");
    camVideo.muted = true; camVideo.setAttribute("playsinline", "");
    var recorder = null, chunks = [], recording = false, recordedUrl = null, raf = null;
    var bubble = { x: 0, y: 0, r: 0 }, drag = null;
    var CW = 1080, CH = 1920; // set from the first slide

    // DOM
    var root = document.createElement("div"); root.id = "pp-studio";
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Recording studio");
    var stage = document.createElement("div"); stage.className = "pp-stage";
    var canvas = document.createElement("canvas");
    stage.appendChild(canvas);
    var close = document.createElement("button");
    close.className = "pp-close"; close.type = "button"; close.setAttribute("aria-label", "Close"); close.innerHTML = "&times;";
    stage.appendChild(close);

    var result = document.createElement("div"); result.className = "pp-result"; result.hidden = true;
    var preview = document.createElement("video"); preview.controls = true; preview.setAttribute("playsinline", "");
    var rrow = document.createElement("div"); rrow.className = "row";
    var dl = document.createElement("a"); dl.className = "pp-btn primary"; dl.textContent = "Download"; dl.setAttribute("download", "pitch-recording.webm");
    var again = document.createElement("button"); again.className = "pp-btn"; again.type = "button"; again.textContent = "Record again";
    rrow.appendChild(dl); rrow.appendChild(again); result.appendChild(preview); result.appendChild(rrow);
    stage.appendChild(result);
    root.appendChild(stage);

    var statusEl = document.createElement("div"); statusEl.className = "pp-status";
    statusEl.textContent = isSample ? "Sample deck — upload your own to practice it." : "Enable your camera, then hit Record.";
    root.appendChild(statusEl);

    var bar = document.createElement("div"); bar.className = "pp-bararea";
    var bPrev = mk("‹ Prev"), bCount = mkSpan("pp-count"), bNext = mk("Next ›");
    var bCam = mk("Enable camera"), bRec = mk("Record", "pp-btn primary rec");
    var grp = document.createElement("span"); grp.className = "pp-grp";
    var bSmall = mk("－"), bBig = mk("＋"); grp.appendChild(bSmall); grp.appendChild(bBig);
    bRec.disabled = true;
    [bPrev, bCount, bNext, bCam, bRec, grp].forEach(function (el) { bar.appendChild(el); });
    root.appendChild(bar);

    document.body.appendChild(root);
    var prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";

    function mk(label, cls) { var b = document.createElement("button"); b.type = "button"; b.className = cls || "pp-btn"; b.textContent = label; return b; }
    function mkSpan(cls) { var s = document.createElement("span"); s.className = cls; return s; }
    function status(m) { statusEl.textContent = m; }

    // Preload slides; size the canvas to the first slide.
    slideSrcs.forEach(function (src, i) {
      var img = new Image();
      img.onload = function () {
        loaded++;
        if (i === 0) {
          var scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
          CW = Math.round(img.naturalWidth * scale); CH = Math.round(img.naturalHeight * scale);
          canvas.width = CW; canvas.height = CH;
          bubble.r = Math.round(CW * 0.16);
          bubble.x = CW - bubble.r - Math.round(CW * 0.04);
          bubble.y = CH - bubble.r - Math.round(CW * 0.04);
          ready = true;
        }
      };
      img.src = src;
      images[i] = img;
    });

    var ctx = canvas.getContext("2d");
    function loop() {
      if (ready) {
        ctx.fillStyle = "#0d0e0f"; ctx.fillRect(0, 0, CW, CH);
        var img = images[idx];
        if (img && img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, CW, CH);
        drawBubble();
      }
      raf = requestAnimationFrame(loop);
    }
    function drawBubble() {
      if (!camStream || !camVideo.videoWidth) return;
      var x = bubble.x, y = bubble.y, r = bubble.r;
      var vw = camVideo.videoWidth, vh = camVideo.videoHeight, s = Math.min(vw, vh);
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      ctx.translate(x, y); ctx.scale(-1, 1); ctx.translate(-x, -y);
      ctx.drawImage(camVideo, (vw - s) / 2, (vh - s) / 2, s, s, x - r, y - r, 2 * r, 2 * r);
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = 6; ctx.strokeStyle = "rgba(255,253,247,.95)"; ctx.stroke();
      if (recording) { ctx.beginPath(); ctx.arc(x + r * 0.62, y - r * 0.62, 11, 0, Math.PI * 2); ctx.fillStyle = "#e5484d"; ctx.fill(); }
    }
    raf = requestAnimationFrame(loop);

    function go(n) { idx = Math.max(0, Math.min(slideSrcs.length - 1, n)); bCount.textContent = (idx + 1) + " / " + slideSrcs.length; }
    go(0);

    function enableCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status("This browser can't access the camera."); return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true })
        .then(function (stream) {
          camStream = stream; camVideo.srcObject = stream; camVideo.play().catch(function () {});
          bCam.textContent = "Camera on"; bCam.disabled = true; bRec.disabled = false;
          status("Drag your face bubble anywhere; hit Record when you're set.");
        })
        .catch(function () { status("Camera/mic permission was blocked. Allow it, then retry."); });
    }
    function pickMime() {
      var ts = ["video/mp4;codecs=h264,aac", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
      for (var i = 0; i < ts.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(ts[i])) return ts[i];
      return "";
    }
    function startRec() {
      var stream = canvas.captureStream(30);
      if (camStream) camStream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
      var mime = pickMime();
      try { recorder = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 }) : new MediaRecorder(stream); }
      catch (e) { status("Recording isn't supported here."); return; }
      chunks = [];
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = function () {
        var type = recorder.mimeType || "video/webm";
        var blob = new Blob(chunks, { type: type });
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        recordedUrl = URL.createObjectURL(blob);
        dl.href = recordedUrl; dl.setAttribute("download", "pitch-recording." + (type.indexOf("mp4") >= 0 ? "mp4" : "webm"));
        preview.src = recordedUrl; result.hidden = false;
      };
      recorder.start(); recording = true;
      bRec.textContent = "Stop"; bRec.classList.add("is-rec"); status("Recording… present, then hit Stop.");
    }
    function stopRec() {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recording = false; bRec.textContent = "Record"; bRec.classList.remove("is-rec");
    }
    function toggleRec() { if (!camStream) { enableCamera(); return; } if (recording) stopRec(); else startRec(); }
    function setSize(d) {
      bubble.r = Math.max(Math.round(CW * 0.08), Math.min(Math.round(CW * 0.34), bubble.r + d));
      bubble.x = Math.max(bubble.r, Math.min(CW - bubble.r, bubble.x));
      bubble.y = Math.max(bubble.r, Math.min(CH - bubble.r, bubble.y));
    }
    function toCanvas(e) {
      var rect = canvas.getBoundingClientRect(); var p = e.touches ? e.touches[0] : e;
      return { x: (p.clientX - rect.left) * (CW / rect.width), y: (p.clientY - rect.top) * (CH / rect.height) };
    }
    function onDown(e) { var c = toCanvas(e); if (Math.hypot(c.x - bubble.x, c.y - bubble.y) <= bubble.r) { drag = { dx: c.x - bubble.x, dy: c.y - bubble.y }; if (e.cancelable) e.preventDefault(); } }
    function onMove(e) { if (!drag) return; var c = toCanvas(e); bubble.x = Math.max(bubble.r, Math.min(CW - bubble.r, c.x - drag.dx)); bubble.y = Math.max(bubble.r, Math.min(CH - bubble.r, c.y - drag.dy)); if (e.cancelable) e.preventDefault(); }
    function onUp() { drag = null; }

    bPrev.addEventListener("click", function () { go(idx - 1); });
    bNext.addEventListener("click", function () { go(idx + 1); });
    bCam.addEventListener("click", enableCamera);
    bRec.addEventListener("click", toggleRec);
    bSmall.addEventListener("click", function () { setSize(-Math.round(CW * 0.04)); });
    bBig.addEventListener("click", function () { setSize(Math.round(CW * 0.04)); });
    again.addEventListener("click", function () { result.hidden = true; });
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("touchstart", onDown, { passive: false });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    function onKey(e) {
      if (e.key === "Escape") teardown();
      else if (e.key === "ArrowRight") go(idx + 1);
      else if (e.key === "ArrowLeft") go(idx - 1);
    }
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", teardown);

    function teardown() {
      if (raf) cancelAnimationFrame(raf);
      stopRec();
      if (camStream) camStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      document.body.style.overflow = prevOverflow;
      if (root.parentNode) root.parentNode.removeChild(root);
    }
  }

  window.tinkerPracticePitch = { upload: upload, practice: practice };
})();
