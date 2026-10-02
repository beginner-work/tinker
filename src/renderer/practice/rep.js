/* /practice/rep — single-rep IDE (prototype). */
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search || "");
  var repId = params.get("id") || "";
  var rep = window.tinkerPracticeCatalog ? window.tinkerPracticeCatalog.findRep(repId) : null;

  var titleEl = document.getElementById("rep-title");
  var eyebrowEl = document.getElementById("rep-eyebrow");
  var specEl = document.getElementById("rep-spec");
  var editorEl = document.getElementById("rep-editor");
  var hintsEl = document.getElementById("rep-hints");
  var hintBtn = document.getElementById("rep-hint-btn");
  var hintMeta = document.getElementById("rep-hint-meta");
  var runBtn = document.getElementById("rep-run");
  var resultsEl = document.getElementById("rep-results");
  var streakEl = document.getElementById("practice-streak");
  var essayEl = document.getElementById("rep-essay");
  var essayText = document.getElementById("rep-essay-text");
  var essaySave = document.getElementById("rep-essay-save");
  var essayStatus = document.getElementById("rep-essay-status");

  var unlockedHints = 0;
  var codeKey = "tinker_practice_code_" + repId;

  function paintStreak() {
    if (!streakEl || !window.tinkerPracticeStreak) return;
    var count = window.tinkerPracticeStreak.getStreak();
    streakEl.textContent = "Streak: " + count + (count === 1 ? " weekday" : " weekdays");
  }

  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function paintHints() {
    if (!hintsEl || !rep) return;
    clear(hintsEl);
    var hints = Array.isArray(rep.hints) ? rep.hints : [];
    for (var i = 0; i < unlockedHints && i < hints.length; i++) {
      var li = document.createElement("li");
      li.textContent = hints[i];
      hintsEl.appendChild(li);
    }
    if (hintMeta) {
      hintMeta.textContent = unlockedHints + " of " + hints.length + " hints unlocked";
    }
    if (hintBtn) {
      hintBtn.disabled = unlockedHints >= hints.length;
      hintBtn.textContent = unlockedHints >= hints.length ? "All hints unlocked" : "Unlock next hint";
    }
  }

  function showMissing() {
    if (titleEl) titleEl.textContent = "Rep not found";
    if (specEl) specEl.textContent = "No practice rep matches that id. Go back to /practice.";
    if (runBtn) runBtn.disabled = true;
    if (hintBtn) hintBtn.disabled = true;
  }

  function loadSavedCode() {
    try {
      return localStorage.getItem(codeKey) || "";
    } catch (err) {
      return "";
    }
  }

  function saveCode(value) {
    try {
      localStorage.setItem(codeKey, value);
    } catch (err) { /* ignore */ }
  }

  function paintResults(report) {
    if (!resultsEl) return;
    clear(resultsEl);
    var rows = (report && report.results) || [];
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "practice-ide__empty";
      empty.textContent = "No test results.";
      resultsEl.appendChild(empty);
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var item = document.createElement("div");
      item.className = "practice-ide__result";
      var badge = document.createElement("span");
      badge.className = "practice-ide__badge " + (row.pass ? "practice-ide__badge--pass" : "practice-ide__badge--fail");
      badge.textContent = row.pass ? "pass" : "fail";
      var name = document.createElement("span");
      name.textContent = row.name || ("test " + (i + 1));
      item.appendChild(badge);
      item.appendChild(name);
      if (!row.pass && row.error) {
        var err = document.createElement("pre");
        err.className = "practice-ide__error";
        err.textContent = row.error;
        item.appendChild(err);
      }
      resultsEl.appendChild(item);
    }
    var consoleRows = (report && report.console) || [];
    if (consoleRows.length) {
      var log = document.createElement("pre");
      log.className = "practice-ide__console";
      log.textContent = consoleRows.map(function (line) {
        return "[" + line.level + "] " + line.text;
      }).join("\n");
      resultsEl.appendChild(log);
    }
  }

  function showEssay(visible) {
    if (!essayEl) return;
    if (visible) essayEl.classList.remove("is-hidden");
    else essayEl.classList.add("is-hidden");
  }

  async function loadFixtures(current) {
    if (current.fixtures) return current.fixtures;
    if (!current.fixtureUrl) return {};
    var res = await fetch(current.fixtureUrl, { credentials: "same-origin" });
    if (!res.ok) throw new Error("Could not load fixture " + current.fixtureUrl);
    var json = await res.json();
    return { paymentIntent: json };
  }

  async function runTests() {
    if (!rep || !window.tinkerPracticeRunner) return;
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    try {
      var fixtures = await loadFixtures(rep);
      var report = await window.tinkerPracticeRunner.run({
        code: editorEl.value,
        tests: rep.tests,
        fixtures: fixtures,
      });
      paintResults(report);
      if (report && report.ok) {
        if (window.tinkerPracticeStreak) {
          window.tinkerPracticeStreak.recordPass(rep.id, new Date());
          paintStreak();
        }
        showEssay(true);
      }
    } catch (err) {
      paintResults({
        ok: false,
        results: [{ name: "runner", pass: false, error: String(err && err.message ? err.message : err) }],
        console: [],
      });
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "Run tests";
    }
  }

  if (!rep) {
    showMissing();
    paintStreak();
    return;
  }

  document.title = rep.title + " · Practice";
  if (titleEl) titleEl.textContent = rep.title;
  if (eyebrowEl) {
    eyebrowEl.textContent = rep.learnFromDocs ? "Learn from docs" : "From Tinker";
  }
  if (specEl) specEl.textContent = rep.spec || "";
  if (editorEl) {
    var saved = loadSavedCode();
    editorEl.value = saved || rep.starterCode || "";
    editorEl.addEventListener("input", function () {
      saveCode(editorEl.value);
    });
  }

  if (hintBtn) {
    hintBtn.addEventListener("click", function () {
      var total = Array.isArray(rep.hints) ? rep.hints.length : 0;
      if (unlockedHints < total) unlockedHints += 1;
      paintHints();
    });
  }
  paintHints();

  if (runBtn) runBtn.addEventListener("click", function () { runTests(); });

  if (essaySave && essayText) {
    var existing = window.tinkerPracticeStreak ? window.tinkerPracticeStreak.readEssay(rep.id) : null;
    if (existing && existing.text) essayText.value = existing.text;
    essaySave.addEventListener("click", function () {
      var savedEssay = window.tinkerPracticeStreak.saveEssay(rep.id, essayText.value);
      if (essayStatus) {
        essayStatus.textContent = "Saved locally at " + savedEssay.savedAt;
      }
    });
  }

  paintStreak();
})();
