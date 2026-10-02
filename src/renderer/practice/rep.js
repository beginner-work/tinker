/* /practice/rep — writing-flow steps: code → write-up → saved (local only). */
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search || "");
  var repId = params.get("id") || "";
  var rep = window.tinkerPracticeCatalog ? window.tinkerPracticeCatalog.findRep(repId) : null;

  var stage = document.getElementById("practice-stage");
  var progressEl = document.getElementById("practice-progress");
  var stepEl = document.getElementById("practice-step");
  var streakEl = document.getElementById("practice-streak");
  var primaryBtn = document.getElementById("practice-primary");
  var secondaryBtn = document.getElementById("practice-secondary");

  var unlockedHints = 0;
  var codeKey = "tinker_practice_code_" + repId;
  var lastReport = null;
  var step = "code"; // code | writeup | saved
  var editorEl = null;
  var essayEl = null;

  function makeCheckBadge() {
    var badge = document.createElement("div");
    badge.className = "writing-freewrite__badge";
    badge.setAttribute("aria-hidden", "true");
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "26");
    svg.setAttribute("height", "26");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M20 6L9 17l-5-5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    badge.appendChild(svg);
    return badge;
  }

  function paintStreak() {
    if (!streakEl || !window.tinkerPracticeStreak) return;
    var count = window.tinkerPracticeStreak.getStreak();
    streakEl.textContent = "Streak: " + count + (count === 1 ? " weekday" : " weekdays");
  }

  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function swap(card) {
    if (!stage) return;
    clear(stage);
    stage.appendChild(card);
  }

  function paintProgress() {
    if (!progressEl) return;
    clear(progressEl);
    var labels = ["code", "writeup", "saved"];
    var idx = labels.indexOf(step);
    for (var i = 0; i < 3; i++) {
      var d = document.createElement("span");
      d.className = "progress-dot";
      if (i === idx) d.dataset.active = "";
      if (i < idx) d.dataset.done = "";
      progressEl.appendChild(d);
    }
    if (stepEl) {
      stepEl.textContent = step === "code" ? "Code" : step === "writeup" ? "Write" : "Saved";
    }
  }

  function loadSavedCode() {
    try { return localStorage.getItem(codeKey) || ""; }
    catch (err) { return ""; }
  }

  function saveCode(value) {
    try { localStorage.setItem(codeKey, value); }
    catch (err) { /* ignore */ }
  }

  function setFoot(secondaryLabel, secondaryHidden, primaryLabel, primaryDisabled) {
    if (secondaryBtn) {
      secondaryBtn.hidden = !!secondaryHidden;
      secondaryBtn.disabled = false;
      secondaryBtn.textContent = secondaryLabel || "Unlock hint";
    }
    if (primaryBtn) {
      primaryBtn.hidden = false;
      primaryBtn.disabled = !!primaryDisabled;
      primaryBtn.textContent = primaryLabel;
    }
  }

  function paintResults(into, report) {
    clear(into);
    var rows = (report && report.results) || [];
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "practice-results__empty writing-note";
      empty.textContent = "Run tests to see pass/fail per case and any console output.";
      into.appendChild(empty);
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var item = document.createElement("div");
      item.className = "practice-results__row";
      var badge = document.createElement("span");
      badge.className = "practice-results__badge " + (row.pass ? "practice-results__badge--pass" : "practice-results__badge--fail");
      badge.textContent = row.pass ? "pass" : "fail";
      var name = document.createElement("span");
      name.textContent = row.name || ("test " + (i + 1));
      item.appendChild(badge);
      item.appendChild(name);
      if (!row.pass && row.error) {
        var err = document.createElement("pre");
        err.className = "practice-results__error";
        err.textContent = row.error;
        item.appendChild(err);
      }
      into.appendChild(item);
    }
    var consoleRows = (report && report.console) || [];
    if (consoleRows.length) {
      var log = document.createElement("pre");
      log.className = "practice-results__console";
      log.textContent = consoleRows.map(function (line) {
        return "[" + line.level + "] " + line.text;
      }).join("\n");
      into.appendChild(log);
    }
  }

  function paintHints(listEl, metaEl) {
    clear(listEl);
    var hints = Array.isArray(rep.hints) ? rep.hints : [];
    for (var i = 0; i < unlockedHints && i < hints.length; i++) {
      var li = document.createElement("li");
      li.textContent = hints[i];
      listEl.appendChild(li);
    }
    if (metaEl) {
      metaEl.textContent = unlockedHints + " of " + hints.length + " hints unlocked";
    }
    if (secondaryBtn && step === "code") {
      secondaryBtn.disabled = unlockedHints >= hints.length;
      secondaryBtn.textContent = unlockedHints >= hints.length ? "All hints unlocked" : "Unlock hint";
    }
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
    if (!rep || !window.tinkerPracticeRunner || !editorEl) return;
    primaryBtn.disabled = true;
    primaryBtn.textContent = "Running…";
    try {
      var fixtures = await loadFixtures(rep);
      lastReport = await window.tinkerPracticeRunner.run({
        code: editorEl.value,
        tests: rep.tests,
        fixtures: fixtures,
      });
      var resultsEl = document.getElementById("rep-results");
      if (resultsEl) paintResults(resultsEl, lastReport);
      if (lastReport && lastReport.ok) {
        if (window.tinkerPracticeStreak) {
          window.tinkerPracticeStreak.recordPass(rep.id, new Date());
          paintStreak();
        }
        // Same beat as answering a writing question: advance to the next step.
        step = "writeup";
        renderStep();
        return;
      }
      setFoot(
        unlockedHints >= (rep.hints || []).length ? "All hints unlocked" : "Unlock hint",
        false,
        "Run tests →",
        false
      );
    } catch (err) {
      lastReport = {
        ok: false,
        results: [{ name: "runner", pass: false, error: String(err && err.message ? err.message : err) }],
        console: [],
      };
      var resultsEl2 = document.getElementById("rep-results");
      if (resultsEl2) paintResults(resultsEl2, lastReport);
      setFoot("Unlock hint", false, "Run tests →", false);
    }
  }

  function saveWriteup() {
    if (!essayEl || !window.tinkerPracticeStreak) return;
    var body = essayEl.value.trim();
    if (!body) return;
    window.tinkerPracticeStreak.saveEssay(rep.id, body);
    step = "saved";
    renderStep();
  }

  function renderCodeStep() {
    var card = document.createElement("div");
    card.className = "writing-card";

    var eyebrow = document.createElement("p");
    eyebrow.className = "writing-note";
    eyebrow.textContent = rep.learnFromDocs ? "Learn from docs" : "From Tinker";
    card.appendChild(eyebrow);

    var q = document.createElement("h2");
    q.className = "writing-question";
    q.textContent = rep.title;
    card.appendChild(q);

    var spec = document.createElement("pre");
    spec.className = "practice-spec";
    spec.id = "rep-spec";
    spec.textContent = rep.spec || "";
    card.appendChild(spec);

    var hintsWrap = document.createElement("div");
    var hintsLabel = document.createElement("p");
    hintsLabel.className = "writing-note";
    hintsLabel.textContent = "Hints unlock one at a time. No solution ships with the rep.";
    var hintsList = document.createElement("ol");
    hintsList.className = "practice-hints";
    hintsList.id = "rep-hints";
    var hintsMeta = document.createElement("p");
    hintsMeta.className = "practice-hint-meta";
    hintsMeta.id = "rep-hint-meta";
    hintsWrap.appendChild(hintsLabel);
    hintsWrap.appendChild(hintsList);
    hintsWrap.appendChild(hintsMeta);
    card.appendChild(hintsWrap);

    var shell = document.createElement("div");
    shell.className = "practice-editor-shell";
    var bar = document.createElement("div");
    bar.className = "practice-editor-shell__bar";
    var barLabel = document.createElement("p");
    barLabel.className = "practice-editor-shell__label";
    barLabel.textContent = "starter.js";
    bar.appendChild(barLabel);
    shell.appendChild(bar);

    var label = document.createElement("label");
    label.className = "practice-sr";
    label.htmlFor = "rep-editor";
    label.textContent = "Code editor";
    card.appendChild(label);

    editorEl = document.createElement("textarea");
    editorEl.id = "rep-editor";
    editorEl.className = "practice-editor";
    editorEl.spellcheck = false;
    editorEl.setAttribute("autocomplete", "off");
    editorEl.setAttribute("autocapitalize", "off");
    editorEl.value = loadSavedCode() || rep.starterCode || "";
    editorEl.addEventListener("input", function () {
      saveCode(editorEl.value);
    });
    shell.appendChild(editorEl);
    card.appendChild(shell);

    var resultsHead = document.createElement("p");
    resultsHead.className = "writing-note";
    resultsHead.textContent = "Results";
    card.appendChild(resultsHead);

    var results = document.createElement("div");
    results.className = "practice-results";
    results.id = "rep-results";
    results.setAttribute("role", "status");
    results.setAttribute("aria-live", "polite");
    paintResults(results, lastReport);
    card.appendChild(results);

    swap(card);
    paintHints(hintsList, hintsMeta);
    setFoot(
      unlockedHints >= (rep.hints || []).length ? "All hints unlocked" : "Unlock hint",
      false,
      "Run tests →",
      false
    );
    setTimeout(function () { editorEl.focus(); }, 30);
  }

  function renderWriteupStep() {
    var card = document.createElement("div");
    card.className = "writing-card";

    var recall = document.createElement("div");
    recall.className = "writing-recall";
    var line = document.createElement("div");
    line.className = "writing-recall__line";
    var pin = document.createElement("span");
    pin.className = "writing-recall__text";
    pin.textContent = "All tests passed · " + rep.title;
    line.appendChild(pin);
    recall.appendChild(line);
    card.appendChild(recall);

    var q = document.createElement("h2");
    q.className = "writing-question";
    q.textContent = "What are you learning?";
    card.appendChild(q);

    var note = document.createElement("p");
    note.className = "writing-note";
    note.textContent = "Capture the rep as a short essay draft. Prototype saves on this device only — it does not write into Tinker essays.";
    card.appendChild(note);

    essayEl = document.createElement("textarea");
    essayEl.id = "rep-essay-text";
    essayEl.className = "writing-input";
    essayEl.rows = 8;
    essayEl.placeholder = "Type your answer in your own words…";
    var existing = window.tinkerPracticeStreak ? window.tinkerPracticeStreak.readEssay(rep.id) : null;
    if (existing && existing.text) essayEl.value = existing.text;
    essayEl.addEventListener("input", function () {
      primaryBtn.disabled = essayEl.value.trim().length === 0;
    });
    card.appendChild(essayEl);

    swap(card);
    setFoot("", true, "This is everything →", essayEl.value.trim().length === 0);
    setTimeout(function () { essayEl.focus(); }, 30);
  }

  function renderSavedStep() {
    var card = document.createElement("div");
    card.className = "writing-card writing-card--freewrite-saved";

    card.appendChild(makeCheckBadge());

    var q = document.createElement("h2");
    q.className = "writing-question";
    q.textContent = "Saved on this device.";
    card.appendChild(q);

    var sub = document.createElement("p");
    sub.className = "writing-freewrite__sub";
    sub.textContent = "Prototype only — this draft stays in localStorage. It is not wired into Tinker essays.";
    card.appendChild(sub);

    var done = document.createElement("a");
    done.href = "/practice";
    done.className = "writing-action writing-action--primary";
    done.textContent = "Done";
    card.appendChild(done);

    swap(card);
    if (secondaryBtn) secondaryBtn.hidden = true;
    if (primaryBtn) primaryBtn.hidden = true;
  }

  function renderStep() {
    paintProgress();
    paintStreak();
    if (step === "code") renderCodeStep();
    else if (step === "writeup") renderWriteupStep();
    else renderSavedStep();
  }

  function showMissing() {
    var card = document.createElement("div");
    card.className = "writing-card";
    var q = document.createElement("h2");
    q.className = "writing-question";
    q.textContent = "Rep not found";
    var note = document.createElement("p");
    note.className = "writing-note";
    note.textContent = "No practice rep matches that id. Go back to Practice.";
    card.appendChild(q);
    card.appendChild(note);
    swap(card);
    if (secondaryBtn) secondaryBtn.hidden = true;
    if (primaryBtn) {
      primaryBtn.textContent = "Back to Practice";
      primaryBtn.onclick = function () { window.location.assign("/practice"); };
    }
  }

  if (!rep) {
    showMissing();
    paintStreak();
    return;
  }

  document.title = rep.title + " · Practice";

  if (secondaryBtn) {
    secondaryBtn.addEventListener("click", function () {
      if (step !== "code") return;
      var total = Array.isArray(rep.hints) ? rep.hints.length : 0;
      if (unlockedHints < total) unlockedHints += 1;
      var list = document.getElementById("rep-hints");
      var meta = document.getElementById("rep-hint-meta");
      if (list) paintHints(list, meta);
    });
  }

  if (primaryBtn) {
    primaryBtn.addEventListener("click", function () {
      if (step === "code") runTests();
      else if (step === "writeup") saveWriteup();
    });
  }

  renderStep();
})();
