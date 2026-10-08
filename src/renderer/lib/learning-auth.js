/* learning-auth.js — signed-in seam for Lindow Labs Learning.
 *
 * Exercises in /repo require a Learning Lab session (lindowlabs.dev/learning).
 * Tinker cannot read cross-origin cookies directly. This module is the single
 * client check: isLearningSignedIn().
 *
 * Signal sources (first match wins as "known"):
 * 1. postMessage from the Learning origin:
 *    { type: "lindowlabs:session", signedIn: true|false }
 * 2. Optional GET {learningOrigin}/api/session (credentials: include) when
 *    the Learning backend enables CORS — expected JSON:
 *    { signedIn: true|false } or { authenticated: true|false }
 * 3. Cached localStorage flag written after (1) or (2)
 *
 * Backend (lindowlabs) must provide at least (1) or (2) for a reliable signal.
 * Until then the UI stays signed-out and shows the sign-in prompt.
 */
(function (root) {
  "use strict";

  var STORAGE_KEY = "tinker.learning.signedIn.v1";
  var SESSION_PATH = "/api/session";
  var MSG_TYPE = "lindowlabs:session";

  var listeners = [];
  var lastKnown = null;
  var probePromise = null;

  function learningLabUrl() {
    try {
      if (root.tinkerMadeByLindowLabs && root.tinkerMadeByLindowLabs.learningLabUrl) {
        return String(root.tinkerMadeByLindowLabs.learningLabUrl);
      }
    } catch (e) { /* ignore */ }
    return "https://lindowlabs.dev/learning";
  }

  function learningOrigin() {
    try {
      return new URL(learningLabUrl()).origin;
    } catch (e) {
      return "https://lindowlabs.dev";
    }
  }

  function readCache() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch (e) { /* ignore */ }
    return null;
  }

  function writeCache(signedIn) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(STORAGE_KEY, signedIn ? "1" : "0");
      }
    } catch (e) { /* ignore */ }
  }

  function notify() {
    var value = isLearningSignedIn();
    for (var i = 0; i < listeners.length; i += 1) {
      try { listeners[i](value); } catch (e) { /* ignore */ }
    }
    try {
      if (typeof root.dispatchEvent === "function") {
        root.dispatchEvent(new CustomEvent("tinker-learning-auth", {
          detail: { signedIn: value },
        }));
      }
    } catch (e2) { /* ignore */ }
  }

  function setLearningSignedIn(signedIn) {
    lastKnown = !!signedIn;
    writeCache(lastKnown);
    notify();
    return lastKnown;
  }

  function isLearningSignedIn() {
    if (lastKnown != null) return !!lastKnown;
    var cached = readCache();
    if (cached != null) {
      lastKnown = cached;
      return cached;
    }
    return false;
  }

  function onLearningAuthChange(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (f) { return f !== fn; });
    };
  }

  function applyMessage(data) {
    if (!data || typeof data !== "object") return;
    if (data.type !== MSG_TYPE) return;
    var signed =
      data.signedIn === true ||
      data.authenticated === true ||
      data.session === true;
    if (data.signedIn === false || data.authenticated === false || data.session === false) {
      signed = false;
    }
    setLearningSignedIn(!!signed);
  }

  function onWindowMessage(event) {
    try {
      if (!event || event.origin !== learningOrigin()) return;
      applyMessage(event.data);
    } catch (e) { /* ignore */ }
  }

  function sessionEndpoint() {
    return learningOrigin() + SESSION_PATH;
  }

  function probeSession() {
    if (probePromise) return probePromise;
    probePromise = fetch(sessionEndpoint(), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      mode: "cors",
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json().catch(function () { return null; });
    }).then(function (json) {
      if (!json || typeof json !== "object") return isLearningSignedIn();
      if ("signedIn" in json || "authenticated" in json || "session" in json) {
        var on =
          json.signedIn === true ||
          json.authenticated === true ||
          json.session === true;
        return setLearningSignedIn(!!on);
      }
      return isLearningSignedIn();
    }).catch(function () {
      return isLearningSignedIn();
    }).then(function (value) {
      probePromise = null;
      return value;
    });
    return probePromise;
  }

  function requestLearningSignIn() {
    try {
      if (root.tinkerMadeByLindowLabs && typeof root.tinkerMadeByLindowLabs.openDrawer === "function") {
        root.tinkerMadeByLindowLabs.openDrawer(learningLabUrl());
        return true;
      }
    } catch (e) { /* ignore */ }
    try {
      root.open(learningLabUrl(), "_blank", "noopener,noreferrer");
      return true;
    } catch (e2) {
      return false;
    }
  }

  function bind() {
    if (typeof root.addEventListener === "function") {
      root.addEventListener("message", onWindowMessage, false);
    }
    // Warm cache from storage; optionally probe when the page is ready.
    var cached = readCache();
    if (cached != null) lastKnown = cached;
    try {
      if (typeof root.setTimeout === "function") {
        root.setTimeout(function () { probeSession(); }, 0);
      }
    } catch (e) { /* ignore */ }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bind);
    } else {
      bind();
    }
  }

  root.tinkerLearningAuth = {
    STORAGE_KEY: STORAGE_KEY,
    MSG_TYPE: MSG_TYPE,
    SESSION_PATH: SESSION_PATH,
    learningLabUrl: learningLabUrl,
    learningOrigin: learningOrigin,
    sessionEndpoint: sessionEndpoint,
    isLearningSignedIn: isLearningSignedIn,
    setLearningSignedIn: setLearningSignedIn,
    onLearningAuthChange: onLearningAuthChange,
    probeSession: probeSession,
    requestLearningSignIn: requestLearningSignIn,
    // test helper
    _reset: function () {
      lastKnown = null;
      probePromise = null;
      try {
        if (root.localStorage) root.localStorage.removeItem(STORAGE_KEY);
      } catch (e) { /* ignore */ }
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
