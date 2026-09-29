/* /leads
 *
 * Same sign-in as the rest of tinker: localStorage.tinker_jwt.
 * List, add, edit, import, and stage outcomes hit /api/leads.
 * Drafts live in the sidebar (TYL-63), not on this page.
 * Text is assigned with textContent.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var catalog = window.tinkerLeads || { STAGES: [], SOURCES: [], OUTCOMES: [] };
  var statusEl = document.getElementById("leads-status");
  var boardEl = document.getElementById("leads-board");
  var form = document.getElementById("leads-form");
  var formHeading = document.getElementById("leads-form-heading");
  var cancelBtn = document.getElementById("leads-cancel");
  var outcomesEl = document.getElementById("leads-outcomes");
  var filterStage = document.getElementById("leads-filter-stage");
  var filterCompany = document.getElementById("leads-filter-company");
  var importText = document.getElementById("leads-import-text");
  var leads = [];
  var selectedId = "";

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (err) { return ""; }
  }
  function sendHome() {
    try { sessionStorage.setItem(RETURN_KEY, "/leads"); }
    catch (err) { /* sign-in still works */ }
    window.location.assign("/");
  }
  if (!token()) { sendHome(); return; }

  function setStatus(text) { statusEl.textContent = text || ""; }
  function authHeaders(json) {
    var headers = { Authorization: "Bearer " + token() };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }
  function readJson(res) {
    return res.json().then(function (body) {
      return { status: res.status, body: body };
    }, function () { return { status: res.status, body: null }; });
  }
  function handleAuth(result) {
    if (result.status === 401) {
      try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
      sendHome();
      return true;
    }
    return false;
  }
  function labelFor(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].label;
    return key || "";
  }
  function fillSelect(el, items, withAll) {
    el.replaceChildren();
    if (withAll) {
      var all = document.createElement("option");
      all.value = "";
      all.textContent = "All stages";
      el.appendChild(all);
    }
    items.forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = item.key;
      opt.textContent = item.label;
      el.appendChild(opt);
    });
  }
  function field(id) { return document.getElementById(id); }
  function dateInputValue(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }
  function nextStepIso(value) {
    if (!value) return null;
    return value + "T12:00:00.000Z";
  }

  function api(action, method, body, query) {
    var url = "/api/leads?action=" + encodeURIComponent(action);
    if (query) Object.keys(query).forEach(function (key) {
      if (query[key]) url += "&" + encodeURIComponent(key) + "=" + encodeURIComponent(query[key]);
    });
    var opts = { method: method, headers: authHeaders(!!body) };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(readJson);
  }

  function resetForm() {
    selectedId = "";
    field("leads-id").value = "";
    ["leads-personName", "leads-personTitle", "leads-company", "leads-email", "leads-linkedInUrl", "leads-targetRoleTitle", "leads-postingUrl", "leads-nextStep", "leads-nextStepAt", "leads-notes"].forEach(function (id) {
      field(id).value = "";
    });
    field("leads-source").value = "other";
    formHeading.textContent = "Add a lead";
    cancelBtn.hidden = true;
    outcomesEl.hidden = true;
    outcomesEl.replaceChildren();
    renderBoard();
  }

  function fillForm(lead) {
    selectedId = lead.id;
    field("leads-id").value = lead.id;
    field("leads-personName").value = lead.personName || "";
    field("leads-personTitle").value = lead.personTitle || "";
    field("leads-company").value = lead.company || "";
    field("leads-email").value = lead.email || "";
    field("leads-linkedInUrl").value = lead.linkedInUrl || "";
    field("leads-targetRoleTitle").value = lead.targetRoleTitle || "";
    field("leads-postingUrl").value = lead.postingUrl || "";
    field("leads-source").value = lead.source || "other";
    field("leads-nextStep").value = lead.nextStep || "";
    field("leads-nextStepAt").value = dateInputValue(lead.nextStepAt);
    field("leads-notes").value = lead.notes || "";
    formHeading.textContent = "Edit lead";
    cancelBtn.hidden = false;
    outcomesEl.hidden = false;
    outcomesEl.replaceChildren();
    catalog.OUTCOMES.forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "leads__button leads__button--quiet";
      btn.textContent = item.label;
      btn.addEventListener("click", function () { setOutcome(lead.id, item.key, btn); });
      outcomesEl.appendChild(btn);
    });
    renderBoard();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function formPayload() {
    return {
      personName: field("leads-personName").value,
      personTitle: field("leads-personTitle").value,
      company: field("leads-company").value,
      email: field("leads-email").value,
      linkedInUrl: field("leads-linkedInUrl").value,
      targetRoleTitle: field("leads-targetRoleTitle").value,
      postingUrl: field("leads-postingUrl").value,
      source: field("leads-source").value,
      nextStep: field("leads-nextStep").value,
      nextStepAt: nextStepIso(field("leads-nextStepAt").value),
      notes: field("leads-notes").value,
    };
  }

  function renderBoard() {
    boardEl.replaceChildren();
    var stageFilter = filterStage.value;
    var companyFilter = (filterCompany.value || "").trim().toLowerCase();
    var groups = {};
    catalog.STAGES.forEach(function (stage) { groups[stage.key] = []; });
    leads.forEach(function (lead) {
      if (stageFilter && lead.stage !== stageFilter) return;
      if (companyFilter && String(lead.company || "").toLowerCase() !== companyFilter) return;
      if (!groups[lead.stage]) groups[lead.stage] = [];
      groups[lead.stage].push(lead);
    });
    var any = false;
    catalog.STAGES.forEach(function (stage) {
      var rows = groups[stage.key] || [];
      if (stageFilter && stage.key !== stageFilter) return;
      if (!rows.length && stageFilter !== stage.key) return;
      any = true;
      var section = document.createElement("section");
      section.className = "leads__stage";
      var heading = document.createElement("h2");
      heading.className = "leads__heading";
      heading.textContent = stage.label + " (" + rows.length + ")";
      section.appendChild(heading);
      var list = document.createElement("ul");
      list.className = "leads__list";
      if (!rows.length) {
        var empty = document.createElement("li");
        empty.className = "leads__empty";
        empty.textContent = "No leads in this stage.";
        list.appendChild(empty);
      } else {
        rows.forEach(function (lead) {
          var li = document.createElement("li");
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "leads__row" + (lead.id === selectedId ? " is-selected" : "");
          var left = document.createElement("div");
          var name = document.createElement("p");
          name.className = "leads__name";
          name.textContent = lead.personName || "Untitled";
          var meta = document.createElement("p");
          meta.className = "leads__meta";
          meta.textContent = [lead.personTitle, lead.company, labelFor(catalog.SOURCES, lead.source)].filter(Boolean).join(" · ");
          left.appendChild(name);
          left.appendChild(meta);
          if (lead.nextStep) {
            var next = document.createElement("p");
            next.className = "leads__meta";
            next.textContent = "Next: " + lead.nextStep;
            left.appendChild(next);
          }
          var right = document.createElement("p");
          right.className = "leads__meta";
          right.textContent = lead.targetRoleTitle || "";
          btn.appendChild(left);
          btn.appendChild(right);
          btn.addEventListener("click", function () { fillForm(lead); });
          li.appendChild(btn);
          list.appendChild(li);
        });
      }
      section.appendChild(list);
      boardEl.appendChild(section);
    });
    if (!any) {
      var none = document.createElement("p");
      none.className = "leads__empty";
      none.textContent = "No leads yet. Add one or paste a list.";
      boardEl.appendChild(none);
    }
  }

  function loadLeads() {
    setStatus("");
    return api("list", "GET", null, {
      stage: filterStage.value,
      company: filterCompany.value.trim(),
    }).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status >= 400) {
        setStatus((result.body && result.body.error) || "Could not load leads.");
        return;
      }
      leads = (result.body && result.body.leads) || [];
      renderBoard();
    }).catch(function () { setStatus("Could not load leads."); });
  }

  function saveLead(event) {
    event.preventDefault();
    var payload = formPayload();
    var editing = !!field("leads-id").value;
    var saveBtn = field("leads-save");
    saveBtn.disabled = true;
    setStatus("");
    var req = editing
      ? api("edit", "PATCH", Object.assign({ id: field("leads-id").value }, payload))
      : api("create", "POST", payload);
    req.then(function (result) {
      saveBtn.disabled = false;
      if (handleAuth(result)) return;
      if (result.status >= 400) {
        setStatus((result.body && result.body.error) || "Could not save the lead.");
        return;
      }
      resetForm();
      return loadLeads();
    }).catch(function () {
      saveBtn.disabled = false;
      setStatus("Could not save the lead.");
    });
  }

  function setOutcome(id, outcome, btn) {
    btn.disabled = true;
    api("stage", "POST", { id: id, outcome: outcome }).then(function (result) {
      btn.disabled = false;
      if (handleAuth(result)) return;
      if (result.status >= 400) {
        setStatus((result.body && result.body.error) || "Could not update the stage.");
        return;
      }
      resetForm();
      return loadLeads();
    }).catch(function () {
      btn.disabled = false;
      setStatus("Could not update the stage.");
    });
  }

  function importLeads() {
    var text = importText.value;
    var btn = field("leads-import");
    btn.disabled = true;
    setStatus("");
    api("import", "POST", { text: text }).then(function (result) {
      btn.disabled = false;
      if (handleAuth(result)) return;
      if (result.status >= 400) {
        setStatus((result.body && result.body.error) || "Could not import.");
        return;
      }
      importText.value = "";
      return loadLeads();
    }).catch(function () {
      btn.disabled = false;
      setStatus("Could not import.");
    });
  }

  fillSelect(filterStage, catalog.STAGES, true);
  fillSelect(field("leads-source"), catalog.SOURCES, false);
  field("leads-source").value = "other";
  form.addEventListener("submit", saveLead);
  cancelBtn.addEventListener("click", resetForm);
  field("leads-filter-apply").addEventListener("click", loadLeads);
  field("leads-filter-clear").addEventListener("click", function () {
    filterStage.value = "";
    filterCompany.value = "";
    loadLeads();
  });
  field("leads-import").addEventListener("click", importLeads);
  loadLeads();
})();
