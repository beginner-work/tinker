/* Shared Practice runner core (browser worker via importScripts, Node via require).
 *
 * TODO(tyler-rep): hard timeouts for runaway loops.
 * TODO(tyler-rep): stronger sandbox isolation.
 * TODO(tyler-rep): better output capture.
 */
(function (root) {
  "use strict";

  function makeAssert() {
    function fail(message) {
      throw new Error(message || "assertion failed");
    }
    return {
      equal: function (actual, expected, message) {
        if (actual !== expected) {
          fail((message || "assert.equal") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
        }
      },
      ok: function (value, message) {
        if (!value) fail(message || "assert.ok failed");
      },
      deepEqual: function (actual, expected, message) {
        var left = JSON.stringify(actual);
        var right = JSON.stringify(expected);
        if (left !== right) {
          fail((message || "assert.deepEqual") + ": expected " + right + ", got " + left);
        }
      },
    };
  }

  function loadUserApi(code) {
    var module = { exports: {} };
    var exports = module.exports;
    // eslint-disable-next-line no-new-func
    var run = new Function("module", "exports", String(code || ""));
    run(module, exports);
    return module.exports || exports;
  }

  function runTests(payload) {
    var consoleLines = [];
    var results = [];
    var api;
    try {
      api = loadUserApi(payload.code);
    } catch (err) {
      return {
        ok: false,
        results: [{ name: "load starter / user code", pass: false, error: String(err && err.message ? err.message : err) }],
        console: consoleLines,
      };
    }

    var assert = makeAssert();
    var fixtures = payload.fixtures || {};
    var tests = Array.isArray(payload.tests) ? payload.tests : [];

    for (var i = 0; i < tests.length; i++) {
      var test = tests[i] || {};
      var name = test.name || ("test " + (i + 1));
      try {
        // eslint-disable-next-line no-new-func
        var body = new Function("api", "fixtures", "assert", String(test.body || ""));
        body(api, fixtures, assert);
        results.push({ name: name, pass: true });
      } catch (err) {
        results.push({
          name: name,
          pass: false,
          error: String(err && err.message ? err.message : err),
        });
      }
    }

    var ok = results.length > 0 && results.every(function (row) { return row.pass; });
    return { ok: ok, results: results, console: consoleLines };
  }

  var api = { runTests: runTests, makeAssert: makeAssert, loadUserApi: loadUserApi };
  root.tinkerPracticeRunnerCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
