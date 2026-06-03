/* practice-pitch.js — upload a pitch deck and practice it as a slideshow.
 *
 * Exposes window.tinkerPracticePitch with two actions, wired from the
 * profile menu (see profile.js):
 *
 *   .upload()   — pick a PDF, render each page to a downscaled JPEG with
 *                 pdf.js, and PUT the slide images to /api/pitch-deck.
 *   .practice() — fetch the stored deck and open a full-screen, auto-
 *                 advancing slideshow you can talk over while you rehearse.
 *
 * Storage: one TinkerUserData row (kind "pitchDeck") via /api/pitch-deck —
 * a dedicated route with a larger body cap than the 256 KB user-data limit.
 * Rendering the PDF to images up front means the practice view is just
 * <img>s (no pdf.js needed to view), and the original file never leaves the
 * device beyond those slides.
 *
 * Self-contained: injects its own styles, talks same-origin only
 * (CSP connect-src 'self'), and uses the vendored pdf.js at
 * ./lib/pdfjs/. Auth mirrors sync.js — Bearer <tinker_jwt>.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var ENDPOINT = "/api/pitch-deck";
  var PDF_LIB = "./lib/pdfjs/pdf.min.js";
  var PDF_WORKER = "./lib/pdfjs/pdf.worker.min.js";
  var SLIDE_WIDTH = 1080; // px, longest edge of a rendered slide
  var JPEG_QUALITY = 0.7;
  var MAX_PAGES = 40;
  var BUDGET_BYTES = 3.6 * 1024 * 1024; // keep the PUT under the 4 MB cap
  var ADVANCE_MS = 7000; // auto-advance dwell per slide

  // Bundled sample deck (rendered from the canonical pitch deck). Lets
  // "Practice my pitch" jump straight to playback before anything is
  // uploaded — handy for testing and as a first-run demo. The MP4 is a real
  // <video>, so it supports native iPhone Picture-in-Picture.
  var SAMPLE_VIDEO = "./lib/sample-pitch/sample.mp4";
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
  function authHeaders() {
    return { Authorization: "Bearer " + token() };
  }

  // ── Styles ──────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("practice-pitch-styles")) return;
    var css = [
      "#pp-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483600;",
      "max-width:calc(100vw - 32px);background:#2d2a26;color:#fffdf7;font-size:14px;line-height:1.4;",
      "padding:12px 18px;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.28);",
      "font-family:'Instrument Sans',system-ui,sans-serif;opacity:0;transition:opacity .2s ease;}",
      "#pp-toast.is-in{opacity:1;}",
      "#pp-toast .pp-bar{margin-top:8px;height:4px;border-radius:999px;background:rgba(255,253,247,.25);overflow:hidden;}",
      "#pp-toast .pp-bar span{display:block;height:100%;width:0;background:#7bc47a;transition:width .2s linear;}",
      "#pp-stage{position:fixed;inset:0;z-index:2147483500;background:#1c1a17;display:flex;flex-direction:column;",
      "align-items:center;justify-content:center;font-family:'Instrument Sans',system-ui,sans-serif;}",
      "#pp-stage .pp-slide,#pp-stage .pp-video{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;",
      "box-shadow:0 18px 48px rgba(0,0,0,.5);background:#1c1a17;}",
      "#pp-stage .pp-video{background:#000;border-radius:6px;}",
      "#pp-stage .pp-pip{position:absolute;bottom:18px;right:18px;display:inline-flex;align-items:center;gap:8px;",
      "padding:10px 16px;border:0;border-radius:999px;background:#2d5a3d;color:#fffdf7;font-size:13px;",
      "font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35);}",
      "#pp-stage .pp-pip:hover{background:#244b32;}",
      "#pp-stage .pp-pip[hidden]{display:none;}",
      "#pp-stage .pp-controls{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:14px;",
      "padding:16px 20px;background:linear-gradient(transparent,rgba(0,0,0,.55));color:#fffdf7;}",
      "#pp-stage .pp-controls button{appearance:none;border:0;background:rgba(255,253,247,.14);color:#fffdf7;",
      "width:40px;height:40px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;",
      "justify-content:center;transition:background .12s;}",
      "#pp-stage .pp-controls button:hover{background:rgba(255,253,247,.28);}",
      "#pp-stage .pp-count{font-size:13px;letter-spacing:.04em;min-width:54px;text-align:center;}",
      "#pp-stage .pp-progress{flex:1;height:4px;border-radius:999px;background:rgba(255,253,247,.2);overflow:hidden;}",
      "#pp-stage .pp-progress span{display:block;height:100%;width:0;background:#7bc47a;}",
      "#pp-stage .pp-close{position:absolute;top:16px;right:18px;width:40px;height:40px;border-radius:50%;",
      "border:0;background:rgba(255,253,247,.14);color:#fffdf7;font-size:20px;cursor:pointer;}",
      "#pp-stage .pp-close:hover{background:rgba(255,253,247,.28);}",
      "#pp-stage .pp-hint{position:absolute;top:18px;left:20px;font-size:12px;color:rgba(255,253,247,.7);letter-spacing:.04em;}",
      "@media (max-width:560px){#pp-stage .pp-controls{gap:10px;padding:12px;}}",
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
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "pp-toast";
      document.body.appendChild(toastEl);
    }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    toastEl.innerHTML = "";
    var label = document.createElement("div");
    label.textContent = msg;
    toastEl.appendChild(label);
    var fill = null;
    if (opts.progress) {
      var bar = document.createElement("div");
      bar.className = "pp-bar";
      fill = document.createElement("span");
      bar.appendChild(fill);
      toastEl.appendChild(bar);
    }
    requestAnimationFrame(function () { toastEl.classList.add("is-in"); });
    if (!opts.sticky) {
      toastTimer = setTimeout(hideToast, opts.ms || 2600);
    }
    return {
      progress: function (p) { if (fill) fill.style.width = Math.round(p * 100) + "%"; },
    };
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.classList.remove("is-in");
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  }

  // ── pdf.js loader ───────────────────────────────────────────────────
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

  // ── Render a PDF File → array of JPEG data URLs ──────────────────────
  function renderPdf(file, onProgress, opts) {
    opts = opts || {};
    var width = opts.width || SLIDE_WIDTH;
    var quality = opts.quality || JPEG_QUALITY;
    return loadPdfJs()
      .then(function (pdfjsLib) {
        return file.arrayBuffer().then(function (buf) {
          return pdfjsLib.getDocument({ data: buf }).promise;
        });
      })
      .then(function (doc) {
        var n = Math.min(doc.numPages, MAX_PAGES);
        var slides = [];
        var aspect = null;
        var chain = Promise.resolve();
        for (var i = 1; i <= n; i++) {
          (function (pageNum) {
            chain = chain.then(function () {
              return doc.getPage(pageNum).then(function (page) {
                var base = page.getViewport({ scale: 1 });
                var scale = width / base.width;
                var vp = page.getViewport({ scale: scale });
                var canvas = document.createElement("canvas");
                canvas.width = Math.round(vp.width);
                canvas.height = Math.round(vp.height);
                if (!aspect) aspect = canvas.width / canvas.height;
                var ctx = canvas.getContext("2d");
                return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                  slides.push(canvas.toDataURL("image/jpeg", quality));
                  if (onProgress) onProgress(pageNum / n);
                });
              });
            });
          })(i);
        }
        return chain.then(function () {
          return { slides: slides, aspect: aspect, pages: n, total: doc.numPages };
        });
      });
  }

  function totalBytes(slides) {
    var t = 0;
    for (var i = 0; i < slides.length; i++) t += slides[i].length;
    return t;
  }

  // ── Upload flow ─────────────────────────────────────────────────────
  function upload() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.style.display = "none";
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
          // Stay under the body cap — re-render smaller if the deck is heavy.
          if (totalBytes(out.slides) > BUDGET_BYTES) {
            toast("Large deck — compressing…", { sticky: true, progress: true });
            return renderPdf(file, function (p) { t.progress(0.5 + p * 0.4); }, { width: 820, quality: 0.55 });
          }
          return out;
        })
        .then(function (out) {
          if (totalBytes(out.slides) > BUDGET_BYTES) {
            throw new Error("That deck is too large to store. Try fewer slides.");
          }
          t.progress(0.92);
          var name = (file.name || "Pitch deck").replace(/\.pdf$/i, "");
          var payload = { name: name, slides: out.slides, aspect: out.aspect, pages: out.slides.length };
          return fetch(ENDPOINT, {
            method: "PUT",
            headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
            body: JSON.stringify({ data: payload }),
          });
        })
        .then(function (res) {
          if (!res.ok) {
            if (res.status === 413) throw new Error("That deck is too large to store. Try fewer/lighter slides.");
            throw new Error("Upload failed (" + res.status + ").");
          }
          hideToast();
          toast("Deck uploaded — tap “Practice my pitch” to rehearse.", { ms: 3600 });
        })
        .catch(function (err) {
          hideToast();
          toast(err && err.message ? err.message : "Couldn't upload that deck.");
        });
    });
    input.click();
  }

  // ── Practice (slideshow) flow ───────────────────────────────────────
  function practice() {
    // Always land on the video playback. Use the founder's uploaded deck when
    // we can fetch one; otherwise fall back to the bundled sample deck so the
    // button is testable immediately (no upload required).
    if (!token()) { openVideoStage(SAMPLE_VIDEO, true); return; }
    var t = toast("Loading your deck…", { sticky: true });
    fetch(ENDPOINT, { method: "GET", headers: authHeaders() })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        hideToast();
        var deck = json && json.data;
        if (deck && deck.videoUrl) {
          openVideoStage(deck.videoUrl, false);
        } else if (deck && Array.isArray(deck.slides) && deck.slides.length) {
          // Uploaded decks play as an image slideshow until a real MP4 is
          // rendered for them (server-side, a follow-up). No native PiP yet.
          openStage(deck.slides, false);
        } else {
          // Nothing uploaded → the bundled sample MP4, which supports PiP.
          openVideoStage(SAMPLE_VIDEO, true);
        }
      })
      .catch(function () {
        hideToast();
        openVideoStage(SAMPLE_VIDEO, true);
      });
  }

  // ── Video stage (real <video>, so iPhone Picture-in-Picture works) ───
  function openVideoStage(url, isSample) {
    injectStyles();

    var stage = document.createElement("div");
    stage.id = "pp-stage";
    stage.setAttribute("role", "dialog");
    stage.setAttribute("aria-label", "Practice your pitch");

    var video = document.createElement("video");
    video.className = "pp-video";
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    stage.appendChild(video);

    var hint = document.createElement("div");
    hint.className = "pp-hint";
    hint.textContent = isSample
      ? "Sample deck — upload your own to practice it"
      : "Practice — talk through your pitch";
    stage.appendChild(hint);

    var close = document.createElement("button");
    close.className = "pp-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.innerHTML = "&times;";
    stage.appendChild(close);

    // Picture-in-Picture: float the video so you can record yourself over it.
    var hasStdPip = "pictureInPictureEnabled" in document && document.pictureInPictureEnabled &&
      typeof video.requestPictureInPicture === "function";
    var hasWebkitPip = typeof video.webkitSetPresentationMode === "function" &&
      typeof video.webkitSupportsPresentationMode === "function" &&
      video.webkitSupportsPresentationMode("picture-in-picture");
    var pip = document.createElement("button");
    pip.className = "pp-pip";
    pip.type = "button";
    pip.textContent = "⤢ Picture-in-Picture";
    if (!hasStdPip && !hasWebkitPip) pip.hidden = true;
    pip.addEventListener("click", function () {
      try {
        if (hasStdPip) {
          if (document.pictureInPictureElement) document.exitPictureInPicture();
          else { var p = video.play(); if (p && p.then) p.then(goPip).catch(goPip); else goPip(); }
        } else {
          video.webkitSetPresentationMode(
            video.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture"
          );
        }
      } catch (e) { /* native controls still offer PiP */ }
    });
    function goPip() { video.requestPictureInPicture().catch(function () {}); }
    stage.appendChild(pip);

    document.body.appendChild(stage);
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e) { if (e.key === "Escape") teardown(); }
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", teardown);

    function teardown() {
      document.removeEventListener("keydown", onKey);
      try { if (document.pictureInPictureElement) document.exitPictureInPicture(); } catch (e) {}
      try { video.pause(); } catch (e) {}
      document.body.style.overflow = prevOverflow;
      if (stage.parentNode) stage.parentNode.removeChild(stage);
    }

    var pr = video.play();
    if (pr && pr.catch) pr.catch(function () {});
  }

  function openStage(slides, isSample) {
    injectStyles();
    var idx = 0, playing = true, timer = null, raf = null, startTs = 0;

    var stage = document.createElement("div");
    stage.id = "pp-stage";
    stage.setAttribute("role", "dialog");
    stage.setAttribute("aria-label", "Practice your pitch");

    var img = document.createElement("img");
    img.className = "pp-slide";
    img.alt = "";
    stage.appendChild(img);

    var hint = document.createElement("div");
    hint.className = "pp-hint";
    hint.textContent = isSample
      ? "Sample deck — upload your own to practice it"
      : "Practice — talk through each slide";
    stage.appendChild(hint);

    var close = document.createElement("button");
    close.className = "pp-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.innerHTML = "&times;";
    stage.appendChild(close);

    var controls = document.createElement("div");
    controls.className = "pp-controls";
    var prev = mkBtn("‹", "Previous slide");
    var play = mkBtn("❚❚", "Pause");
    var next = mkBtn("›", "Next slide");
    var count = document.createElement("span");
    count.className = "pp-count";
    var prog = document.createElement("div");
    prog.className = "pp-progress";
    var progFill = document.createElement("span");
    prog.appendChild(progFill);
    var full = mkBtn("⤢", "Fullscreen");
    controls.appendChild(prev);
    controls.appendChild(play);
    controls.appendChild(next);
    controls.appendChild(count);
    controls.appendChild(prog);
    controls.appendChild(full);
    stage.appendChild(controls);

    document.body.appendChild(stage);
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function mkBtn(label, aria) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-label", aria);
      return b;
    }

    function show(i) {
      idx = (i + slides.length) % slides.length;
      img.src = slides[idx];
      count.textContent = (idx + 1) + " / " + slides.length;
      restartTimer();
    }
    function tick() {
      if (!playing) return;
      var elapsed = Date.now() - startTs;
      progFill.style.width = Math.min(100, (elapsed / ADVANCE_MS) * 100) + "%";
      if (elapsed >= ADVANCE_MS) {
        if (idx === slides.length - 1) { setPlaying(false); progFill.style.width = "100%"; return; }
        show(idx + 1);
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    function restartTimer() {
      startTs = Date.now();
      progFill.style.width = "0";
      if (raf) cancelAnimationFrame(raf);
      if (playing) raf = requestAnimationFrame(tick);
    }
    function setPlaying(p) {
      playing = p;
      play.textContent = p ? "❚❚" : "▶";
      play.setAttribute("aria-label", p ? "Pause" : "Play");
      if (p) restartTimer();
      else if (raf) cancelAnimationFrame(raf);
    }

    prev.addEventListener("click", function () { show(idx - 1); });
    next.addEventListener("click", function () { show(idx + 1); });
    play.addEventListener("click", function () { setPlaying(!playing); });
    full.addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (stage.requestFullscreen) stage.requestFullscreen().catch(function () {});
    });

    function onKey(e) {
      if (e.key === "Escape") teardown();
      else if (e.key === "ArrowRight") show(idx + 1);
      else if (e.key === "ArrowLeft") show(idx - 1);
      else if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
    }
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", teardown);

    function teardown() {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
      document.body.style.overflow = prevOverflow;
      if (stage.parentNode) stage.parentNode.removeChild(stage);
    }

    show(0);
  }

  window.tinkerPracticePitch = { upload: upload, practice: practice };
})();
