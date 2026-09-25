/* /career
 *
 * Same sign-in as the rest of tinker: a Stytch session in
 * localStorage.tinker_jwt. The record comes from GET /api/career.
 * Confirm, edit, and reject are the only way a fact becomes verified
 * or rejected. Restore sends a rejected fact back to proposed.
 * Text is assigned with textContent.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var statusEl = document.getElementById("career-status");
  var proposedEl = document.getElementById("career-proposed");
  var verifiedEl = document.getElementById("career-verified");
  var rejectedEl = document.getElementById("career-rejected");
  var rulesEl = document.getElementById("career-rules");
  var uploadForm = document.getElementById("career-upload");
  var fileInput = document.getElementById("career-file");
  var uploadButton = document.getElementById("career-upload-button");
  var record = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (err) { return ""; }
  }

  function sendHome() {
    try { sessionStorage.setItem(RETURN_KEY, "/career"); }
    catch (err) { /* the sign-in page still works without the return */ }
    window.location.assign("/");
  }

  if (!token()) {
    sendHome();
    return;
  }

  function setStatus(text) {
    statusEl.textContent = text || "";
  }

  function authHeaders(json) {
    var headers = { Authorization: "Bearer " + token() };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  function readJson(res) {
    return res.json().then(function (body) {
      return { status: res.status, body: body };
    }, function () {
      return { status: res.status, body: null };
    });
  }

  function handleAuth(result) {
    if (result.status === 401) {
      try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
      sendHome();
      return true;
    }
    return false;
  }

  function kindLabel(kind) {
    var kinds = (window.tinkerCareer && window.tinkerCareer.FACT_KINDS) || [];
    for (var i = 0; i < kinds.length; i++) {
      if (kinds[i] === kind) return kind.replace(/_/g, " ");
    }
    return kind || "fact";
  }

  function addText(parent, className, text) {
    var el = document.createElement("p");
    el.className = className;
    el.textContent = text || "";
    parent.appendChild(el);
    return el;
  }

  function renderFact(fact, mode) {
    var proposed = mode === "proposed";
    var rejected = mode === "rejected";
    var row = document.createElement("li");
    row.className = "career__fact";
    var pair = document.createElement("div");
    pair.className = "career__pair";

    var left = document.createElement("div");
    addText(left, "career__kind", kindLabel(fact.kind));
    if (proposed) {
      var value = document.createElement("input");
      value.className = "career__input";
      value.type = "text";
      value.value = fact.value || "";
      value.setAttribute("aria-label", "Fact");
      left.appendChild(value);
      var baseline = null;
      var mechanism = null;
      if (fact.kind === "metric") {
        baseline = document.createElement("input");
        baseline.className = "career__input";
        baseline.type = "text";
        baseline.value = fact.baseline || "";
        baseline.placeholder = "Baseline";
        baseline.setAttribute("aria-label", "Baseline");
        mechanism = document.createElement("input");
        mechanism.className = "career__input";
        mechanism.type = "text";
        mechanism.value = fact.mechanism || "";
        mechanism.placeholder = "Mechanism";
        mechanism.setAttribute("aria-label", "Mechanism");
        left.appendChild(baseline);
        left.appendChild(mechanism);
      }
      var actions = document.createElement("div");
      actions.className = "career__actions";
      var confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "career__confirm";
      confirm.textContent = "Confirm";
      var reject = document.createElement("button");
      reject.type = "button";
      reject.className = "career__reject";
      reject.textContent = "Reject";
      confirm.addEventListener("click", function () {
        var body = { id: fact.id, action: "verify", value: value.value };
        if (baseline) body.baseline = baseline.value;
        if (mechanism) body.mechanism = mechanism.value;
        saveFact(body, [confirm, reject]);
      });
      reject.addEventListener("click", function () {
        saveFact({ id: fact.id, action: "reject" }, [confirm, reject]);
      });
      actions.appendChild(confirm);
      actions.appendChild(reject);
      left.appendChild(actions);
    } else {
      addText(left, "career__value", fact.value);
      if (fact.kind === "metric" && (fact.baseline || fact.mechanism)) {
        addText(left, "career__doc", "Baseline: " + (fact.baseline || "none") + ". Mechanism: " + (fact.mechanism || "none") + ".");
      }
      if (rejected) {
        var restoreActions = document.createElement("div");
        restoreActions.className = "career__actions";
        var restore = document.createElement("button");
        restore.type = "button";
        restore.className = "career__restore";
        restore.textContent = "Restore";
        restore.addEventListener("click", function () {
          saveFact({ id: fact.id, action: "restore" }, [restore]);
        });
        restoreActions.appendChild(restore);
        left.appendChild(restoreActions);
      }
    }

    var right = document.createElement("div");
    addText(right, "career__kind", "Source");
    addText(right, "career__excerpt", fact.source && fact.source.excerpt ? fact.source.excerpt : "");
    addText(right, "career__doc", fact.source && fact.source.document ? fact.source.document : "");

    pair.appendChild(left);
    pair.appendChild(right);
    row.appendChild(pair);
    return row;
  }

  function renderRules(rules) {
    rulesEl.replaceChildren();
    (rules || []).forEach(function (rule) {
      var row = document.createElement("li");
      row.className = "career__rule";
      addText(row, "career__kind", rule.field || "rule");
      addText(row, "career__ruletext", rule.rule || "");
      rulesEl.appendChild(row);
    });
  }

  function renderList(el, facts, mode, emptyText) {
    el.replaceChildren();
    if (!facts || !facts.length) {
      var empty = document.createElement("li");
      empty.className = "career__empty";
      empty.textContent = emptyText;
      el.appendChild(empty);
      return;
    }
    facts.forEach(function (fact) {
      el.appendChild(renderFact(fact, mode));
    });
  }

  function render() {
    if (!record) return;
    renderList(proposedEl, record.proposed_facts, "proposed", "Nothing waiting. Upload a resume to propose facts.");
    renderList(verifiedEl, record.verified_facts, "verified", "None yet.");
    renderList(rejectedEl, record.rejected_facts, "rejected", "None.");
    renderRules(record.rules);
  }

  function applyRecord(body) {
    record = body;
    render();
  }

  function saveFact(body, buttons) {
    var controls = buttons || [];
    controls.forEach(function (button) { button.disabled = true; });
    setStatus("");
    fetch("/api/career?action=fact", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(body),
    }).then(readJson).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status !== 200 || !result.body || !Array.isArray(result.body.proposed_facts)) {
        controls.forEach(function (button) { button.disabled = false; });
        setStatus((result.body && result.body.error) || "Could not save that fact.");
        return;
      }
      applyRecord(result.body);
    }).catch(function () {
      controls.forEach(function (button) { button.disabled = false; });
      setStatus("Could not save that fact.");
    });
  }

  function readFile(file) {
    return new Promise(function (resolve, rejectFile) {
      var reader = new FileReader();
      var name = file.name || "upload";
      var isPdf = /\.pdf$/i.test(name) || file.type === "application/pdf";
      reader.onerror = function () { rejectFile(new Error("read")); };
      reader.onload = function () {
        if (isPdf) {
          var bytes = new Uint8Array(reader.result);
          var binary = "";
          for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          resolve({ name: name, kind: "pdf", pdf_base64: btoa(binary) });
          return;
        }
        resolve({ name: name, kind: "markdown", text: String(reader.result || "") });
      };
      if (isPdf) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    });
  }

  uploadForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var files = fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
    if (!files.length) {
      setStatus("Choose a PDF or markdown resume first.");
      return;
    }
    uploadButton.disabled = true;
    setStatus("");
    Promise.all(files.map(readFile)).then(function (documents) {
      return fetch("/api/career?action=extract", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ documents: documents }),
      }).then(readJson);
    }).then(function (result) {
      uploadButton.disabled = false;
      if (handleAuth(result)) return;
      if (result.status !== 200 || !result.body || !Array.isArray(result.body.proposed_facts)) {
        setStatus((result.body && result.body.error) || "Could not extract facts.");
        return;
      }
      fileInput.value = "";
      applyRecord(result.body);
    }).catch(function () {
      uploadButton.disabled = false;
      setStatus("Could not extract facts.");
    });
  });

  fetch("/api/career", { headers: authHeaders(false) })
    .then(readJson)
    .then(function (result) {
      if (handleAuth(result)) return;
      if (result.status !== 200 || !result.body || !Array.isArray(result.body.proposed_facts)) {
        setStatus((result.body && result.body.error) || "Could not load the career record.");
        return;
      }
      applyRecord(result.body);
    })
    .catch(function () {
      setStatus("Could not load the career record.");
    });
})();
