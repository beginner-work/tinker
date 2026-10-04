/* Pure analytics client helpers.
 *
 * UMD: Node tests (module.exports) + browser (window.tinkerAnalyticsCore).
 * Never queues draft text, titles, or key values.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("./analytics-keystrokes.js") : null
    );
  } else {
    root.tinkerAnalyticsCore = factory(root.tinkerAnalyticsKeystrokes || null);
  }
})(typeof self !== "undefined" ? self : this, function (keystrokes) {
  "use strict";

  if (!keystrokes) {
    throw new Error("analytics-keystrokes is required");
  }

  var AID_KEY = "tinker.analytics.aid";
  var SID_KEY = "tinker.analytics.sid";
  var SID_AT_KEY = "tinker.analytics.sid_at";
  var FIRST_TOUCH_KEY = "tinker.analytics.first_touch";
  var QUEUE_KEY = "tinker.analytics.queue";
  var KS_QUEUE_KEY = "tinker.analytics.ks_queue";
  var KS_CHUNK_KEY = "tinker.analytics.ks_chunk";

  var SESSION_TTL_MS = 30 * 60 * 1000;
  var FLUSH_MS = 5000;
  var MAX_QUEUE = 60;
  var MAX_KS_BUFFER = 400;

  var FORBIDDEN_EVENT_KEYS = [
    "text", "body", "title", "content", "draft", "answer", "question",
    "notes", "message", "markdown", "value", "input", "key", "keystroke",
  ];

  function prefersNoTracking(nav) {
    var n = nav || (typeof navigator !== "undefined" ? navigator : null);
    if (!n) return false;
    if (n.globalPrivacyControl === true) return true;
    var dnt = n.doNotTrack || n.msDoNotTrack;
    if (typeof window !== "undefined" && window.doNotTrack) dnt = dnt || window.doNotTrack;
    return dnt === "1" || dnt === "yes" || dnt === 1;
  }

  function randomId(prefix) {
    var bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var hex = "";
    for (var j = 0; j < bytes.length; j++) {
      hex += bytes[j].toString(16).padStart(2, "0");
    }
    return (prefix || "a") + hex;
  }

  function deviceTypeFromWidth(width) {
    var w = Number(width) || 0;
    if (w > 0 && w < 600) return "phone";
    if (w >= 600 && w < 960) return "tablet";
    return "desktop";
  }

  function parseQueryAttribution(search) {
    var out = {
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmContent: "",
      ref: "",
    };
    try {
      var q = new URLSearchParams(String(search || "").replace(/^\?/, ""));
      out.utmSource = (q.get("utm_source") || "").trim().slice(0, 128);
      out.utmMedium = (q.get("utm_medium") || "").trim().slice(0, 128);
      out.utmCampaign = (q.get("utm_campaign") || "").trim().slice(0, 128);
      out.utmContent = (q.get("utm_content") || "").trim().slice(0, 128);
      out.ref = (q.get("ref") || "").trim().slice(0, 128);
    } catch (e) { /* ignore */ }
    return out;
  }

  function referrerHostFrom(referrer, selfHost) {
    try {
      if (!referrer) return "";
      var u = new URL(referrer);
      if (selfHost && u.hostname === selfHost) return "";
      return (u.hostname || "").toLowerCase().slice(0, 128);
    } catch (e) {
      return "";
    }
  }

  function wordCountBucket(n) {
    var c = Math.max(0, Math.round(Number(n) || 0));
    if (c === 0) return "0";
    if (c <= 10) return "1-10";
    if (c <= 50) return "11-50";
    if (c <= 100) return "51-100";
    if (c <= 250) return "101-250";
    if (c <= 500) return "251-500";
    return "501+";
  }

  function sanitizeClientProps(props) {
    if (!props || typeof props !== "object" || Array.isArray(props)) return {};
    var out = {};
    var keys = Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var lower = key.toLowerCase();
      var forbidden = false;
      for (var f = 0; f < FORBIDDEN_EVENT_KEYS.length; f++) {
        if (lower === FORBIDDEN_EVENT_KEYS[f] || lower.indexOf(FORBIDDEN_EVENT_KEYS[f]) !== -1) {
          forbidden = true;
          break;
        }
      }
      if (forbidden) continue;
      var value = props[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        out[key] = Math.round(value);
        continue;
      }
      if (typeof value === "boolean") {
        out[key] = value;
        continue;
      }
      if (typeof value === "string") {
        var t = value.trim();
        if (!t || t.length > 64) continue;
        out[key] = t;
      }
    }
    return out;
  }

  function payloadContainsForbiddenText(payload, sampleText) {
    var blob = typeof payload === "string" ? payload : JSON.stringify(payload);
    var sample = String(sampleText || "");
    if (!sample) return false;
    var words = sample.split(/\s+/).filter(function (w) { return w.length >= 3; });
    for (var i = 0; i < words.length; i++) {
      if (blob.toLowerCase().indexOf(words[i].toLowerCase()) !== -1) return true;
    }
    for (var c = 0; c < sample.length; c++) {
      var ch = sample.charAt(c);
      if (!/[a-zA-Z]/.test(ch)) continue;
      if (blob.indexOf('"' + ch + '"') !== -1 || blob.indexOf("'" + ch + "'") !== -1) return true;
    }
    return false;
  }

  function createStore(storage) {
    var s = storage || {
      _m: Object.create(null),
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null;
      },
      setItem: function (k, v) { this._m[k] = String(v); },
      removeItem: function (k) { delete this._m[k]; },
    };
    return {
      get: function (key, fallback) {
        try {
          var raw = s.getItem(key);
          if (raw == null) return fallback;
          return JSON.parse(raw);
        } catch (e) {
          return fallback;
        }
      },
      set: function (key, value) {
        try { s.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
      },
      getStr: function (key) {
        try { return s.getItem(key) || ""; } catch (e) { return ""; }
      },
      setStr: function (key, value) {
        try {
          if (value) s.setItem(key, value);
          else s.removeItem(key);
        } catch (e) { /* ignore */ }
      },
    };
  }

  function createAnalyticsClient(options) {
    var opts = options || {};
    var store = createStore(opts.storage);
    var nowFn = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
    var nav = opts.navigator || null;
    var sendImpl = typeof opts.send === "function" ? opts.send : null;
    var latencySamples = [];

    var disabled = prefersNoTracking(nav);
    var flushTimer = null;
    var chunkIndex = store.get(KS_CHUNK_KEY, 0) || 0;
    var writingStartedAt = null;
    var ksBuffer = [];
    var firstWordsSent = false;

    function ensureIds() {
      var aid = store.getStr(AID_KEY);
      if (!aid) {
        aid = randomId("a");
        store.setStr(AID_KEY, aid);
      }
      var sid = store.getStr(SID_KEY);
      var sidAt = Number(store.getStr(SID_AT_KEY) || 0);
      var t = nowFn();
      if (!sid || !sidAt || t - sidAt > SESSION_TTL_MS) {
        sid = randomId("s");
        store.setStr(SID_KEY, sid);
        store.setStr(SID_AT_KEY, String(t));
        firstWordsSent = false;
        writingStartedAt = null;
        // Do not clear ksBuffer here — buildKeystrokeChunk snapshots it
        // first. Clearing here raced flush and dropped in-flight strokes.
      } else {
        store.setStr(SID_AT_KEY, String(t));
      }
      return { anonymousId: aid, sessionId: sid };
    }

    function captureFirstTouch(search, referrer, selfHost) {
      var existing = store.get(FIRST_TOUCH_KEY, null);
      if (existing && typeof existing === "object") return existing;
      var q = parseQueryAttribution(search);
      var host = referrerHostFrom(referrer, selfHost);
      var touch = {
        utmSource: q.utmSource,
        utmMedium: q.utmMedium,
        utmCampaign: q.utmCampaign,
        utmContent: q.utmContent,
        ref: q.ref,
        referrerHost: host,
      };
      store.set(FIRST_TOUCH_KEY, touch);
      return touch;
    }

    function firstTouch() {
      return store.get(FIRST_TOUCH_KEY, {
        utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", ref: "", referrerHost: "",
      }) || {
        utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", ref: "", referrerHost: "",
      };
    }

    function queue() {
      var q = store.get(QUEUE_KEY, []);
      return Array.isArray(q) ? q : [];
    }

    function setQueue(list) {
      store.set(QUEUE_KEY, list.slice(-MAX_QUEUE));
    }

    function buildEvent(name, props, context) {
      var ids = ensureIds();
      var touch = firstTouch();
      var ctx = context || {};
      return {
        name: String(name || "").toLowerCase(),
        ts: nowFn(),
        anonymousId: ids.anonymousId,
        sessionId: ids.sessionId,
        deviceType: deviceTypeFromWidth(ctx.viewportW || ctx.width),
        viewportW: Math.round(Number(ctx.viewportW || ctx.width) || 0),
        viewportH: Math.round(Number(ctx.viewportH || ctx.height) || 0),
        path: String(ctx.path || "/").slice(0, 256),
        appVersion: String(ctx.appVersion || "").slice(0, 32),
        utmSource: touch.utmSource || "",
        utmMedium: touch.utmMedium || "",
        utmCampaign: touch.utmCampaign || "",
        utmContent: touch.utmContent || "",
        ref: touch.ref || "",
        referrerHost: touch.referrerHost || "",
        props: sanitizeClientProps(props),
      };
    }

    function scheduleFlush() {
      if (flushTimer) return;
      var wait = opts.flushMs != null ? opts.flushMs : FLUSH_MS;
      flushTimer = setTimeout(function () {
        flushTimer = null;
        flush().catch(function () {});
      }, wait);
      if (flushTimer && typeof flushTimer.unref === "function") flushTimer.unref();
    }

    function track(name, props, context) {
      if (disabled) return null;
      if (!name) return null;
      var ev = buildEvent(name, props, context);
      var q = queue();
      q.push(ev);
      setQueue(q);
      scheduleFlush();
      return ev;
    }

    function ensureWritingSession() {
      if (!writingStartedAt) writingStartedAt = nowFn();
      return writingStartedAt;
    }

    function buildKeystrokeChunk() {
      // Snapshot before ensureIds so a session mint cannot race the buffer.
      var packed = ksBuffer.slice();
      ksBuffer = [];
      var ids = ensureIds();
      var startedAt = ensureWritingSession();
      var idx = chunkIndex;
      chunkIndex += 1;
      store.set(KS_CHUNK_KEY, chunkIndex);
      return {
        sessionId: ids.sessionId,
        anonymousId: ids.anonymousId,
        startedAt: startedAt,
        chunkIndex: idx,
        packed: packed,
      };
    }

    function flush(extra) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (disabled) return Promise.resolve({ sent: false, reason: "dnt" });
      var events = queue();
      var keystrokesOut = [];
      if (ksBuffer.length) keystrokesOut.push(buildKeystrokeChunk());
      var pendingKs = store.get(KS_QUEUE_KEY, []);
      if (Array.isArray(pendingKs) && pendingKs.length) {
        for (var i = 0; i < pendingKs.length; i++) keystrokesOut.push(pendingKs[i]);
      }
      if (!events.length && !keystrokesOut.length && !(extra && extra.events) && !(extra && extra.ownerEdits && extra.ownerEdits.length)) {
        return Promise.resolve({ sent: false, reason: "empty" });
      }
      var body = {
        events: (extra && extra.events ? events.concat(extra.events) : events).slice(0, MAX_QUEUE),
        keystrokes: keystrokesOut.slice(0, 20),
        ownerEdits: (extra && Array.isArray(extra.ownerEdits) ? extra.ownerEdits : []).slice(0, 20),
      };
      setQueue([]);
      store.set(KS_QUEUE_KEY, []);
      if (!sendImpl) return Promise.resolve({ sent: false, reason: "no_send", body: body });
      return Promise.resolve()
        .then(function () { return sendImpl(body); })
        .then(function () { return { sent: true, body: body }; })
        .catch(function () {
          setQueue(body.events.concat(queue()).slice(-MAX_QUEUE));
          store.set(KS_QUEUE_KEY, body.keystrokes);
          return { sent: false, reason: "network", body: body };
        });
    }

    function recordLatency(ms) {
      if (!Number.isFinite(ms)) return;
      latencySamples.push(ms);
      if (latencySamples.length > 200) latencySamples.shift();
    }

    function latencyStats() {
      if (!latencySamples.length) return { count: 0, p50: 0, p95: 0, max: 0 };
      var sorted = latencySamples.slice().sort(function (a, b) { return a - b; });
      function at(p) {
        return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
      }
      return {
        count: sorted.length,
        p50: Math.round(at(0.5) * 1000) / 1000,
        p95: Math.round(at(0.95) * 1000) / 1000,
        max: Math.round(sorted[sorted.length - 1] * 1000) / 1000,
      };
    }

    function onKeyEvent(eventLike, timingStart) {
      if (disabled) return null;
      var canPerf = typeof performance !== "undefined" && typeof performance.now === "function";
      var t0 = timingStart != null
        ? timingStart
        : (canPerf ? performance.now() : nowFn());
      ensureIds();
      ensureWritingSession();
      var cat = keystrokes.categorizeKey(eventLike);
      var ms = Math.max(0, nowFn() - writingStartedAt);
      var packed = keystrokes.packStroke(ms, cat);
      ksBuffer.push(packed);
      if (ksBuffer.length >= MAX_KS_BUFFER) {
        var chunk = buildKeystrokeChunk();
        var pending = store.get(KS_QUEUE_KEY, []);
        pending.push(chunk);
        store.set(KS_QUEUE_KEY, pending.slice(-20));
        scheduleFlush();
      } else {
        scheduleFlush();
      }
      var t1 = canPerf ? performance.now() : nowFn();
      recordLatency(t1 - t0);
      return packed;
    }

    function onPasteOrCut(kind, charCount) {
      if (disabled) return null;
      ensureIds();
      ensureWritingSession();
      var cat = kind === "cut" ? keystrokes.CAT.cut : keystrokes.CAT.paste;
      var ms = Math.max(0, nowFn() - writingStartedAt);
      var packed = keystrokes.packStroke(ms, cat, charCount);
      ksBuffer.push(packed);
      scheduleFlush();
      return packed;
    }

    function onIme(charCount) {
      if (disabled) return null;
      ensureIds();
      ensureWritingSession();
      var ms = Math.max(0, nowFn() - writingStartedAt);
      var packed = keystrokes.packStroke(ms, keystrokes.CAT.ime, charCount);
      ksBuffer.push(packed);
      scheduleFlush();
      return packed;
    }

    function onSelectionOrFocus(kind) {
      if (disabled) return null;
      ensureIds();
      ensureWritingSession();
      var cat = kind === "blur"
        ? keystrokes.CAT.blur
        : kind === "focus"
          ? keystrokes.CAT.focus
          : keystrokes.CAT.selection;
      var ms = Math.max(0, nowFn() - writingStartedAt);
      var packed = keystrokes.packStroke(ms, cat);
      ksBuffer.push(packed);
      scheduleFlush();
      return packed;
    }

    function markFirstWords(context) {
      if (firstWordsSent) return null;
      firstWordsSent = true;
      return track("first_words_typed", {}, context);
    }

    return {
      prefersNoTracking: function () { return prefersNoTracking(nav); },
      ensureIds: ensureIds,
      captureFirstTouch: captureFirstTouch,
      firstTouch: firstTouch,
      track: track,
      flush: flush,
      scheduleFlush: scheduleFlush,
      onKeyEvent: onKeyEvent,
      onPasteOrCut: onPasteOrCut,
      onIme: onIme,
      onSelectionOrFocus: onSelectionOrFocus,
      markFirstWords: markFirstWords,
      peekQueue: function () { return queue().slice(); },
      peekKeystrokeBuffer: function () { return ksBuffer.slice(); },
      latencyStats: latencyStats,
      wordCountBucket: wordCountBucket,
      sanitizeClientProps: sanitizeClientProps,
      payloadContainsForbiddenText: payloadContainsForbiddenText,
      isDisabled: function () { return disabled; },
      setDisabled: function (v) { disabled = !!v; },
      buildEvent: buildEvent,
      AID_KEY: AID_KEY,
      SID_KEY: SID_KEY,
      FIRST_TOUCH_KEY: FIRST_TOUCH_KEY,
    };
  }

  return {
    AID_KEY: AID_KEY,
    SID_KEY: SID_KEY,
    FIRST_TOUCH_KEY: FIRST_TOUCH_KEY,
    prefersNoTracking: prefersNoTracking,
    randomId: randomId,
    deviceTypeFromWidth: deviceTypeFromWidth,
    parseQueryAttribution: parseQueryAttribution,
    referrerHostFrom: referrerHostFrom,
    wordCountBucket: wordCountBucket,
    sanitizeClientProps: sanitizeClientProps,
    payloadContainsForbiddenText: payloadContainsForbiddenText,
    createAnalyticsClient: createAnalyticsClient,
    FORBIDDEN_EVENT_KEYS: FORBIDDEN_EVENT_KEYS,
  };
});
