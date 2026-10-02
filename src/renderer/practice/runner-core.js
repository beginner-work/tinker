/* Shared Practice runner core (browser worker via importScripts, Node via require).
 *
 * TODO(tyler-rep): hard timeouts for runaway loops.
 * TODO(tyler-rep): stronger sandbox isolation.
 * TODO(tyler-rep): better output capture.
 */
(function (root) {
  "use strict";

  var PSEUDOCODE_FRIENDLY =
    "This doesn't run yet. That's fine, pseudocode is a good start.";

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

  function isSyntaxProblem(err) {
    if (!err) return false;
    if (err.name === "SyntaxError") return true;
    var msg = String(err.message || err);
    return /Unexpected|Invalid or unexpected token|missing \) after argument list|Unexpected end of input|Identifier directly after number/i.test(msg);
  }

  function friendlySyntaxMessage(err) {
    var detail = String(err && err.message ? err.message : err);
    // Keep one short line — no stack frames.
    var firstLine = detail.split("\n")[0].trim();
    return PSEUDOCODE_FRIENDLY + "\n" + firstLine;
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
      var message = isSyntaxProblem(err)
        ? friendlySyntaxMessage(err)
        : String(err && err.message ? err.message : err);
      return {
        ok: false,
        syntaxError: isSyntaxProblem(err),
        results: [{ name: "load your code", pass: false, error: message }],
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

  var api = {
    runTests: runTests,
    makeAssert: makeAssert,
    loadUserApi: loadUserApi,
    PSEUDOCODE_FRIENDLY: PSEUDOCODE_FRIENDLY,
    isSyntaxProblem: isSyntaxProblem,
    friendlySyntaxMessage: friendlySyntaxMessage,
  };
  root.tinkerPracticeRunnerCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
