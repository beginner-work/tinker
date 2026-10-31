/* Tinker reading-agent widget (browser).
 *
 * Talks to same-origin /api/reading (iframe on tinker) or a host proxy
 * via opts.apiBase. Never holds TINKER_SERVICE_TOKEN in the page when
 * using a host proxy; public session bootstrap is allowed for the
 * same-origin widget.
 */
(function (global) {
  "use strict";

  var BANNED_VOICE = "JlYdFGRHWwlz51Zh5K2n";

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function params() {
    try {
      return new URLSearchParams(global.location.search || "");
    } catch {
      return new URLSearchParams();
    }
  }

  function apiBaseFrom(opts) {
    if (opts && opts.apiBase) return String(opts.apiBase).replace(/\/$/, "");
    return "";
  }

  function endpoint(base, action) {
    return (base || "") + "/api/reading?action=" + encodeURIComponent(action);
  }

  async function postJson(url, body, headers) {
    var res = await fetch(url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: JSON.stringify(body || {}),
      credentials: "same-origin",
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      var err = new Error(data.error || "Request failed");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function b64ToObjectUrl(b64, contentType) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var blob = new Blob([bytes], { type: contentType || "audio/mpeg" });
    return URL.createObjectURL(blob);
  }

  function metricsClient() {
    return global.tinkerMetricsClient || null;
  }

  function ReadingWidget(root, opts) {
    this.root = root;
    this.opts = opts || {};
    this.apiBase = apiBaseFrom(this.opts);
    this.headers = this.opts.headers || {};
    this.session = null;
    this.state = "idle";
    this.wordIndex = 0;
    this.wordCount = 0;
    this.playing = false;
    this.audio = new Audio();
    this.audioEl = this.audio;
    this._objectUrl = null;
    this._bound = false;
    this.metrics = null;
    var mc = metricsClient();
    if (mc && typeof mc.initReadingMetrics === "function") {
      this.metrics = mc.initReadingMetrics({
        embedHost: this.opts.embedHost || params().get("embedHost") || "",
      });
    } else {
      this.metrics = {
        anonymousId: "",
        isOwner: params().get("owner") === "1",
        host: this.opts.embedHost || params().get("embedHost") || "",
      };
    }
    this.render();
    this.bind();
    var url = this.opts.url || params().get("url") || "";
    if (url) {
      this.startSession(url);
    }
  }

  ReadingWidget.prototype.clientMeta = function () {
    var m = this.metrics || {};
    var out = {};
    if (m.anonymousId) out.anonymousId = m.anonymousId;
    if (m.isOwner) out.owner = "1";
    if (m.host) out.embedHost = m.host;
    return out;
  };

  ReadingWidget.prototype.setStatus = function (text, tone) {
    var el = qs("[data-rw-status]", this.root);
    if (!el) return;
    el.textContent = text || "";
    el.setAttribute("data-tone", tone || "");
  };

  ReadingWidget.prototype.setProgress = function () {
    var bar = qs("[data-rw-progress] > i", this.root);
    if (!bar) return;
    var pct = this.wordCount ? Math.min(100, (this.wordIndex / this.wordCount) * 100) : 0;
    bar.style.width = pct.toFixed(1) + "%";
  };

  ReadingWidget.prototype.render = function () {
    this.root.innerHTML =
      '<div class="rw-shell">' +
      '  <div class="rw-card" role="region" aria-label="Tinker reading agent">' +
      '    <h1 class="rw-brand">Tinker <span>Reading</span></h1>' +
      '    <p class="rw-meta" data-rw-meta>Paste or open a public article URL to hear it read aloud. Interrupt anytime.</p>' +
      '    <p class="rw-status" data-rw-status role="status"></p>' +
      '    <div class="rw-progress" data-rw-progress aria-hidden="true"><i></i></div>' +
      '    <div class="rw-controls">' +
      '      <button type="button" class="rw-btn rw-btn-primary" data-rw-play disabled>Listen</button>' +
      '      <button type="button" class="rw-btn rw-btn-ghost" data-rw-pause disabled>Pause</button>' +
      '      <button type="button" class="rw-btn rw-btn-ghost" data-rw-interrupt disabled>Ask</button>' +
      '    </div>' +
      '    <div class="rw-interrupt" data-rw-ask-panel hidden>' +
      '      <label for="rw-question">Interrupt with a question</label>' +
      '      <textarea id="rw-question" data-rw-question placeholder="What does the author mean here?"></textarea>' +
      '      <div class="rw-controls">' +
      '        <button type="button" class="rw-btn rw-btn-primary" data-rw-ask-send>Ask aloud</button>' +
      '        <button type="button" class="rw-btn rw-btn-ghost" data-rw-ask-cancel>Cancel</button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="rw-answer" data-rw-answer>' +
      '      <strong>Answer</strong>' +
      '      <p data-rw-answer-text></p>' +
      '    </div>' +
      '    <div class="rw-footer">' +
      '      <a href="#" data-rw-source rel="noopener noreferrer" target="_blank">Original article</a>' +
      '      <a href="https://www.linkedin.com/in/tlindow" data-rw-linkedin rel="noopener noreferrer" target="_blank">LinkedIn</a>' +
      '      <a href="mailto:tyler@lindowlabs.dev" data-rw-email>Email Tyler</a>' +
      '    </div>' +
      "  </div>" +
      "</div>";
  };

  ReadingWidget.prototype.bind = function () {
    if (this._bound) return;
    this._bound = true;
    var self = this;
    qs("[data-rw-play]", this.root).addEventListener("click", function () {
      self.resumeReading();
    });
    qs("[data-rw-pause]", this.root).addEventListener("click", function () {
      self.pauseReading();
    });
    qs("[data-rw-interrupt]", this.root).addEventListener("click", function () {
      self.openAsk();
    });
    qs("[data-rw-ask-cancel]", this.root).addEventListener("click", function () {
      self.closeAsk();
    });
    qs("[data-rw-ask-send]", this.root).addEventListener("click", function () {
      self.submitAsk();
    });
    qs("[data-rw-linkedin]", this.root).addEventListener("click", function () {
      self.logEvent("linkedin");
    });
    qs("[data-rw-email]", this.root).addEventListener("click", function () {
      self.logEvent("email");
    });
    qs("[data-rw-source]", this.root).addEventListener("click", function () {
      self.logEvent("source");
    });
    this.audio.addEventListener("ended", function () {
      if (self.state === "answering") {
        self.state = "ready";
        self.setStatus("Resuming where you left off.");
        self.resumeReading();
        return;
      }
      if (self.playing) self.speakNext();
    });
  };

  ReadingWidget.prototype.setButtons = function (enabled) {
    qs("[data-rw-play]", this.root).disabled = !enabled;
    qs("[data-rw-pause]", this.root).disabled = !enabled;
    qs("[data-rw-interrupt]", this.root).disabled = !enabled;
  };

  ReadingWidget.prototype.startSession = async function (url) {
    this.setStatus("Fetching article…", "busy");
    this.setButtons(false);
    try {
      var body = Object.assign({ url: url }, this.clientMeta());
      var data = await postJson(
        endpoint(this.apiBase, "session"),
        body,
        this.headers,
      );
      this.session = data;
      this.wordIndex = 0;
      this.wordCount = data.wordCount || 0;
      this.setProgress();
      var meta = qs("[data-rw-meta]", this.root);
      var bits = [];
      bits.push(data.attribution || data.title || "Article");
      if (data.author) bits.push("Attributed to " + data.author);
      bits.push("Linking back to the original.");
      meta.innerHTML =
        bits.join(" · ") +
        ' <a href="' +
        String(data.sourceUrl).replace(/"/g, "&quot;") +
        '" target="_blank" rel="noopener noreferrer">Open source</a>';
      var src = qs("[data-rw-source]", this.root);
      src.href = data.sourceUrl;
      var mc = metricsClient();
      if (mc && typeof mc.trackSessionStart === "function") {
        mc.trackSessionStart({
          sessionId: data.sessionId || "",
          anonymousId: (this.metrics && this.metrics.anonymousId) || "",
          sourceHost: data.companyHost || "",
          host: (this.metrics && this.metrics.host) || "",
        });
      }
      this.setButtons(true);
      this.state = "ready";
      this.setStatus("Ready. Press Listen.");
      if (this.opts.autoplay) this.resumeReading();
    } catch (err) {
      this.setStatus(err.message || "Could not start session", "error");
    }
  };

  ReadingWidget.prototype.pauseReading = function () {
    this.playing = false;
    this.audio.pause();
    this.state = "paused";
    this.setStatus("Paused at word " + this.wordIndex + ".");
  };

  ReadingWidget.prototype.openAsk = function () {
    this.pauseReading();
    qs("[data-rw-ask-panel]", this.root).hidden = false;
    qs("[data-rw-question]", this.root).focus();
  };

  ReadingWidget.prototype.closeAsk = function () {
    qs("[data-rw-ask-panel]", this.root).hidden = true;
  };

  ReadingWidget.prototype.clearObjectUrl = function () {
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  };

  ReadingWidget.prototype.playBase64 = function (b64, contentType) {
    this.clearObjectUrl();
    if (!b64) return Promise.resolve();
    this._objectUrl = b64ToObjectUrl(b64, contentType);
    this.audio.src = this._objectUrl;
    return this.audio.play().catch(function () {
      /* autoplay may be blocked until gesture */
    });
  };

  ReadingWidget.prototype.speakNext = async function () {
    if (!this.session || !this.playing) return;
    this.setStatus("Reading…", "busy");
    try {
      var data = await postJson(
        endpoint(this.apiBase, "speak"),
        {
          sessionId: this.session.sessionId,
          fromWordIndex: this.wordIndex,
        },
        this.headers,
      );
      if (data.voiceId === BANNED_VOICE) {
        throw new Error("Refusing banned voice id");
      }
      this.wordIndex = data.toWordIndex || this.wordIndex;
      this.wordCount = data.wordCount || this.wordCount;
      this.setProgress();
      if (data.done && !data.audio) {
        this.playing = false;
        this.state = "done";
        this.setStatus("Finished reading.");
        return;
      }
      this.state = "reading";
      await this.playBase64(data.audio, data.contentType);
      if (data.done) {
        // Last chunk is playing; ended handler will mark done if no more.
        this._lastChunkDone = true;
      } else {
        this._lastChunkDone = false;
      }
    } catch (err) {
      this.playing = false;
      this.setStatus(err.message || "Speak failed", "error");
    }
  };

  ReadingWidget.prototype.resumeReading = function () {
    if (!this.session) return;
    this.closeAsk();
    this.playing = true;
    this.state = "reading";
    this.logEvent("resume");
    this.speakNext();
  };

  ReadingWidget.prototype.submitAsk = async function () {
    if (!this.session) return;
    var question = String(qs("[data-rw-question]", this.root).value || "").trim();
    if (!question) {
      this.setStatus("Type a question first.", "error");
      return;
    }
    this.pauseReading();
    this.setStatus("Thinking…", "busy");
    qs("[data-rw-ask-send]", this.root).disabled = true;
    try {
      var askBody = Object.assign(
        {
          sessionId: this.session.sessionId,
          question: question,
          input: "typed",
          position: { wordIndex: this.wordIndex },
        },
        this.clientMeta(),
      );
      var data = await postJson(
        endpoint(this.apiBase, "ask"),
        askBody,
        this.headers,
      );
      this.wordIndex =
        typeof data.resumeWordIndex === "number" ? data.resumeWordIndex : this.wordIndex;
      var answerBox = qs("[data-rw-answer]", this.root);
      var answerText = qs("[data-rw-answer-text]", this.root);
      answerText.textContent = data.answerText || "";
      answerBox.classList.add("is-on");
      qs("[data-rw-question]", this.root).value = "";
      this.closeAsk();
      var mc = metricsClient();
      if (mc && typeof mc.trackQuestionAsked === "function") {
        mc.trackQuestionAsked({
          sessionId: this.session.sessionId,
          anonymousId: (this.metrics && this.metrics.anonymousId) || "",
          input: "typed",
          sourceHost: data.companyHost || "",
        });
      }
      this.state = "answering";
      this.setStatus(
        data.fetchedSource
          ? "Answered with a linked source. Resuming after playback."
          : "Answered from the article. Resuming after playback.",
        "busy",
      );
      await this.playBase64(data.audio, "audio/mpeg");
    } catch (err) {
      this.setStatus(err.message || "Ask failed", "error");
    } finally {
      qs("[data-rw-ask-send]", this.root).disabled = false;
    }
  };

  ReadingWidget.prototype.logEvent = function (target) {
    if (!this.session) return;
    var body = Object.assign(
      {
        sessionId: this.session.sessionId,
        target: target,
        wordIndex: this.wordIndex,
      },
      this.clientMeta(),
    );
    postJson(endpoint(this.apiBase, "event"), body, this.headers).catch(
      function () {
        /* non-blocking */
      },
    );
    if (["linkedin", "email", "source"].indexOf(target) !== -1) {
      var mc = metricsClient();
      if (mc && typeof mc.trackAnswerLinkClick === "function") {
        mc.trackAnswerLinkClick({
          sessionId: this.session.sessionId,
          anonymousId: (this.metrics && this.metrics.anonymousId) || "",
          target: target,
        });
      }
    }
  };

  function mount(selectorOrEl, opts) {
    var el =
      typeof selectorOrEl === "string"
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
    if (!el) throw new Error("Reading widget mount not found");
    return new ReadingWidget(el, opts || {});
  }

  global.TinkerReadingWidget = {
    mount: mount,
    ReadingWidget: ReadingWidget,
  };
})(typeof window !== "undefined" ? window : globalThis);
