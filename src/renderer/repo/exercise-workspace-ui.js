/* Exercise explorer for per-owner exercise file trees.
 *
 * Seeds from /lib/exercise-workspace-seed.json + manifest. Tinker owners
 * sync through /api/exercise-workspace. GitHub is never written (per-user
 * TinkerUserData only; desktop clones/pulls lindowlabs for Open in IDE).
 *
 * Essay → Claude revise_from_essay updates README / steps / starter stubs.
 * Transform status (pending / error) shows a spinner or retry on the tree.
 *
 * Lindow Labs Learning sign-in gates listing and reading exercise files.
 * Mobile keeps code read-only / hidden; desktop keeps editing.
 */
(function () {
  "use strict";

  var core = window.tinkerExerciseWorkspaceCore;
  var manifest = window.tinkerExercisesManifest;
  var cmApi = window.tinkerCodeMirror;
  var learningAuth = window.tinkerLearningAuth || null;
  var revision = window.tinkerExerciseRevision || null;
  if (!core) return;
  var cmEditor = null;

  var TOKEN_KEY = "tinker_jwt";
  var state = {
    workspace: core.emptyWorkspace(),
    collapsed: {},
    selected: { exerciseId: null, nodeId: null },
    openTabs: [],
    activeTabId: null,
    drag: null,
    pendingDelete: null,
    dirty: false,
    status: "",
    localOnly: true,
    // exerciseId → { steps, at } after an essay revision
    revised: {},
    // exerciseId → { status: 'pending'|'error'|'done', essayBody, error }
    transform: {},
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function text(node, value) {
    if (node) node.textContent = value == null ? "" : String(value);
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function token() {
    try { return window.localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }

  function isLearningSignedIn() {
    try {
      if (learningAuth && typeof learningAuth.isLearningSignedIn === "function") {
        return !!learningAuth.isLearningSignedIn();
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function requestLearningSignIn() {
    try {
      if (learningAuth && typeof learningAuth.requestLearningSignIn === "function") {
        return learningAuth.requestLearningSignIn();
      }
    } catch (e) { /* ignore */ }
    try {
      if (window.tinkerMadeByLindowLabs && typeof window.tinkerMadeByLindowLabs.openDrawer === "function") {
        window.tinkerMadeByLindowLabs.openDrawer(window.tinkerMadeByLindowLabs.learningLabUrl);
        return true;
      }
    } catch (e2) { /* ignore */ }
    return false;
  }

  function tabId(exerciseId, nodeId) {
    return "exfile:" + exerciseId + ":" + nodeId;
  }

  function bindEls() {
    els = {
      layout: $("repo-layout"),
      explorer: $("repo-explorer"),
      scrim: $("repo-explorer-scrim"),
      body: $("repo-explorer-body"),
      empty: $("repo-explorer-empty"),
      hint: $("repo-explorer-hint"),
      collapse: $("repo-explorer-collapse"),
      expand: $("repo-explorer-expand"),
      newFile: $("repo-ex-new-file"),
      newFolder: $("repo-ex-new-folder"),
      gated: $("repo-explorer-gated"),
      signin: $("repo-explorer-signin"),
      signinBtn: $("repo-explorer-signin-btn"),
      stepsBanner: $("repo-ex-steps-banner"),
      tabs: $("repo-tabs"),
      code: $("repo-code"),
      codePath: $("repo-code-path"),
      codeSurface: $("repo-code-surface"),
      codeEditor: $("repo-code-editor"),
      codeSave: $("repo-code-save"),
      codeStatus: $("repo-code-status"),
      pad: $("repo-pad"),
      essayView: $("repo-essay-view"),
      location: $("repo-location"),
      padActions: $("repo-pad-actions"),
      confirm: $("repo-ex-confirm-sheet"),
      confirmHint: $("repo-ex-confirm-hint"),
      confirmDelete: $("repo-ex-confirm-delete"),
      confirmCancel: $("repo-ex-confirm-cancel"),
      confirmBackdrop: $("repo-ex-confirm-backdrop"),
    };
  }

  function applyAuthGate() {
    var signedIn = isLearningSignedIn();
    if (els.signin) els.signin.hidden = !!signedIn;
    if (els.gated) els.gated.hidden = !signedIn;
    if (!signedIn) {
      // Never list or open exercise files while signed out.
      state.openTabs = [];
      state.activeTabId = null;
      state.selected = { exerciseId: null, nodeId: null };
      showWritingChrome(true);
      destroyCm();
      if (els.body) clear(els.body);
      if (els.empty) els.empty.hidden = true;
      if (els.tabs) {
        clear(els.tabs);
        els.tabs.hidden = true;
      }
      if (els.code) els.code.hidden = true;
    }
    return signedIn;
  }

  function setExplorerOpen(open) {
    if (!els.layout) return;
    if (open) {
      els.layout.classList.remove("is-explorer-collapsed");
      els.layout.classList.add("is-explorer-open");
      if (els.expand) els.expand.hidden = true;
      // Scrim is CSS-shown only under max-width 800px; keep markup in sync.
      if (els.scrim) els.scrim.hidden = !!isWideDesktop();
    } else {
      els.layout.classList.add("is-explorer-collapsed");
      els.layout.classList.remove("is-explorer-open");
      if (els.expand) els.expand.hidden = false;
      if (els.scrim) els.scrim.hidden = true;
    }
  }

  /** Collapse empty (no-file) exercises by default so they don't paint an
   *  orphan "Write about" / "No files yet" block above titled trees. Expand
   *  the first exercise that has files when nothing is explicitly open yet. */
  function applyDefaultCollapsed() {
    var order = state.workspace.exerciseOrder || [];
    var firstWithFiles = null;
    order.forEach(function (exerciseId) {
      var key = "ex:" + exerciseId;
      var ex = state.workspace.exercises[exerciseId];
      var hasFiles = !!(ex && Array.isArray(ex.nodes) && ex.nodes.length);
      if (hasFiles && !firstWithFiles) firstWithFiles = exerciseId;
      if (Object.prototype.hasOwnProperty.call(state.collapsed, key)) return;
      // Empty / external-only modules start collapsed.
      if (!hasFiles) state.collapsed[key] = true;
    });
    if (firstWithFiles) {
      var openKey = "ex:" + firstWithFiles;
      if (!Object.prototype.hasOwnProperty.call(state.collapsed, openKey)) {
        state.collapsed[openKey] = false;
      }
    }
  }

  function toggleExplorer() {
    if (!isLearningSignedIn()) {
      requestLearningSignIn();
      setExplorerOpen(true);
      applyAuthGate();
      return;
    }
    // If currently collapsed, open; if open, collapse.
    var currentlyOpen = els.layout
      && !els.layout.classList.contains("is-explorer-collapsed")
      && (isWideDesktop() || els.layout.classList.contains("is-explorer-open"));
    setExplorerOpen(!currentlyOpen);
    applyAuthGate();
    render();
  }

  function api(method, action, body) {
    var t = token();
    if (!t) return Promise.reject(Object.assign(new Error("Sign in to edit exercises."), { status: 401 }));
    var opts = {
      method: method,
      headers: {
        Authorization: "Bearer " + t,
        Accept: "application/json",
      },
    };
    if (method === "POST") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body || {});
    }
    return fetch("/api/exercise-workspace?action=" + encodeURIComponent(action), opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) {
          var err = new Error((json && json.error) || ("HTTP " + res.status));
          err.status = res.status;
          err.code = json && json.code;
          err.nodeCount = json && json.nodeCount;
          throw err;
        }
        return json;
      });
    });
  }

  function applyWorkspace(ws) {
    state.workspace = core.normalizeWorkspace(ws);
  }

  function loadSeedLocal() {
    return fetch("/lib/exercise-workspace-seed.json", { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("seed missing");
        return res.json();
      })
      .then(function (seed) {
        var modules = (manifest && manifest.modules) || [];
        applyWorkspace(core.buildSeedWorkspace(seed, modules));
        state.localOnly = true;
        return state.workspace;
      });
  }

  function loadWorkspace() {
    if (!token()) return loadSeedLocal();
    return api("GET", "list").then(function (json) {
      applyWorkspace(json.workspace || json);
      state.localOnly = false;
      return state.workspace;
    }).catch(function () {
      return loadSeedLocal();
    });
  }

  function persistMutation(action, body, localMutator) {
    if (state.localOnly || !token()) {
      // Demo / signed-out: mutate in memory only (seed browse).
      var result = localMutator(state.workspace);
      applyWorkspace(result.workspace || state.workspace);
      state.status = "Sign in to save exercise edits in Tinker.";
      render();
      return Promise.resolve(result);
    }
    return api("POST", action, body).then(function (json) {
      applyWorkspace(json.workspace);
      state.status = "";
      render();
      return json;
    }).catch(function (err) {
      state.status = err.message || "Save failed.";
      render();
      throw err;
    });
  }

  function findNode(exerciseId, nodeId) {
    var ex = state.workspace.exercises[exerciseId];
    if (!ex) return null;
    return core.nodeById(ex.nodes, nodeId);
  }

  function isWideDesktop() {
    try {
      return !!(window.matchMedia && window.matchMedia("(min-width: 801px)").matches);
    } catch (e) {
      return false;
    }
  }

  function showWritingChrome(show) {
    // Desktop: writing stays visible; code opens above/beside it when a file
    // is selected. Mobile: code is never shown or editable.
    var desktop = isWideDesktop();
    if (els.pad) els.pad.hidden = false;
    if (els.location) els.location.hidden = false;
    if (!desktop) {
      if (els.code) els.code.hidden = true;
      if (els.codeSave) els.codeSave.hidden = true;
      if (els.layout) els.layout.classList.remove("is-code-open");
      if (document.body) document.body.classList.remove("repo-code-open");
      destroyCm();
      return;
    }
    if (els.code) els.code.hidden = show;
    if (els.codeSave) els.codeSave.hidden = !!show;
    if (els.layout) els.layout.classList.toggle("is-code-open", !show);
    if (document.body) document.body.classList.toggle("repo-code-open", !show);
    if (show) destroyCm();
    try {
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("tinker-repo-code-chrome", { detail: { show: !!show } }));
      }
    } catch (e) { /* ignore */ }
  }

  function stepsForExercise(exerciseId) {
    var ex = state.workspace.exercises[exerciseId];
    if (!ex) return [];
    if (state.revised[exerciseId] && state.revised[exerciseId].steps) {
      return state.revised[exerciseId].steps.slice();
    }
    if (!revision || typeof revision.findReadmeNode !== "function") return [];
    var readme = revision.findReadmeNode(ex.nodes);
    if (!readme) return [];
    if (typeof revision.extractStepsFromReadme === "function") {
      return revision.extractStepsFromReadme(readme.content || "");
    }
    return [];
  }

  function renderStepsPanel(container, exerciseId) {
    var steps = stepsForExercise(exerciseId);
    if (!steps.length) return;
    var panel = document.createElement("div");
    var updated = !!(state.revised[exerciseId] && state.revised[exerciseId].steps);
    panel.className = "repo-ex-steps" + (updated ? " is-updated" : "");
    panel.setAttribute("data-exercise-id", exerciseId);
    var label = document.createElement("p");
    label.className = "repo-ex-steps__label";
    text(label, updated ? "Updated steps" : "Steps");
    panel.appendChild(label);
    var ol = document.createElement("ol");
    ol.className = "repo-ex-steps__list";
    steps.forEach(function (step) {
      var li = document.createElement("li");
      text(li, step);
      ol.appendChild(li);
    });
    panel.appendChild(ol);
    container.appendChild(panel);
  }

  function setStepsBanner(message) {
    if (!els.stepsBanner) return;
    if (!message) {
      els.stepsBanner.hidden = true;
      text(els.stepsBanner, "");
      return;
    }
    els.stepsBanner.hidden = false;
    text(els.stepsBanner, message);
  }

  function activeFileName() {
    var tab = null;
    state.openTabs.forEach(function (t) {
      if (t.id === state.activeTabId) tab = t;
    });
    if (!tab) return "";
    var node = findNode(tab.exerciseId, tab.nodeId);
    return node && node.name ? node.name : "";
  }

  function destroyCm() {
    if (cmEditor && typeof cmEditor.destroy === "function") {
      try { cmEditor.destroy(); } catch (e) { /* ignore */ }
    }
    cmEditor = null;
    if (els.codeSurface) clear(els.codeSurface);
  }

  function ensureCm(fileName, content) {
    if (!els.codeSurface || !cmApi || typeof cmApi.create !== "function") return null;
    if (!cmEditor) {
      clear(els.codeSurface);
      cmEditor = cmApi.create(els.codeSurface, {
        fileName: fileName,
        doc: content || "",
        onChange: function () {
          state.dirty = true;
          if (els.codeEditor) els.codeEditor.value = cmEditor.getValue();
          if (els.codeStatus) {
            els.codeStatus.hidden = false;
            text(els.codeStatus, "Unsaved changes");
          }
        },
      });
    } else {
      cmEditor.setFileName(fileName);
      // Avoid clobbering in-progress typing when already focused.
      var focused = cmEditor.view && cmEditor.view.hasFocus;
      if (!focused) cmEditor.setValue(content || "");
    }
    if (els.codeEditor) els.codeEditor.value = content || "";
    if (els.code) {
      var md = cmApi.isMarkdownFile ? cmApi.isMarkdownFile(fileName) : /\.md$/i.test(fileName);
      els.code.classList.toggle("repo-code--prose", !!md);
      els.code.classList.toggle("repo-code--code", !md);
    }
    return cmEditor;
  }

  function editorContent() {
    if (cmEditor && typeof cmEditor.getValue === "function") return cmEditor.getValue();
    if (els.codeEditor) return els.codeEditor.value;
    return "";
  }

  function openFile(exerciseId, nodeId, opts) {
    opts = opts || {};
    if (!isLearningSignedIn()) {
      requestLearningSignIn();
      applyAuthGate();
      return;
    }
    // Mobile: exercise files are not editable; keep the writing surface.
    if (!isWideDesktop()) {
      state.selected = { exerciseId: exerciseId, nodeId: nodeId };
      showWritingChrome(true);
      renderExplorer();
      return;
    }
    var node = findNode(exerciseId, nodeId);
    if (!node || node.type !== "file") return;
    var id = tabId(exerciseId, nodeId);
    var existing = null;
    state.openTabs.forEach(function (tab) {
      if (tab.id === id) existing = tab;
    });
    // Practice / starter files always open blank (never pre-filled code).
    var blankPractice = !opts.keepContent
      && revision
      && typeof revision.isPracticeFile === "function"
      && revision.isPracticeFile(node);
    if (existing) {
      existing.title = node.name;
      existing.blank = !!blankPractice;
    } else {
      state.openTabs.push({
        id: id,
        exerciseId: exerciseId,
        nodeId: nodeId,
        title: node.name,
        blank: !!blankPractice,
      });
    }
    state.activeTabId = id;
    state.selected = { exerciseId: exerciseId, nodeId: nodeId };
    state.dirty = false;
    render();
    if (cmEditor && typeof cmEditor.focus === "function") {
      try { cmEditor.focus(); } catch (e) { /* ignore */ }
    }
  }

  function activateTab(id) {
    var tab = null;
    state.openTabs.forEach(function (t) {
      if (t.id === id) tab = t;
    });
    if (!tab) return;
    state.activeTabId = id;
    state.selected = { exerciseId: tab.exerciseId, nodeId: tab.nodeId };
    state.dirty = false;
    render();
  }

  function closeTab(id) {
    var next = [];
    var idx = -1;
    state.openTabs.forEach(function (t, i) {
      if (t.id === id) idx = i;
      else next.push(t);
    });
    state.openTabs = next;
    if (state.activeTabId !== id) {
      renderTabs();
      return;
    }
    var fallback = next[idx] || next[idx - 1] || next[0] || null;
    if (fallback) activateTab(fallback.id);
    else {
      state.activeTabId = null;
      state.selected = { exerciseId: state.selected.exerciseId, nodeId: null };
      if (els.tabs) {
        clear(els.tabs);
        els.tabs.hidden = true;
      }
      showWritingChrome(true);
      renderExplorer();
      renderCode();
      if (typeof state.onReleaseEditor === "function") state.onReleaseEditor();
    }
  }

  function renderTabs() {
    if (!els.tabs) return;
    if (!state.openTabs.length) {
      // Essay tabs (repo.js) may own the strip when no exercise files are open.
      return;
    }
    clear(els.tabs);
    els.tabs.hidden = false;
    state.openTabs.forEach(function (tab) {
      var tabEl = document.createElement("div");
      tabEl.className = "repo-tabs__tab" + (tab.id === state.activeTabId ? " is-active" : "");
      tabEl.setAttribute("role", "tab");
      tabEl.setAttribute("data-tab-id", tab.id);
      var labelBtn = document.createElement("button");
      labelBtn.type = "button";
      labelBtn.className = "repo-tabs__label-btn";
      var label = document.createElement("span");
      label.className = "repo-tabs__label";
      text(label, tab.title || "Untitled");
      labelBtn.appendChild(label);
      labelBtn.addEventListener("click", function () { activateTab(tab.id); });
      tabEl.appendChild(labelBtn);
      var close = document.createElement("button");
      close.type = "button";
      close.className = "repo-tabs__close";
      close.setAttribute("aria-label", "Close " + (tab.title || "tab"));
      close.textContent = "\u00d7";
      close.addEventListener("click", function (event) {
        if (event && event.stopPropagation) event.stopPropagation();
        closeTab(tab.id);
      });
      tabEl.appendChild(close);
      els.tabs.appendChild(tabEl);
    });
  }

  function renderCode() {
    if (!isWideDesktop()) {
      showWritingChrome(true);
      return;
    }
    var tab = null;
    state.openTabs.forEach(function (t) {
      if (t.id === state.activeTabId) tab = t;
    });
    if (!tab) {
      showWritingChrome(true);
      return;
    }
    var node = findNode(tab.exerciseId, tab.nodeId);
    if (!node || node.type !== "file") {
      showWritingChrome(true);
      return;
    }
    showWritingChrome(false);
    text(els.codePath, (state.workspace.exercises[tab.exerciseId] || {}).name + " / " + node.name);
    var content = tab.blank ? "" : (node.content || "");
    ensureCm(node.name, content);
    if (els.codeStatus) {
      if (state.status) {
        els.codeStatus.hidden = false;
        text(els.codeStatus, state.status);
      } else if (tab.blank) {
        els.codeStatus.hidden = false;
        text(els.codeStatus, "Practice file opens blank. Write from scratch.");
      } else if (state.dirty) {
        els.codeStatus.hidden = false;
        text(els.codeStatus, "Unsaved changes");
      } else {
        els.codeStatus.hidden = true;
        text(els.codeStatus, "");
      }
    }
  }

  function renderNodeList(container, exerciseId, parentId, depth) {
    var ex = state.workspace.exercises[exerciseId];
    if (!ex) return;
    var kids = core.childNodes(ex.nodes, parentId);
    kids.forEach(function (node) {
      var row = document.createElement("div");
      row.className = "repo-ex-node";
      row.style.paddingLeft = (8 + depth * 14) + "px";
      row.setAttribute("data-exercise-id", exerciseId);
      row.setAttribute("data-node-id", node.id);
      row.setAttribute("data-node-type", node.type);
      row.draggable = true;

      if (node.type === "folder") {
        var key = exerciseId + ":" + node.id;
        var collapsed = !!state.collapsed[key];
        var foldBtn = document.createElement("button");
        foldBtn.type = "button";
        foldBtn.className = "repo-ex-node__btn" +
          (state.selected.exerciseId === exerciseId && state.selected.nodeId === node.id ? " is-selected" : "");
        var chev = document.createElement("span");
        chev.className = "repo-explorer__chevron";
        chev.setAttribute("aria-hidden", "true");
        text(chev, collapsed ? "\u25b8" : "\u25be");
        foldBtn.appendChild(chev);
        var name = document.createElement("span");
        name.className = "repo-explorer__name";
        text(name, node.name);
        foldBtn.appendChild(name);
        foldBtn.addEventListener("click", function () {
          state.collapsed[key] = !collapsed;
          state.selected = { exerciseId: exerciseId, nodeId: node.id };
          renderExplorer();
        });
        row.appendChild(foldBtn);
      } else {
        var fileBtn = document.createElement("button");
        fileBtn.type = "button";
        fileBtn.className = "repo-ex-node__btn repo-ex-node__btn--file" +
          (state.selected.exerciseId === exerciseId && state.selected.nodeId === node.id ? " is-selected" : "");
        var fileName = document.createElement("span");
        fileName.className = "repo-explorer__name";
        text(fileName, node.name);
        fileBtn.appendChild(fileName);
        fileBtn.addEventListener("click", function () {
          openFile(exerciseId, node.id);
        });
        row.appendChild(fileBtn);
      }

      var renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "repo-ex-node__icon";
      renameBtn.title = "Rename";
      renameBtn.textContent = "\u270e";
      renameBtn.addEventListener("click", function (event) {
        if (event.stopPropagation) event.stopPropagation();
        var next = window.prompt("Rename", node.name);
        if (next == null) return;
        renameNode(exerciseId, node.id, next);
      });
      row.appendChild(renameBtn);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "repo-ex-node__icon repo-ex-node__icon--danger";
      delBtn.title = "Delete";
      delBtn.textContent = "\u00d7";
      delBtn.addEventListener("click", function (event) {
        if (event.stopPropagation) event.stopPropagation();
        requestDelete(exerciseId, node);
      });
      row.appendChild(delBtn);

      row.addEventListener("dragstart", function (event) {
        state.drag = { exerciseId: exerciseId, nodeId: node.id, type: node.type };
        try {
          event.dataTransfer.setData("text/plain", exerciseId + "|" + node.id);
          event.dataTransfer.effectAllowed = "move";
        } catch (e) { /* ignore */ }
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragend", function () {
        state.drag = null;
        row.classList.remove("is-dragging");
        var drops = els.body.querySelectorAll(".is-drop");
        for (var i = 0; i < drops.length; i += 1) drops[i].classList.remove("is-drop");
      });
      row.addEventListener("dragover", function (event) {
        if (!state.drag || state.drag.exerciseId !== exerciseId) return;
        if (node.type !== "folder" && state.drag.nodeId === node.id) return;
        event.preventDefault();
        row.classList.add("is-drop");
      });
      row.addEventListener("dragleave", function () {
        row.classList.remove("is-drop");
      });
      row.addEventListener("drop", function (event) {
        event.preventDefault();
        row.classList.remove("is-drop");
        if (!state.drag || state.drag.exerciseId !== exerciseId) return;
        var targetParent = node.type === "folder" ? node.id : node.parentId;
        moveNode(exerciseId, state.drag.nodeId, targetParent);
      });

      container.appendChild(row);
      if (node.type === "folder" && !state.collapsed[exerciseId + ":" + node.id]) {
        renderNodeList(container, exerciseId, node.id, depth + 1);
      }
    });
  }

  function startWriteAboutExercise(exerciseId) {
    if (!isLearningSignedIn()) {
      requestLearningSignIn();
      return;
    }
    var ex = state.workspace.exercises[exerciseId];
    var name = (ex && ex.name) || exerciseId;
    try {
      if (window.tinkerRepo && typeof window.tinkerRepo.startExerciseEssay === "function") {
        window.tinkerRepo.startExerciseEssay({
          exerciseId: exerciseId,
          exerciseName: name,
        });
        return;
      }
    } catch (e) { /* ignore */ }
  }

  function transformStatus(exerciseId) {
    var row = state.transform[exerciseId];
    return row && row.status ? row.status : "";
  }

  function emitTransform() {
    try {
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("tinker-exercise-transform", {
          detail: { transform: Object.assign({}, state.transform) },
        }));
      }
    } catch (e) { /* ignore */ }
    try {
      if (window.tinkerRepo && typeof window.tinkerRepo.onExerciseTransform === "function") {
        window.tinkerRepo.onExerciseTransform(state.transform);
      }
    } catch (e2) { /* ignore */ }
  }

  function setTransform(exerciseId, patch) {
    var id = String(exerciseId || "").trim();
    if (!id) return;
    var prev = state.transform[id] || {};
    if (!patch || patch.status === "done" || patch.status === "") {
      delete state.transform[id];
    } else {
      state.transform[id] = Object.assign({}, prev, patch, { exerciseId: id });
    }
    emitTransform();
  }

  function retryTransform(exerciseId) {
    var row = state.transform[exerciseId];
    if (!row || !row.essayBody) return Promise.reject(new Error("Nothing to retry."));
    return applyEssayRevision(exerciseId, row.essayBody);
  }

  function renderExplorer() {
    if (!els.body) return;
    clear(els.body);
    if (!applyAuthGate()) return;

    var order = state.workspace.exerciseOrder || [];
    if (els.empty) els.empty.hidden = order.length > 0;
    if (els.hint) {
      text(
        els.hint,
        state.localOnly
          ? "Browsing seed trees. Sign in to Tinker to save restructuring."
          : "Seeded from lindowlabs. Edits save in Tinker, not GitHub."
      );
    }

    order.forEach(function (exerciseId, index) {
      var ex = state.workspace.exercises[exerciseId];
      if (!ex) return;
      var rootKey = "ex:" + exerciseId;
      var collapsed = !!state.collapsed[rootKey];
      var group = document.createElement("div");
      group.className = "repo-explorer__group";
      group.setAttribute("data-exercise-id", exerciseId);
      group.draggable = true;

      var head = document.createElement("div");
      head.className = "repo-explorer__group-row";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "repo-explorer__group-btn" +
        (state.selected.exerciseId === exerciseId && !state.selected.nodeId ? " is-selected" : "");
      var chev = document.createElement("span");
      chev.className = "repo-explorer__chevron";
      chev.setAttribute("aria-hidden", "true");
      text(chev, collapsed ? "\u25b8" : "\u25be");
      btn.appendChild(chev);
      var name = document.createElement("span");
      name.className = "repo-explorer__name";
      text(name, ex.name || exerciseId);
      btn.appendChild(name);
      var tStatus = transformStatus(exerciseId);
      if (tStatus === "pending") {
        var spin = document.createElement("span");
        spin.className = "repo-ex-transform-spinner";
        spin.setAttribute("aria-label", "Updating exercise");
        spin.title = "Updating from essay…";
        btn.appendChild(spin);
        group.classList.add("is-transforming");
      }
      btn.addEventListener("click", function () {
        if (!isLearningSignedIn()) {
          requestLearningSignIn();
          return;
        }
        state.collapsed[rootKey] = !collapsed;
        state.selected = { exerciseId: exerciseId, nodeId: null };
        renderExplorer();
      });
      head.appendChild(btn);
      if (tStatus === "error") {
        var retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "repo-ex-transform-retry";
        retryBtn.title = "Retry exercise update";
        text(retryBtn, "Retry");
        retryBtn.addEventListener("click", function (event) {
          if (event && event.stopPropagation) event.stopPropagation();
          retryTransform(exerciseId).catch(function () { /* status */ });
        });
        head.appendChild(retryBtn);
        group.classList.add("is-transform-error");
      }

      if (index > 0) {
        var up = document.createElement("button");
        up.type = "button";
        up.className = "repo-ex-node__icon";
        up.title = "Move exercise up";
        up.textContent = "\u2191";
        up.addEventListener("click", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          reorderExercise(exerciseId, -1);
        });
        head.appendChild(up);
      }
      if (index < order.length - 1) {
        var down = document.createElement("button");
        down.type = "button";
        down.className = "repo-ex-node__icon";
        down.title = "Move exercise down";
        down.textContent = "\u2193";
        down.addEventListener("click", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          reorderExercise(exerciseId, 1);
        });
        head.appendChild(down);
      }
      group.appendChild(head);

      // Drop on exercise root moves to top-level.
      group.addEventListener("dragover", function (event) {
        if (!state.drag || state.drag.exerciseId !== exerciseId) return;
        event.preventDefault();
        group.classList.add("is-drop");
      });
      group.addEventListener("dragleave", function () {
        group.classList.remove("is-drop");
      });
      group.addEventListener("drop", function (event) {
        event.preventDefault();
        group.classList.remove("is-drop");
        if (!state.drag || state.drag.exerciseId !== exerciseId) return;
        moveNode(exerciseId, state.drag.nodeId, null);
      });

      // Reorder exercises via drag onto another exercise header.
      group.addEventListener("dragstart", function (event) {
        state.drag = { kind: "exercise", exerciseId: exerciseId };
        try {
          event.dataTransfer.setData("text/plain", "exercise|" + exerciseId);
          event.dataTransfer.effectAllowed = "move";
        } catch (e) { /* ignore */ }
      });

      // Write-about / steps / tree live under the exercise title group so they
      // never paint as an orphan block above the next titled exercise. Still
      // siblings of the title row (not inside .repo-ex-node flex rows).
      if (!collapsed) {
        var writeAbout = document.createElement("button");
        writeAbout.type = "button";
        writeAbout.className = "repo-ex-write-about";
        writeAbout.setAttribute("data-exercise-id", exerciseId);
        text(writeAbout, "Write about this exercise");
        writeAbout.addEventListener("click", function (event) {
          if (event && event.stopPropagation) event.stopPropagation();
          startWriteAboutExercise(exerciseId);
        });
        group.appendChild(writeAbout);

        renderStepsPanel(group, exerciseId);

        var list = document.createElement("div");
        list.className = "repo-ex-tree";
        list.setAttribute("data-exercise-id", exerciseId);
        renderNodeList(list, exerciseId, null, 0);
        if (!ex.nodes.length) {
          var empty = document.createElement("p");
          empty.className = "repo-ex-tree__empty";
          text(empty, "No files yet");
          list.appendChild(empty);
        }
        group.appendChild(list);
      }
      els.body.appendChild(group);
    });
  }

  function render() {
    applyAuthGate();
    if (isLearningSignedIn()) {
      renderExplorer();
      renderTabs();
      renderCode();
    } else {
      if (els.tabs) {
        clear(els.tabs);
        els.tabs.hidden = true;
      }
      if (els.code) els.code.hidden = true;
    }
  }

  function finishLocalRevision(exerciseId, result) {
    if (result && result.workspace) applyWorkspace(result.workspace);
    state.revised[exerciseId] = {
      steps: ((result && result.steps) || []).slice(),
      at: Date.now(),
    };
    state.collapsed["ex:" + exerciseId] = false;
    setTransform(exerciseId, { status: "done" });
    var n = ((result && result.steps) || []).length;
    var filesN = ((result && result.filesUpdated) || []).length;
    state.status = filesN
      ? ("Exercise updated (" + filesN + " file" + (filesN === 1 ? "" : "s") + ").")
      : ("Steps updated (" + n + ").");
    if (n) {
      setStepsBanner(
        "Updated from your essay: " +
          (result.steps || []).map(function (s, i) { return (i + 1) + ". " + s; }).join(" · ")
      );
    }
    if (isWideDesktop() && result && result.readmeNodeId) {
      openFile(exerciseId, result.readmeNodeId, { keepContent: true });
    } else {
      render();
    }
    return result || { changed: false };
  }

  function applyEssayRevision(exerciseId, essayBody) {
    if (!revision) {
      return Promise.reject(new Error("Exercise revision helper missing."));
    }
    if (!isLearningSignedIn()) {
      return Promise.reject(new Error("Sign in to revise exercises."));
    }
    var id = String(exerciseId || "").trim();
    var body = String(essayBody == null ? "" : essayBody);
    setTransform(id, { status: "pending", essayBody: body, error: "" });
    renderExplorer();

    // Signed-in + server: Claude revises README / steps / starter stubs.
    if (!state.localOnly && token()) {
      return api("POST", "revise_from_essay", {
        exerciseId: id,
        essayBody: body,
      }).then(function (json) {
        var result = {
          workspace: json.workspace,
          steps: json.steps || [],
          filesUpdated: json.filesUpdated || [],
          readmeNodeId: json.readmeNodeId || null,
          changed: !!json.changed,
        };
        return finishLocalRevision(id, result);
      }).catch(function (err) {
        setTransform(id, {
          status: "error",
          essayBody: body,
          error: (err && err.message) || "Could not update exercise.",
        });
        state.status = (err && err.message) || "Could not update exercise.";
        renderExplorer();
        throw err;
      });
    }

    // Offline / seed browse: local step rewrite only (no Claude).
    if (typeof revision.applyEssayRevision !== "function") {
      setTransform(id, { status: "error", essayBody: body, error: "Revision helper missing." });
      renderExplorer();
      return Promise.reject(new Error("Exercise revision helper missing."));
    }
    try {
      var result = revision.applyEssayRevision(state.workspace, {
        core: core,
        exerciseId: id,
        essayBody: body,
      });
      return Promise.resolve(finishLocalRevision(id, result));
    } catch (err) {
      setTransform(id, {
        status: "error",
        essayBody: body,
        error: (err && err.message) || "Could not update exercise.",
      });
      renderExplorer();
      return Promise.reject(err);
    }
  }

  function selectedParentId() {
    if (!state.selected.exerciseId) return null;
    if (!state.selected.nodeId) return null;
    var node = findNode(state.selected.exerciseId, state.selected.nodeId);
    if (!node) return null;
    return node.type === "folder" ? node.id : node.parentId;
  }

  function createNode(type) {
    var exerciseId = state.selected.exerciseId || (state.workspace.exerciseOrder || [])[0];
    if (!exerciseId) return;
    var label = type === "folder" ? "Folder name" : "File name";
    var name = window.prompt(label, type === "folder" ? "new-folder" : "untitled.ts");
    if (name == null) return;
    var parentId = selectedParentId();
    persistMutation(
      "create_node",
      { exerciseId: exerciseId, type: type, name: name, parentId: parentId, content: "" },
      function (ws) {
        return core.createNode(ws, {
          exerciseId: exerciseId,
          type: type,
          name: name,
          parentId: parentId,
          content: "",
        });
      }
    ).then(function (result) {
      if (result && result.node && result.node.type === "file") {
        openFile(exerciseId, result.node.id);
      } else {
        state.selected = { exerciseId: exerciseId, nodeId: result && result.node ? result.node.id : null };
        render();
      }
    }).catch(function () { /* status already set */ });
  }

  function renameNode(exerciseId, nodeId, name) {
    persistMutation(
      "rename_node",
      { exerciseId: exerciseId, nodeId: nodeId, name: name },
      function (ws) {
        return core.renameNode(ws, { exerciseId: exerciseId, nodeId: nodeId, name: name });
      }
    ).then(function () {
      state.openTabs.forEach(function (tab) {
        if (tab.exerciseId === exerciseId && tab.nodeId === nodeId) tab.title = name;
      });
    }).catch(function () { /* status */ });
  }

  function moveNode(exerciseId, nodeId, parentId) {
    if (nodeId === parentId) return;
    persistMutation(
      "move_node",
      { exerciseId: exerciseId, nodeId: nodeId, parentId: parentId },
      function (ws) {
        return core.moveNode(ws, { exerciseId: exerciseId, nodeId: nodeId, parentId: parentId });
      }
    ).catch(function () { /* status */ });
  }

  function requestDelete(exerciseId, node) {
    state.pendingDelete = { exerciseId: exerciseId, node: node };
    if (els.confirmHint) {
      text(
        els.confirmHint,
        node.type === "folder"
          ? ("Delete folder \"" + node.name + "\" and everything inside it?")
          : ("Delete file \"" + node.name + "\"?")
      );
    }
    if (els.confirm) els.confirm.hidden = false;
  }

  function closeConfirm() {
    state.pendingDelete = null;
    if (els.confirm) els.confirm.hidden = true;
  }

  function confirmDelete() {
    var pending = state.pendingDelete;
    if (!pending) return;
    closeConfirm();
    persistMutation(
      "delete_node",
      { exerciseId: pending.exerciseId, nodeId: pending.node.id, confirm: true },
      function (ws) {
        return core.deleteNode(ws, {
          exerciseId: pending.exerciseId,
          nodeId: pending.node.id,
          confirm: true,
        });
      }
    ).then(function () {
      var id = tabId(pending.exerciseId, pending.node.id);
      state.openTabs = state.openTabs.filter(function (t) { return t.id !== id; });
      if (state.activeTabId === id) {
        state.activeTabId = state.openTabs[0] ? state.openTabs[0].id : null;
      }
      render();
    }).catch(function () { /* status */ });
  }

  function reorderExercise(exerciseId, delta) {
    var order = (state.workspace.exerciseOrder || []).slice();
    var idx = order.indexOf(exerciseId);
    if (idx < 0) return;
    var next = idx + delta;
    if (next < 0 || next >= order.length) return;
    var tmp = order[idx];
    order[idx] = order[next];
    order[next] = tmp;
    persistMutation(
      "reorder_exercises",
      { order: order },
      function (ws) {
        return core.reorderExercises(ws, { order: order });
      }
    ).catch(function () { /* status */ });
  }

  function saveActiveFile() {
    var tab = null;
    state.openTabs.forEach(function (t) {
      if (t.id === state.activeTabId) tab = t;
    });
    if (!tab) return;
    var content = editorContent();
    persistMutation(
      "write_file",
      { exerciseId: tab.exerciseId, nodeId: tab.nodeId, content: content },
      function (ws) {
        return core.writeFile(ws, {
          exerciseId: tab.exerciseId,
          nodeId: tab.nodeId,
          content: content,
        });
      }
    ).then(function () {
      state.dirty = false;
      state.status = "Saved in Tinker.";
      renderCode();
    }).catch(function () { /* status */ });
  }

  function wire() {
    if (els.collapse) {
      els.collapse.addEventListener("click", function () {
        setExplorerOpen(false);
      });
    }
    if (els.scrim) {
      els.scrim.addEventListener("click", function () {
        setExplorerOpen(false);
      });
    }
    if (els.expand) {
      els.expand.addEventListener("click", function () {
        if (!isLearningSignedIn()) {
          requestLearningSignIn();
        }
        setExplorerOpen(true);
        render();
      });
    }
    if (els.signinBtn) {
      els.signinBtn.addEventListener("click", function (event) {
        if (event && event.preventDefault) event.preventDefault();
        requestLearningSignIn();
      });
    }
    if (els.newFile) {
      els.newFile.addEventListener("click", function () {
        if (!isLearningSignedIn()) { requestLearningSignIn(); return; }
        createNode("file");
      });
    }
    if (els.newFolder) {
      els.newFolder.addEventListener("click", function () {
        if (!isLearningSignedIn()) { requestLearningSignIn(); return; }
        createNode("folder");
      });
    }
    if (els.codeSave) els.codeSave.addEventListener("click", saveActiveFile);
    if (els.confirmDelete) els.confirmDelete.addEventListener("click", confirmDelete);
    if (els.confirmCancel) els.confirmCancel.addEventListener("click", closeConfirm);
    if (els.confirmBackdrop) els.confirmBackdrop.addEventListener("click", closeConfirm);
    if (learningAuth && typeof learningAuth.onLearningAuthChange === "function") {
      learningAuth.onLearningAuthChange(function (signedIn) {
        if (signedIn) {
          loadWorkspace().then(function () {
            applyDefaultCollapsed();
            render();
          });
        } else {
          render();
        }
      });
    }
  }

  function init(opts) {
    opts = opts || {};
    state.onReleaseEditor = typeof opts.onReleaseEditor === "function" ? opts.onReleaseEditor : null;
    bindEls();
    if (!els.body && !els.signin) return Promise.resolve();
    wire();
    applyAuthGate();
    // Desktop starts with explorer visible (unless collapsed); mobile closed.
    if (isWideDesktop()) {
      setExplorerOpen(true);
    } else {
      setExplorerOpen(false);
    }
    if (!isLearningSignedIn()) {
      render();
      return Promise.resolve(state.workspace);
    }
    return loadWorkspace().then(function () {
      applyDefaultCollapsed();
      render();
      return state.workspace;
    });
  }

  function requestEditorMeasure() {
    try {
      if (cmEditor && cmEditor.view && typeof cmEditor.view.requestMeasure === "function") {
        cmEditor.view.requestMeasure();
      }
    } catch (e) { /* ignore */ }
  }

  window.tinkerExerciseWorkspaceUi = {
    init: init,
    render: render,
    getWorkspace: function () { return core.presentWorkspace(state.workspace); },
    getOpenTabs: function () { return state.openTabs.slice(); },
    openFile: openFile,
    moveNode: moveNode,
    createNode: createNode,
    requestEditorMeasure: requestEditorMeasure,
    toggleExplorer: toggleExplorer,
    setExplorerOpen: setExplorerOpen,
    applyEssayRevision: applyEssayRevision,
    retryTransform: retryTransform,
    transformStatus: transformStatus,
    getTransform: function () { return Object.assign({}, state.transform); },
    startWriteAboutExercise: startWriteAboutExercise,
    isLearningSignedIn: isLearningSignedIn,
    applyAuthGate: applyAuthGate,
    // test helpers
    _setWorkspace: function (ws) {
      applyWorkspace(ws);
      state.localOnly = true;
      render();
    },
    _state: state,
  };
})();
