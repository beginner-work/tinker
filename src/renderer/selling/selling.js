/* /selling — break content into stage-tagged parts. Stytch session only. */
(function () {
  "use strict";
  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var excerptApi = window.tinkerSellingExcerpt || {};
  var listEl = document.getElementById("selling-list");
  var stageEl = document.getElementById("selling-stage");
  var statusEl = document.getElementById("selling-status");
  var filtersEl = document.getElementById("board-filters");
  var tabSources = document.getElementById("tab-sources");
  var tabBoard = document.getElementById("tab-board");
  var tabStages = document.getElementById("tab-stages");
  var view = "sources";
  var stages = [];
  var parts = [];
  var sources = [];
  var selectedSource = null;
  var filter = { topic: "", status: "", sourceKind: "", stack: "", concepts: "" };
  var sourceText = "";
  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (err) { return ""; }
  }
  function sendHome() {
    try { sessionStorage.setItem(RETURN_KEY, "/selling"); } catch (err) { /* ignore */ }
    window.location.assign("/");
  }
  if (!token()) { sendHome(); return; }
  function setStatus(text) { statusEl.textContent = text || ""; }
  function showList() { document.body.dataset.sellingPanel = "list"; }
  function showDetail() { document.body.dataset.sellingPanel = "detail"; }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function whenPt(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles",
    }) + " PT";
  }
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
  function api(method, action, opts) {
    opts = opts || {};
    var url = "/api/selling-parts?action=" + encodeURIComponent(action || "");
    if (opts.id) url += "&id=" + encodeURIComponent(opts.id);
    ["stage", "topic", "status", "sourceKind", "stack", "concepts"].forEach(function (key) {
      if (opts[key]) url += "&" + key + "=" + encodeURIComponent(opts[key]);
    });
    var init = { method: method, headers: authHeaders(!!opts.body) };
    if (opts.body) init.body = JSON.stringify(opts.body);
    return fetch(url, init).then(readJson);
  }
  function getJson(path) {
    return fetch(path, { headers: authHeaders(false) }).then(readJson);
  }
  function backButton() {
    var back = el("button", "selling__ghost selling__back", "Back");
    back.type = "button";
    back.addEventListener("click", showList);
    return back;
  }
  function setTab(next) {
    view = next;
    tabSources.setAttribute("aria-selected", next === "sources" ? "true" : "false");
    tabBoard.setAttribute("aria-selected", next === "board" ? "true" : "false");
    tabStages.setAttribute("aria-selected", next === "stages" ? "true" : "false");
    filtersEl.hidden = next !== "board";
    showList();
    renderList();
    if (next === "board") renderBoard();
    else if (next === "stages") renderStagesEditor();
    else stageEl.replaceChildren(el("p", "selling__empty", "Pick a source, or start a part from scratch."));
  }
  function sourceLabel(item) {
    return item.title || item.name || item.value || item.id || "Untitled";
  }
  function pushSources(kind, items) {
    (items || []).forEach(function (item) {
      if (!item || !item.id) return;
      sources.push({
        kind: kind,
        id: item.id,
        title: sourceLabel(item),
        text: [item.title, item.body, item.value, item.baseline, item.mechanism].filter(Boolean).join("\n\n"),
      });
    });
  }
  function loadSources() {
    sources = [
      { kind: "none", id: "", title: "New part from scratch", text: "" },
      { kind: "code", id: "", title: "Part from code", text: "" },
    ];
    return Promise.all([
      getJson("/api/user-data/drafts"),
      getJson("/api/user-data/essays"),
      getJson("/api/user-data/taxonomy"),
      getJson("/api/user-data/pitches"),
      getJson("/api/content"),
      getJson("/api/career"),
    ]).then(function (results) {
      results.forEach(function (result) { if (handleAuth(result)) return; });
      var drafts = results[0].body && results[0].body.data;
      var essays = results[1].body && results[1].body.data;
      pushSources("note", Array.isArray(drafts) ? drafts : []);
      pushSources("note", Array.isArray(essays) ? essays : []);
      var tax = results[2].body && results[2].body.data;
      var concepts = tax && (tax.concepts || tax.taxonomy || tax.items || (Array.isArray(tax) ? tax : []));
      pushSources("concept", concepts);
      var pitches = results[3].body && results[3].body.data;
      pushSources("narrative", pitches && pitches.pitches);
      var content = results[4].body && (results[4].body.items || results[4].body.content);
      pushSources("content_item", content);
      var career = results[5].body;
      var facts = career && (career.facts || (career.record && career.record.facts));
      pushSources("career_record", facts);
      if (view === "sources") renderList();
    });
  }
  function loadStages() {
    return api("GET", "stages").then(function (result) {
      if (handleAuth(result)) return;
      if (result.status !== 200) { setStatus((result.body && result.body.error) || "Could not load stages."); return; }
      stages = result.body.stages || [];
    });
  }
  function loadParts() {
    return api("GET", "list", filter).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status !== 200) { setStatus((result.body && result.body.error) || "Could not load parts."); return; }
      parts = result.body.parts || [];
      if (view === "board") { renderList(); renderBoard(); }
    });
  }
  function renderList() {
    listEl.replaceChildren();
    if (view === "sources") {
      sources.forEach(function (source) {
        var li = document.createElement("li");
        var btn = el("button", "selling__row");
        btn.type = "button";
        if (selectedSource && selectedSource.kind === source.kind && selectedSource.id === source.id) btn.setAttribute("aria-current", "true");
        btn.appendChild(el("span", "selling__name", source.title));
        btn.appendChild(el("span", "selling__meta", source.kind === "none" ? "scratch" : (source.kind === "code" && !source.id ? "repo path ref" : source.kind)));
        btn.addEventListener("click", function () { openSource(source); });
        li.appendChild(btn);
        listEl.appendChild(li);
      });
      return;
    }
    if (view === "board") {
      if (!parts.length) listEl.appendChild(el("li", "selling__meta", "No parts yet."));
      parts.forEach(function (part) {
        var li = document.createElement("li");
        var btn = el("button", "selling__row");
        btn.type = "button";
        btn.appendChild(el("span", "selling__name", part.title || "(untitled)"));
        btn.appendChild(el("span", "selling__meta", part.stageKey + " · " + part.status + ((part.concepts || []).length ? " · " + part.concepts.join(", ") : "")));
        if (part.sourceChanged) btn.appendChild(el("span", "selling__chip", "source changed"));
        btn.addEventListener("click", function () { openPart(part.id); });
        li.appendChild(btn);
        listEl.appendChild(li);
      });
      return;
    }
    stages.forEach(function (stage) {
      var li = document.createElement("li");
      li.appendChild(el("span", "selling__name", (stage.retired ? "(retired) " : "") + stage.name));
      li.appendChild(el("span", "selling__meta", stage.key + " · position " + stage.position));
      listEl.appendChild(li);
    });
  }
  function openSource(source) {
    selectedSource = source;
    sourceText = source.text || "";
    renderList();
    var wrap = document.createElement("div");
    wrap.appendChild(backButton());
    wrap.appendChild(el("h2", "selling__panel-title", source.title));
    wrap.appendChild(el("p", "selling__meta", source.kind === "none" ? "Write a part from scratch." : (source.kind === "code" && !source.id ? "Enter repo, path, ref, evidence." : source.kind + " · " + (source.id || ""))));
    if (source.kind === "none" || (source.kind === "code" && !source.id)) {
      renderPartForm({ body: "", sourceExcerpt: "", sourceKind: source.kind, sourceId: null, sourceRef: {}, concepts: [], stack: [] }, wrap);
      stageEl.replaceChildren(wrap);
      showDetail();
      return;
    }
    var box = el("div", "selling__source");
    var text = el("div", "selling__source-text", sourceText || "(empty)");
    text.id = "source-text";
    box.appendChild(text);
    wrap.appendChild(box);
    var actions = el("div", "selling__actions");
    var make = el("button", "selling__btn", "Make a part from selection");
    make.type = "button";
    make.addEventListener("click", function () {
      var sel = window.getSelection();
      var raw = (sel && sel.toString()) || "";
      if (!raw) { setStatus("Select a passage in the source text."); return; }
      var start = sourceText.indexOf(raw);
      if (start < 0) { setStatus("Select text inside the source."); return; }
      try {
        var pref = excerptApi.prefillPart(sourceText, start, start + raw.length, source.kind, source.id);
        renderPartForm(pref);
      } catch (err) { setStatus(err.message || "Could not make a part."); }
    });
    actions.appendChild(make);
    wrap.appendChild(actions);
    stageEl.replaceChildren(wrap);
    showDetail();
  }
  function stageOptions(select, selected) {
    stages.filter(function (s) { return !s.retired || s.key === selected; }).forEach(function (stage) {
      var opt = document.createElement("option");
      opt.value = stage.key;
      opt.textContent = stage.name;
      if (stage.key === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }
  function renderPartForm(seed, into) {
    var wrap = into || document.createElement("div");
    if (!into) wrap.appendChild(backButton());
    wrap.appendChild(el("h3", "selling__section", seed.id ? "Edit part" : "New part"));
    var form = el("form", "selling__form");
    form.appendChild(el("label", "selling__label", "Title"));
    var title = el("input", "selling__input");
    title.value = seed.title || "";
    form.appendChild(title);
    form.appendChild(el("label", "selling__label", "Stage"));
    var stageSel = el("select", "selling__select");
    stageOptions(stageSel, seed.stageKey || (stages[0] && stages[0].key));
    form.appendChild(stageSel);
    form.appendChild(el("label", "selling__label", "Body"));
    var body = el("textarea", "selling__area");
    body.value = seed.body || "";
    form.appendChild(body);
    form.appendChild(el("label", "selling__label", "Concepts (kebab-case)"));
    var concepts = el("input", "selling__input");
    concepts.value = (seed.concepts || []).join(", ");
    concepts.placeholder = "idempotency, domain-driven-design";
    form.appendChild(concepts);
    form.appendChild(el("label", "selling__label", "Stack (tools)"));
    var stack = el("input", "selling__input");
    stack.value = (seed.stack || []).join(", ");
    stack.placeholder = "typescript, prisma";
    form.appendChild(stack);
    form.appendChild(el("label", "selling__label", "Source excerpt"));
    var excerpt = el("textarea", "selling__area");
    excerpt.value = seed.sourceExcerpt || "";
    form.appendChild(excerpt);
    var repo = el("input", "selling__input");
    var path = el("input", "selling__input");
    var ref = el("input", "selling__input");
    var evidence = el("input", "selling__input");
    repo.placeholder = "owner/repo"; path.placeholder = "path"; ref.placeholder = "ref";
    evidence.placeholder = "evidence paths, comma-separated";
    repo.value = (seed.sourceRef && seed.sourceRef.repo) || "";
    path.value = (seed.sourceRef && seed.sourceRef.path) || "";
    ref.value = (seed.sourceRef && seed.sourceRef.ref) || "";
    evidence.value = ((seed.sourceRef && seed.sourceRef.evidence) || []).join(", ");
    form.appendChild(el("label", "selling__label", "Code sourceRef"));
    form.appendChild(repo); form.appendChild(path); form.appendChild(ref); form.appendChild(evidence);
    var start = el("input", "selling__input");
    var number = el("input", "selling__input");
    var cause = el("input", "selling__input");
    var team = el("input", "selling__input");
    start.placeholder = "start"; number.placeholder = "number"; cause.placeholder = "cause";
    team.placeholder = "team or role";
    start.value = (seed.fields && seed.fields.start) || "";
    number.value = (seed.fields && seed.fields.number) || "";
    cause.value = (seed.fields && seed.fields.cause) || "";
    team.value = (seed.fields && seed.fields.teamOrRole) || "";
    form.appendChild(el("label", "selling__label", "Proof point fields"));
    form.appendChild(start); form.appendChild(number); form.appendChild(cause);
    form.appendChild(el("label", "selling__label", "Fit tag"));
    form.appendChild(team);
    var actions = el("div", "selling__actions");
    var save = el("button", "selling__btn", seed.id ? "Save" : "Create part");
    save.type = "submit";
    actions.appendChild(save);
    form.appendChild(actions);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      save.disabled = true;
      var payload = excerptApi.buildPartPayload({
        title: title.value,
        stageKey: stageSel.value,
        body: body.value,
        concepts: concepts.value,
        stack: stack.value,
        fields: { start: start.value, number: number.value, cause: cause.value, teamOrRole: team.value },
        sourceExcerpt: excerpt.value,
        sourceKind: seed.sourceKind || "none",
        sourceId: seed.sourceId || null,
        repo: repo.value,
        path: path.value,
        ref: ref.value,
        evidence: evidence.value,
      });
      var req = seed.id
        ? api("PATCH", "edit", { id: seed.id, body: payload })
        : api("POST", "create", { body: payload });
      req.then(function (result) {
        save.disabled = false;
        if (handleAuth(result)) return;
        if (result.status >= 400) {
          setStatus((result.body && result.body.error) || "Could not save part.");
          return;
        }
        setStatus("");
        loadParts().then(function () { openPart(result.body.part.id); });
      }).catch(function () { save.disabled = false; setStatus("Could not save part."); });
    });
    wrap.appendChild(form);
    if (!into) { stageEl.replaceChildren(wrap); showDetail(); }
  }
  function openPart(id) {
    api("GET", "part", { id: id }).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status === 404) {
        stageEl.replaceChildren(backButton(), el("p", "selling__empty", "Not found."));
        showDetail();
        return;
      }
      if (result.status !== 200 || !result.body) {
        setStatus((result.body && result.body.error) || "Could not load part.");
        return;
      }
      var part = result.body.part;
      var events = result.body.events || [];
      var wrap = document.createElement("div");
      wrap.appendChild(backButton());
      wrap.appendChild(el("h2", "selling__panel-title", part.title || "(untitled)"));
      var meta = part.stageKey + " · " + part.status + " · " + part.sourceKind;
      if (part.sourceId) meta += " · " + part.sourceId;
      wrap.appendChild(el("p", "selling__meta", meta));
      if (part.sourceChanged) wrap.appendChild(el("span", "selling__chip", "source changed"));
      renderPartForm(part, wrap);
      var statusRow = el("div", "selling__actions");
      ["draft", "ready", "retired"].forEach(function (status) {
        var btn = el("button", status === part.status ? "selling__btn" : "selling__ghost", status);
        btn.type = "button";
        btn.disabled = status === part.status;
        btn.addEventListener("click", function () {
          btn.disabled = true;
          api("POST", "status", { id: part.id, body: { status: status } }).then(function (res) {
            btn.disabled = false;
            if (handleAuth(res)) return;
            if (res.status >= 400) {
              setStatus((res.body && res.body.error) || "Could not set status.");
              var verdicts = res.body && (res.body.checkVerdicts || (res.body.part && res.body.part.checkVerdicts));
              if (verdicts && verdicts.length) setStatus(JSON.stringify(verdicts));
              return;
            }
            var readyPart = res.body.part;
            if (readyPart && readyPart.checkVerdicts && readyPart.checkVerdicts.length) {
              setStatus("check_text: " + JSON.stringify(readyPart.checkVerdicts));
            } else setStatus("");
            loadParts().then(function () { openPart(part.id); });
          }).catch(function () { btn.disabled = false; setStatus("Could not set status."); });
        });
        statusRow.appendChild(btn);
      });
      wrap.appendChild(statusRow);
      wrap.appendChild(el("h3", "selling__section", "Audit trail"));
      if (!events.length) wrap.appendChild(el("p", "selling__meta", "No events yet."));
      events.forEach(function (event) {
        var row = el("div", "selling__event");
        row.appendChild(el("span", null, (event.actor || "") + " · " + (event.action || "")));
        row.appendChild(el("span", null, whenPt(event.at)));
        wrap.appendChild(row);
      });
      stageEl.replaceChildren(wrap);
      showDetail();
    }).catch(function () { setStatus("Could not load part."); });
  }
  function renderBoard() {
    var wrap = document.createElement("div");
    wrap.appendChild(backButton());
    wrap.appendChild(el("h2", "selling__panel-title", "Parts board"));
    var board = el("div", "selling__board");
    var active = stages.filter(function (s) { return !s.retired; }).concat(
      stages.filter(function (s) { return s.retired && parts.some(function (p) { return p.stageKey === s.key; }); })
    );
    active.forEach(function (stage) {
      var col = el("section", "selling__column");
      col.appendChild(el("h3", null, stage.name + (stage.retired ? " (retired)" : "")));
      parts.filter(function (p) { return p.stageKey === stage.key; }).forEach(function (part) {
        var card = el("button", "selling__card");
        card.type = "button";
        card.appendChild(el("span", "selling__name", part.title || "(untitled)"));
        card.appendChild(el("span", "selling__meta", part.status + (part.sourceId ? " · " + part.sourceKind : "")));
        if (part.sourceChanged) card.appendChild(el("span", "selling__chip", "source changed"));
        card.addEventListener("click", function () { openPart(part.id); });
        col.appendChild(card);
      });
      board.appendChild(col);
    });
    wrap.appendChild(board);
    stageEl.replaceChildren(wrap);
    renderBoardFilters();
  }
  function renderBoardFilters() {
    filtersEl.replaceChildren();
    function addFilter(label, key, values) {
      values.forEach(function (value) {
        var btn = el("button", "selling__filter", value || label);
        btn.type = "button";
        btn.setAttribute("data-key", key);
        btn.setAttribute("data-value", value);
        btn.setAttribute("aria-pressed", filter[key] === value ? "true" : "false");
        filtersEl.appendChild(btn);
      });
    }
    addFilter("All status", "status", ["", "draft", "ready", "retired"]);
    addFilter("All sources", "sourceKind", ["", "note", "concept", "narrative", "content_item", "career_record", "code", "none"]);
    var stacks = []; var conceptTags = [];
    parts.forEach(function (part) {
      (part.stack || []).forEach(function (tag) { if (stacks.indexOf(tag) < 0) stacks.push(tag); });
      (part.concepts || []).forEach(function (tag) { if (conceptTags.indexOf(tag) < 0) conceptTags.push(tag); });
    });
    addFilter("All concepts", "concepts", [""].concat(conceptTags));
    addFilter("All stack", "stack", [""].concat(stacks));
  }
  filtersEl.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-key]");
    if (!btn) return;
    filter[btn.getAttribute("data-key")] = btn.getAttribute("data-value") || "";
    loadParts();
  });
  function renderStagesEditor() {
    var wrap = document.createElement("div");
    wrap.appendChild(backButton());
    wrap.appendChild(el("h2", "selling__panel-title", "Stages"));
    wrap.appendChild(el("p", "selling__meta", "Rename, reorder, add, or retire. Existing parts stay readable."));
    var form = el("form", "selling__form");
    var rows = stages.map(function (stage) { return Object.assign({}, stage); });
    function draw() {
      form.replaceChildren();
      rows.sort(function (a, b) { return a.position - b.position; }).forEach(function (stage, index) {
        form.appendChild(el("label", "selling__label", stage.key));
        var name = el("input", "selling__input");
        name.value = stage.name;
        name.addEventListener("input", function () { stage.name = name.value; });
        form.appendChild(name);
        var desc = el("input", "selling__input");
        desc.value = stage.description || "";
        desc.placeholder = "description";
        desc.addEventListener("input", function () { stage.description = desc.value; });
        form.appendChild(desc);
        var actions = el("div", "selling__actions");
        var up = el("button", "selling__ghost", "Up");
        up.type = "button";
        up.addEventListener("click", function () {
          if (index === 0) return;
          var prev = rows[index - 1];
          var tmp = stage.position; stage.position = prev.position; prev.position = tmp;
          draw();
        });
        var down = el("button", "selling__ghost", "Down");
        down.type = "button";
        down.addEventListener("click", function () {
          if (index >= rows.length - 1) return;
          var next = rows[index + 1];
          var tmp = stage.position; stage.position = next.position; next.position = tmp;
          draw();
        });
        var retire = el("button", "selling__ghost", stage.retired ? "Restore" : "Retire");
        retire.type = "button";
        retire.addEventListener("click", function () { stage.retired = !stage.retired; draw(); });
        actions.appendChild(up); actions.appendChild(down); actions.appendChild(retire);
        form.appendChild(actions);
      });
      form.appendChild(el("label", "selling__label", "Add stage key"));
      var key = el("input", "selling__input");
      key.placeholder = "new_stage";
      form.appendChild(key);
      form.appendChild(el("label", "selling__label", "Name"));
      var newName = el("input", "selling__input");
      form.appendChild(newName);
      var add = el("button", "selling__ghost", "Add stage");
      add.type = "button";
      add.addEventListener("click", function () {
        if (!key.value.trim() || !newName.value.trim()) { setStatus("Key and name are required."); return; }
        rows.push({ key: key.value.trim(), name: newName.value.trim(), description: "", position: rows.length, retired: false });
        draw();
      });
      form.appendChild(add);
      var save = el("button", "selling__btn", "Save stages");
      save.type = "submit";
      form.appendChild(save);
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      api("POST", "stages", { body: { stages: rows } }).then(function (result) {
        if (handleAuth(result)) return;
        if (result.status !== 200) { setStatus((result.body && result.body.error) || "Could not save stages."); return; }
        stages = result.body.stages || [];
        setStatus("");
        renderList();
        renderStagesEditor();
      }).catch(function () { setStatus("Could not save stages."); });
    });
    wrap.appendChild(form);
    stageEl.replaceChildren(wrap);
    draw();
    showDetail();
  }
  tabSources.addEventListener("click", function () { setTab("sources"); });
  tabBoard.addEventListener("click", function () { setTab("board"); loadParts(); });
  tabStages.addEventListener("click", function () { setTab("stages"); });
  Promise.all([loadStages(), loadSources(), loadParts()]).then(function () {
    setTab("sources");
  }).catch(function () { setStatus("Could not load selling parts."); });
})();
