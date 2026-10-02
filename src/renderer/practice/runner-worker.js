/* Minimal in-browser Practice test runner (Web Worker).
 *
 * TODO(tyler-rep): hard timeouts for runaway loops (terminate the worker
 *   after N ms and report a timeout failure).
 * TODO(tyler-rep): stronger sandbox isolation (opaque origin iframe /
 *   Compartment / frozen intrinsics — today the worker shares the same
 *   origin and can still touch WorkerGlobalScope).
 * TODO(tyler-rep): better output capture (structured console mirroring,
 *   stdout/stderr streams, and stack frames mapped back to the editor).
 */
"use strict";

importScripts("/practice/runner-core.js");

var consoleLines = [];

function captureConsole() {
  var levels = ["log", "info", "warn", "error"];
  for (var i = 0; i < levels.length; i++) {
    (function (level) {
      var original = console[level];
      console[level] = function () {
        var args = Array.prototype.slice.call(arguments);
        consoleLines.push({
          level: level,
          text: args.map(function (arg) {
            try {
              return typeof arg === "string" ? arg : JSON.stringify(arg);
            } catch (err) {
              return String(arg);
            }
          }).join(" "),
        });
        if (typeof original === "function") {
          try { original.apply(console, args); } catch (err) { /* ignore */ }
        }
      };
    })(levels[i]);
  }
}

captureConsole();

self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type !== "run") return;
  // TODO(tyler-rep): wrap runTests in a hard timeout (see file header).
  consoleLines = [];
  var report = self.tinkerPracticeRunnerCore.runTests(data);
  report.console = consoleLines.slice();
  self.postMessage({ type: "result", requestId: data.requestId, report: report });
};
