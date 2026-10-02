/* Practice runner host — talks to runner-worker.js.
 *
 * TODO(tyler-rep): hard timeouts for runaway loops.
 * TODO(tyler-rep): stronger sandbox isolation.
 * TODO(tyler-rep): better output capture.
 */
(function (root) {
  "use strict";

  var worker = null;
  var seq = 0;
  var pending = {};

  function getWorker() {
    if (worker) return worker;
    worker = new Worker("/practice/runner-worker.js");
    worker.onmessage = function (event) {
      var data = event.data || {};
      if (data.type !== "result") return;
      var entry = pending[data.requestId];
      if (!entry) return;
      delete pending[data.requestId];
      entry.resolve(data.report || { ok: false, results: [], console: [] });
    };
    worker.onerror = function (err) {
      var keys = Object.keys(pending);
      for (var i = 0; i < keys.length; i++) {
        var entry = pending[keys[i]];
        delete pending[keys[i]];
        entry.reject(err);
      }
    };
    return worker;
  }

  function runInWorker(payload) {
    return new Promise(function (resolve, reject) {
      var requestId = "r" + String(++seq);
      pending[requestId] = { resolve: resolve, reject: reject };
      try {
        getWorker().postMessage({
          type: "run",
          requestId: requestId,
          code: payload.code,
          tests: payload.tests,
          fixtures: payload.fixtures || {},
        });
      } catch (err) {
        delete pending[requestId];
        reject(err);
      }
      // TODO(tyler-rep): reject + worker.terminate() after a hard timeout.
    });
  }

  root.tinkerPracticeRunner = {
    run: runInWorker,
  };
})(window);
