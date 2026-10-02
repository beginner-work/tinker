/* Practice prototype — UI contract + runner/streak basics. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const practiceDir = path.join(root, "src/renderer/practice");
const html = fs.readFileSync(path.join(practiceDir, "index.html"), "utf8");
const repHtml = fs.readFileSync(path.join(practiceDir, "rep.html"), "utf8");
const practiceJs = fs.readFileSync(path.join(practiceDir, "practice.js"), "utf8");
const repJs = fs.readFileSync(path.join(practiceDir, "rep.js"), "utf8");
const runnerJs = fs.readFileSync(path.join(practiceDir, "runner.js"), "utf8");
const workerJs = fs.readFileSync(path.join(practiceDir, "runner-worker.js"), "utf8");
const runnerCore = require("../src/renderer/practice/runner-core.js");
const { EXPECTED_SW_CACHE_VERSION } = require("./helpers/sw-cache-version.js");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const fixture = JSON.parse(
  fs.readFileSync(path.join(practiceDir, "fixtures/stripe-payment-intent-create.json"), "utf8"),
);

function loadReps() {
  const sandbox = { TINKER_PRACTICE_REPS: [] };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const name of ["pacific-wall-time.js", "mark-touch-sent.js", "stripe-payment-intent.js"]) {
    const src = fs.readFileSync(path.join(practiceDir, "reps", name), "utf8");
    vm.runInContext(src, ctx);
  }
  return sandbox.TINKER_PRACTICE_REPS;
}

test("practice pages wire list + IDE chrome without innerHTML", () => {
  assert.match(html, /Practice/);
  assert.match(html, /id="practice-list"/);
  assert.match(html, /id="practice-streak"/);
  assert.match(html, /localStorage/);
  assert.match(html, /src="\/practice\/practice\.js"/);
  assert.match(repHtml, /id="rep-editor"/);
  assert.match(repHtml, /id="rep-run"/);
  assert.match(repHtml, /Run tests/);
  assert.match(repHtml, /id="rep-hints"/);
  assert.match(repHtml, /Unlock next hint/);
  assert.match(repHtml, /id="rep-essay"/);
  assert.match(repHtml, /worker-src 'self'/);
  assert.match(repHtml, /unsafe-eval/);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(repHtml.includes("innerHTML"), false);
  assert.equal(practiceJs.includes("innerHTML"), false);
  assert.equal(repJs.includes("innerHTML"), false);
  assert.match(practiceJs, /textContent/);
  assert.match(repJs, /textContent/);
});

test("vercel and service worker leave /practice on the network", () => {
  assert.match(vercel, /\/practice\/index\.html/);
  assert.match(vercel, /\/practice\/rep\.html/);
  assert.match(sw, /pathname === "\/practice"/);
  assert.match(sw, new RegExp(EXPECTED_SW_CACHE_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(EXPECTED_SW_CACHE_VERSION, "tinker-shell-v27");
});

test("runner keeps the intentional Tyler-rep TODOs", () => {
  assert.match(runnerJs, /TODO\(tyler-rep\): hard timeouts/);
  assert.match(runnerJs, /TODO\(tyler-rep\): stronger sandbox/);
  assert.match(runnerJs, /TODO\(tyler-rep\): better output capture/);
  assert.match(workerJs, /TODO\(tyler-rep\): hard timeouts/);
  assert.match(workerJs, /importScripts\("\/practice\/runner-core\.js"\)/);
  assert.match(runnerJs, /new Worker\("\/practice\/runner-worker\.js"\)/);
});

test("three sample reps ship with specs, failing starters, hints, and no solutions", () => {
  const reps = loadReps();
  assert.equal(reps.length, 3);
  const ids = reps.map((rep) => rep.id).sort();
  assert.deepEqual(ids, ["mark-touch-sent", "pacific-wall-time", "stripe-payment-intent"]);

  for (const rep of reps) {
    assert.ok(rep.spec && rep.spec.length > 40, rep.id + " needs a plain-language spec");
    assert.ok(rep.starterCode && rep.starterCode.includes("module.exports"), rep.id + " starter");
    assert.ok(Array.isArray(rep.hints) && rep.hints.length >= 2 && rep.hints.length <= 3, rep.id + " hints");
    assert.ok(Array.isArray(rep.tests) && rep.tests.length >= 2, rep.id + " tests");
    assert.doesNotMatch(rep.starterCode, /SOLUTION|FIXME: pass all/i);
    // Starter must fail at least one packaged test.
    const fixtures = rep.id === "stripe-payment-intent"
      ? { paymentIntent: fixture }
      : (rep.fixtures || {});
    const report = runnerCore.runTests({
      code: rep.starterCode,
      tests: rep.tests,
      fixtures: fixtures,
    });
    assert.equal(report.ok, false, rep.id + " starter should not pass all tests");
    assert.ok(report.results.some((row) => !row.pass), rep.id + " needs a failing case");
  }

  const stripe = reps.find((rep) => rep.id === "stripe-payment-intent");
  assert.equal(stripe.learnFromDocs, true);
  assert.match(stripe.fixtureUrl, /stripe-payment-intent-create\.json/);
  assert.equal(fixture.livemode, false);
  assert.equal(fixture.amount, 1099);
  assert.ok(String(fixture.client_secret).includes("secret_"));
});

test("runner core reports pass/fail for a tiny module", () => {
  const report = runnerCore.runTests({
    code: "module.exports = { add: function (a, b) { return a + b; } };",
    tests: [
      { name: "adds", body: "assert.equal(api.add(2, 3), 5);" },
      { name: "wrong on purpose", body: "assert.equal(api.add(2, 2), 5);" },
    ],
  });
  assert.equal(report.ok, false);
  assert.equal(report.results[0].pass, true);
  assert.equal(report.results[1].pass, false);
});

test("streak counts consecutive weekdays and essays stay local", () => {
  const memory = {};
  const localStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
    setItem(key, value) { memory[key] = String(value); },
    removeItem(key) { delete memory[key]; },
  };
  // Re-bind streak helpers against a fresh in-memory store.
  const src = fs.readFileSync(path.join(practiceDir, "streak.js"), "utf8");
  const sandbox = { localStorage: localStorage, console: { log() {} }, module: { exports: {} } };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(src, vm.createContext(sandbox));
  const api = sandbox.module.exports;

  assert.equal(api.isWeekday(new Date(2026, 9, 2)), true); // Fri Oct 2, 2026
  assert.equal(api.isWeekday(new Date(2026, 9, 3)), false); // Sat

  api.recordPass("pacific-wall-time", new Date(2026, 9, 1, 9)); // Thu
  assert.equal(api.getStreak(), 1);
  api.recordPass("mark-touch-sent", new Date(2026, 9, 2, 9)); // Fri
  assert.equal(api.getStreak(), 2);
  // Weekend pass does not advance the weekday streak counter.
  api.recordPass("stripe-payment-intent", new Date(2026, 9, 3, 9)); // Sat
  assert.equal(api.getStreak(), 2);
  // Monday continues from Friday.
  api.recordPass("pacific-wall-time", new Date(2026, 9, 5, 9)); // Mon
  assert.equal(api.getStreak(), 3);

  const essay = api.saveEssay("pacific-wall-time", "Wall time is civil time, not a fixed offset.");
  assert.match(essay.savedAt, /T/);
  assert.equal(api.readEssay("pacific-wall-time").text, "Wall time is civil time, not a fixed offset.");
});

test("mark-touch-sent and pacific starters isolate from the real data model", () => {
  const touchRep = fs.readFileSync(path.join(practiceDir, "reps/mark-touch-sent.js"), "utf8");
  const pacific = fs.readFileSync(path.join(practiceDir, "reps/pacific-wall-time.js"), "utf8");
  assert.match(touchRep, /Isolated function/);
  assert.doesNotMatch(touchRep, /require\(|prisma|leads-store|outreach-schedule-store/);
  assert.doesNotMatch(pacific, /require\(|prisma|outreach-schedule-store/);
  assert.match(pacific, /Nov 1, 2026/);
  assert.match(touchRep, /status: \\"sent\\"/);
});
