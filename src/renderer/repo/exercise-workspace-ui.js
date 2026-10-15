/* Exercise explorer for per-owner exercise file trees.
 *
 * Seeds from /lib/exercise-workspace-seed.json + manifest. Tinker owners
 * sync through /api/exercise-workspace. GitHub is never written (per-user
 * TinkerUserData only; desktop clones/pulls lindowlabs for Open in IDE).
 *
 * Essay → Claude revise_from_essay updates README / steps / starter stubs.
 * Transform status (pending / error) shows a spinner or retry on the tree.
 *
 * That's everything evaluates the open practice answer with Claude Opus,
 * shows short feedback, and proposes a next-step README accept/reject diff.
 *
 * Lindow Labs Learning sign-in gates listing and reading exercise files.
 * Mobile browses saved files in a read-only reader; desktop keeps editing.
 */
(function () {
  "use strict";

  var core = window.tinkerExerciseWorkspaceCore;
  var manifest = window.tinkerExercisesManifest;
  var cmApi = window.tinkerCodeMirror;
  var learningAuth = window.tinkerLearningAuth || null;
  var revision = window.tinkerExerciseRevision || null;
  var refactorApi = window.tinkerExerciseRefactor || null;
  var evaluateApi = window.tinkerExerciseEvaluate || null;
  var models = window.tinkerClaudeModels || null;
  var structuredApi = window.tinkerClaudeStructured || null;
  if (!core) return;
  var cmEditor = null;
  var refactorProposal = null;
  var refactorBusy = false;
  var evaluateProposal = null;
  var evaluateBusy = false;
  var selectionSyncTimer = null;

  var TOKEN_KEY = "tinker_jwt";
  var seedWorkspaceCache = null;
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
    mobileFile: null,
    readerBackPending: false,
    queuedMobileFile: null,
    loading: false,
    loadError: "",
    loadVersion: 0,
    readerSession: Math.random().toString(36),
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
      reader: $("repo-ex-reader"),
      readerBack: $("repo-ex-reader-back"),
      readerPath: $("repo-ex-reader-path"),
      readerContent: $("repo-ex-reader-content"),
      loadStatus: $("repo-ex-load-status"),
      loadRetry: $("repo-ex-load-retry"),
      toolbar: $("repo-explorer-toolbar"),
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
      codePreview: $("repo-code-preview"),
      codeSurface: $("repo-code-surface"),
      codeEditor: $("repo-code-editor"),
      codeSave: $("repo-code-save"),
      codeThatsEverything: $("repo-code-thats-everything"),
      codeEvaluatePanel: $("repo-code-evaluate-panel"),
      codeEvaluateFeedback: $("repo-code-evaluate-feedback"),
      codeEvaluateStatus: $("repo-code-evaluate-status"),
      codeEvaluateDiff: $("repo-code-evaluate-diff"),
      codeEvaluateSummary: $("repo-code-evaluate-summary"),
      codeEvaluatePath: $("repo-code-evaluate-path"),
      codeEvaluateBefore: $("repo-code-evaluate-before"),
      codeEvaluateAfter: $("repo-code-evaluate-after"),
      codeEvaluateAccept: $("repo-code-evaluate-accept"),
      codeEvaluateReject: $("repo-code-evaluate-reject"),
      codeRefactor: $("repo-code-refactor"),
      codeRefactorPanel: $("repo-code-refactor-panel"),
      codeRefactorInput: $("repo-code-refactor-input"),
      codeRefactorAsk: $("repo-code-refactor-ask"),
      codeRefactorCancel: $("repo-code-refactor-cancel"),
      codeRefactorStatus: $("repo-code-refactor-status"),
      codeRefactorDiff: $("repo-code-refactor-diff"),
      codeRefactorSummary: $("repo-code-refactor-summary"),
      codeRefactorBefore: $("repo-code-refactor-before"),
      codeRefactorAfter: $("repo-code-refactor-after"),
      codeRefactorAccept: $("repo-code-refactor-accept"),
      codeRefactorReject: $("repo-code-refactor-reject"),
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
      state.mobileFile = null;
      state.queuedMobileFile = null;
      state.workspace = core.emptyWorkspace();
      state.loadVersion += 1;
      state.readerSession = Math.random().toString(36);
      state.loading = false;
      if (els.reader) els.reader.hidden = true;
      text(els.readerContent, "");
      text(els.readerPath, "");
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
      if (!isWideDesktop() && window.tinkerRepo && typeof window.tinkerRepo.setEssaysSidebar === "function") {
        window.tinkerRepo.setEssaysSidebar(false);
      }
      els.layout.classList.remove("is-explorer-collapsed");
      els.layout.classList.add("is-explorer-open");
      if (els.expand) els.expand.hidden = true;
      // Scrim is CSS-shown only under max-width 800px; keep markup in sync.
      if (els.scrim) els.scrim.hidden = !!isWideDesktop();
    } else {
      state.queuedMobileFile = null;
      els.layout.classList.add("is-explorer-collapsed");
      els.layout.classList.remove("is-explorer-open");
      if (els.expand) els.expand.hidden = false;
      if (els.scrim) els.scrim.hidden = true;
      if (state.mobileFile) backToExerciseFiles();
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
    if (method !== "GET" && !isWideDesktop()) return Promise.reject(new Error("Exercises are read-only on mobile."));
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

  function cacheSeedWorkspace(seedJson) {
    seedWorkspaceCache = core.buildSeedWorkspace(
      seedJson,
      (manifest && manifest.modules) || []
    );
    return seedWorkspaceCache;
  }

  function ensureSeedWorkspace() {
    if (seedWorkspaceCache) return Promise.resolve(seedWorkspaceCache);
    return fetch("/lib/exercise-workspace-seed.json").then(function (res) {
      if (!res.ok) throw new Error("Could not load exercise templates.");
      return res.json();
    }).then(cacheSeedWorkspace);
  }

  function applyWorkspace(ws) {
    var keepIds = null;
    if (manifest && Array.isArray(manifest.modules)) {
      keepIds = manifest.modules.map(function (m) { return m && m.id; }).filter(Boolean);
    }
    var pruned = core.pruneRetiredCurriculum(ws, keepIds ? { keepIds: keepIds } : {});
    var nextWs = pruned.workspace;
    // Belt-and-suspenders with the API store: scrub rides trees using the
    // payments seed bundled into this desktop/web build.
    if (seedWorkspaceCache && typeof core.refreshStaleCurriculum === "function") {
      nextWs = core.refreshStaleCurriculum(nextWs, seedWorkspaceCache).workspace;
    }
    state.workspace = nextWs;
    if (
      state.selected &&
      state.selected.exerciseId &&
      !state.workspace.exercises[state.selected.exerciseId]
    ) {
      state.selected = { exerciseId: null, nodeId: null };
    } else if (
      state.selected &&
      state.selected.exerciseId &&
      state.selected.nodeId &&
      !core.nodeById(
        state.workspace.exercises[state.selected.exerciseId].nodes,
        state.selected.nodeId
      )
    ) {
      state.selected = { exerciseId: state.selected.exerciseId, nodeId: null };
    }
  }

  function loadWorkspace() {
    var version = ++state.loadVersion;
    var ownerToken = token();
    state.readerSession = Math.random().toString(36);
    state.loading = true;
    state.loadError = "";
    render();
    // Signed-in: hit the API first. Server refreshStaleCurriculum already
    // rewrites rides trees. After the list returns on desktop, load the
    // bundled seed and re-apply so a stale blob can be scrubbed client-side.
    var request = ownerToken
      ? api("GET", isWideDesktop() ? "list" : "read")
      : ensureSeedWorkspace().then(function (seedWs) {
        return { workspace: seedWs };
      });
    return request.then(function (json) {
      // A late response must never restore a previous owner's learning modules.
      if (version !== state.loadVersion || token() !== ownerToken || !isLearningSignedIn()) return;
      applyWorkspace(json.workspace || json);
      state.localOnly = !ownerToken;
      if (!ownerToken || !isWideDesktop() || seedWorkspaceCache) return;
      return ensureSeedWorkspace().then(function () {
        if (version !== state.loadVersion || token() !== ownerToken || !isLearningSignedIn()) return;
        applyWorkspace(state.workspace);
        render();
      }).catch(function () { /* seed scrub is optional; API already refreshed */ });
    }).catch(function (err) {
      if (version !== state.loadVersion || token() !== ownerToken) return;
      // Preserve desktop's existing offline template fallback.
      if (isWideDesktop()) {
        return ensureSeedWorkspace().then(function (seedWs) {
          if (version !== state.loadVersion || token() !== ownerToken || !isLearningSignedIn()) return;
          applyWorkspace(seedWs);
          state.localOnly = true;
        }).catch(function () { state.loadError = "Could not load exercises. Try again."; });
      }
      state.workspace = core.emptyWorkspace();
      state.mobileFile = null;
      state.loadError = err.status === 401 || err.status === 403
        ? "Session expired. Sign in again to read exercises."
        : "Could not load exercises. Check your connection and try again.";
    }).then(function () {
      if (version !== state.loadVersion) return;
      state.loading = false;
      applyDefaultCollapsed();
      render();
      return state.workspace;
    });
  }

  function persistMutation(action, body, localMutator) {
    if (!isWideDesktop() || !isLearningSignedIn()) return Promise.reject(new Error("Exercises are read-only on mobile."));
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

  function isMarkdownFileName(name) {
    return /\.md$/i.test(String(name || ""));
  }

  /** Sanitize + render markdown (markdown-it + DOMPurify via essay-read). */
  function renderMarkdownHtml(raw) {
    var essayRead = window.tinkerEssayRead;
    if (essayRead && typeof essayRead.renderMarkdown === "function") {
      return essayRead.renderMarkdown(raw);
    }
    if (essayRead && typeof essayRead.sanitize === "function" && window.markdownit) {
      return essayRead.sanitize(window.markdownit({ html: false, linkify: true }).render(raw));
    }
    return "";
  }

  function fillMarkdownElement(el, raw) {
    if (!el) return;
    var html = renderMarkdownHtml(raw);
    if (html) {
      el.innerHTML = html;
    } else {
      // Fallback: never execute markup; show source as plain text.
      text(el, raw);
    }
  }

  /** Lesson step README on desktop: rendered preview, not CodeMirror. */
  function isDesktopStepPreview(exerciseId, nodeId) {
    if (!isWideDesktop()) return false;
    var node = findNode(exerciseId, nodeId);
    if (!node || node.type !== "file" || !isMarkdownFileName(node.name)) return false;
    var pres = presentationForNode(exerciseId, nodeId);
    return !!(pres && pres.kind === "step");
  }

  function clearDesktopStepPreview() {
    if (els.codePreview) {
      els.codePreview.hidden = true;
      els.codePreview.classList.remove("is-markdown");
      els.codePreview.innerHTML = "";
    }
    if (els.codeSurface) els.codeSurface.hidden = false;
    if (els.code) els.code.classList.remove("repo-code--preview");
  }

  function showDesktopStepPreview(raw) {
    destroyCm();
    if (els.codeSurface) els.codeSurface.hidden = true;
    if (els.codePreview) {
      els.codePreview.hidden = false;
      els.codePreview.classList.add("is-markdown");
      fillMarkdownElement(els.codePreview, raw || "This learning module is empty.");
      try { els.codePreview.scrollTop = 0; } catch (e) { /* ignore */ }
    }
    if (els.codeSave) els.codeSave.hidden = true;
    if (els.codeThatsEverything) els.codeThatsEverything.hidden = true;
    if (els.codeRefactor) els.codeRefactor.hidden = true;
    clearEvaluateUi();
    clearRefactorUi();
    if (els.code) {
      els.code.classList.add("repo-code--preview");
      els.code.classList.remove("repo-code--prose", "repo-code--code");
    }
    if (els.codeStatus) {
      els.codeStatus.hidden = true;
      text(els.codeStatus, "");
    }
  }

  function renderMobileReader() {
    var selection = state.mobileFile;
    var node = selection && findNode(selection.exerciseId, selection.nodeId);
    var visible = !isWideDesktop() && isLearningSignedIn() && node && node.type === "file";
    if (els.reader) els.reader.hidden = !visible;
    if (els.body) els.body.hidden = !!visible;
    if (!visible) {
      text(els.readerContent, "");
      text(els.readerPath, "");
      if (els.readerContent) els.readerContent.classList.remove("is-markdown");
      return;
    }
    var pres = presentationForNode(selection.exerciseId, selection.nodeId);
    text(els.readerPath, pres.pathLabel);
    var raw = node.content || "This learning module is empty.";
    var asMarkdown = isMarkdownFileName(node.name);
    if (els.readerContent) els.readerContent.classList.toggle("is-markdown", asMarkdown);
    if (asMarkdown) {
      fillMarkdownElement(els.readerContent, raw);
    } else {
      // Non-md stays monospace plain text (no HTML execution).
      text(els.readerContent, raw);
    }
  }

  function focusSelectedFile() {
    if (!els.body) return;
    var answerBtn = els.body.querySelector(".repo-ex-step__answer-btn.is-selected");
    if (answerBtn) {
      answerBtn.focus();
      return;
    }
    var stepBtn = els.body.querySelector(".repo-ex-step__btn.is-selected");
    if (stepBtn) {
      stepBtn.focus();
      return;
    }
    var rows = els.body.querySelectorAll(".repo-ex-node");
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].getAttribute("data-exercise-id") === state.selected.exerciseId &&
          rows[i].getAttribute("data-node-id") === state.selected.nodeId) {
        var button = rows[i].querySelector("button");
        if (button) button.focus();
        return;
      }
    }
    if (state.selected.exerciseId) {
      var moduleBtn = els.body.querySelector(
        '.repo-ex-module[data-exercise-id="' + state.selected.exerciseId + '"] .repo-ex-module__btn'
      );
      if (moduleBtn) {
        moduleBtn.focus();
        return;
      }
    }
  }

  function backToExerciseFiles() {
    state.mobileFile = null;
    render();
    focusSelectedFile();
    if (window.history && window.history.state && window.history.state.tinkerExerciseReader) {
      state.readerBackPending = true;
      window.history.back();
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
      if (els.codeThatsEverything) els.codeThatsEverything.hidden = true;
      if (els.codeEvaluatePanel) els.codeEvaluatePanel.hidden = true;
      if (els.codeRefactor) els.codeRefactor.hidden = true;
      if (els.codeRefactorPanel) els.codeRefactorPanel.hidden = true;
      if (els.layout) els.layout.classList.remove("is-code-open");
      if (document.body) document.body.classList.remove("repo-code-open");
      clearEvaluateUi();
      clearRefactorUi();
      clearDesktopStepPreview();
      destroyCm();
      return;
    }
    if (els.code) els.code.hidden = show;
    if (els.codeSave) els.codeSave.hidden = !!show;
    if (els.codeThatsEverything) els.codeThatsEverything.hidden = !!show;
    if (els.codeRefactor) els.codeRefactor.hidden = !!show;
    if (show) {
      clearEvaluateUi();
      clearRefactorUi();
      clearDesktopStepPreview();
      destroyCm();
    }
    if (els.layout) els.layout.classList.toggle("is-code-open", !show);
    if (document.body) document.body.classList.toggle("repo-code-open", !show);
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

  function resolveClaudeApi() {
    if (window.tinker && typeof window.tinker.callClaude === "function") return window.tinker;
    if (window.tinkerApi && typeof window.tinkerApi.callClaude === "function") return window.tinkerApi;
    return null;
  }

  function clearRefactorUi() {
    refactorProposal = null;
    refactorBusy = false;
    if (els.codeRefactorPanel) els.codeRefactorPanel.hidden = true;
    if (els.codeRefactorDiff) els.codeRefactorDiff.hidden = true;
    if (els.codeRefactorStatus) {
      els.codeRefactorStatus.hidden = true;
      text(els.codeRefactorStatus, "");
    }
    if (els.codeRefactorInput) els.codeRefactorInput.value = "";
    if (els.codeRefactorBefore) text(els.codeRefactorBefore, "");
    if (els.codeRefactorAfter) text(els.codeRefactorAfter, "");
    if (els.codeRefactorSummary) text(els.codeRefactorSummary, "");
  }

  function clearEvaluateUi() {
    evaluateProposal = null;
    evaluateBusy = false;
    if (els.codeEvaluatePanel) els.codeEvaluatePanel.hidden = true;
    if (els.codeEvaluateDiff) els.codeEvaluateDiff.hidden = true;
    if (els.codeEvaluateStatus) {
      els.codeEvaluateStatus.hidden = true;
      text(els.codeEvaluateStatus, "");
    }
    if (els.codeEvaluateFeedback) text(els.codeEvaluateFeedback, "");
    if (els.codeEvaluateBefore) text(els.codeEvaluateBefore, "");
    if (els.codeEvaluateAfter) text(els.codeEvaluateAfter, "");
    if (els.codeEvaluateSummary) text(els.codeEvaluateSummary, "");
    if (els.codeEvaluatePath) text(els.codeEvaluatePath, "");
    if (els.codeThatsEverything) els.codeThatsEverything.disabled = false;
  }

  function setEvaluateStatus(message) {
    if (!els.codeEvaluateStatus) return;
    if (!message) {
      els.codeEvaluateStatus.hidden = true;
      text(els.codeEvaluateStatus, "");
      return;
    }
    els.codeEvaluateStatus.hidden = false;
    text(els.codeEvaluateStatus, message);
  }

  function activeTab() {
    var tab = null;
    state.openTabs.forEach(function (t) {
      if (t.id === state.activeTabId) tab = t;
    });
    return tab;
  }

  function activeFilePath() {
    var tab = activeTab();
    if (!tab || !revision || typeof revision.nodeRelPath !== "function") {
      return activeFileName();
    }
    var ex = state.workspace.exercises[tab.exerciseId];
    if (!ex) return activeFileName();
    return revision.nodeRelPath(ex.nodes, tab.nodeId) || activeFileName();
  }

  function stepsJsonForExercise(exerciseId) {
    var ex = state.workspace.exercises[exerciseId];
    if (!ex || !revision || typeof revision.findNodeByPath !== "function") return null;
    var node = revision.findNodeByPath(ex.nodes, "steps.json");
    if (!node) return null;
    return evaluateApi && typeof evaluateApi.parseStepsJson === "function"
      ? evaluateApi.parseStepsJson(node.content || "")
      : null;
  }

  function readmeContentForPath(exerciseId, relPath) {
    var ex = state.workspace.exercises[exerciseId];
    if (!ex || !revision || typeof revision.findNodeByPath !== "function") return "";
    var node = revision.findNodeByPath(ex.nodes, relPath);
    return node && node.content != null ? String(node.content) : "";
  }

  function deriveStepsFromFolders(exerciseId) {
    var ex = state.workspace.exercises[exerciseId];
    if (!ex || !core || typeof core.childNodes !== "function") return [];
    return core.childNodes(ex.nodes, null)
      .filter(function (node) {
        if (!node || node.type !== "folder") return false;
        var name = String(node.name || "");
        if (!/^\d{2}/.test(name)) return false;
        if (/^(solutions|scripts|extras)$/i.test(name)) return false;
        return true;
      })
      .map(function (folder) {
        var name = String(folder.name || "");
        var idMatch = name.match(/^(\d{2})/);
        return {
          id: idMatch ? idMatch[1] : "",
          folder: name,
          title: name.replace(/^\d{2}-?/, "").replace(/-/g, " "),
          goal: "",
          check: null,
        };
      });
  }

  /** Curriculum steps from steps.json (presentation; storage paths unchanged). */
  function curriculumSteps(exerciseId) {
    if (evaluateApi && typeof evaluateApi.listSteps === "function") {
      var listed = evaluateApi.listSteps(stepsJsonForExercise(exerciseId));
      if (listed && listed.length) return listed;
    }
    return deriveStepsFromFolders(exerciseId);
  }

  function stepProgressLabel(step) {
    if (!step) return "Step";
    var id = String(step.id || "").trim();
    var title = String(step.title || "").trim();
    if (!title && step.folder) {
      title = String(step.folder)
        .replace(/^\d{2}-/, "")
        .replace(/-/g, " ");
    }
    // "00 In plain English" - id + title, no folder slug / extension.
    if (id && title) {
      var titleStartsWithId = title === id || title.indexOf(id + " ") === 0 || title.indexOf(id + ":") === 0;
      return titleStartsWithId ? title.replace(/^(\d+)\s*:\s*/, "$1 ") : (id + " " + title);
    }
    return title || id || "Step";
  }

  function answerNodeForStep(exerciseId, step) {
    var ex = state.workspace.exercises[exerciseId];
    if (!ex || !step || !step.folder || !revision || typeof revision.findNodeByPath !== "function") {
      return null;
    }
    var folder = String(step.folder).replace(/^\/+|\/+$/g, "");
    var candidates = [
      folder + "/api.md",
      folder + "/openapi.yaml",
      folder + "/openapi.yml",
      folder + "/practice.js",
      folder + "/practice.ts",
      folder + "/practice.md",
    ];
    var i;
    for (i = 0; i < candidates.length; i += 1) {
      var hit = revision.findNodeByPath(ex.nodes, candidates[i]);
      if (hit) return hit;
    }
    // First non-README file whose path sits in this step folder.
    for (i = 0; i < ex.nodes.length; i += 1) {
      var node = ex.nodes[i];
      if (!node || node.type !== "file") continue;
      if (/^readme\.md$/i.test(node.name)) continue;
      var rel = typeof revision.nodeRelPath === "function"
        ? revision.nodeRelPath(ex.nodes, node.id)
        : "";
      if (!rel) continue;
      if (rel === folder || rel.indexOf(folder + "/") === 0) {
        if (rel.indexOf("/solutions/") !== -1 || rel.indexOf("solutions/") === 0) continue;
        return node;
      }
    }
    return null;
  }

  function readmeNodeForStep(exerciseId, step) {
    var ex = state.workspace.exercises[exerciseId];
    if (!ex || !step || !step.folder || !revision || typeof revision.findNodeByPath !== "function") {
      return null;
    }
    var path = evaluateApi && typeof evaluateApi.readmePathForStep === "function"
      ? evaluateApi.readmePathForStep(step)
      : (String(step.folder).replace(/^\/+|\/+$/g, "") + "/README.md");
    return path ? revision.findNodeByPath(ex.nodes, path) : null;
  }

  function findStepForPath(steps, filePath) {
    if (evaluateApi && typeof evaluateApi.findCurrentStep === "function") {
      return evaluateApi.findCurrentStep(steps, filePath);
    }
    var path = String(filePath || "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\\/g, "/");
    if (!path) return { index: -1, step: null };
    var best = { index: -1, step: null, len: -1 };
    var list = Array.isArray(steps) ? steps : [];
    for (var i = 0; i < list.length; i += 1) {
      var folder = list[i] && list[i].folder;
      if (!folder) continue;
      if (path === folder || path.indexOf(folder + "/") === 0) {
        if (folder.length > best.len) {
          best = { index: i, step: list[i], len: folder.length };
        }
      }
    }
    return { index: best.index, step: best.step };
  }

  function currentCurriculumIndex(exerciseId) {
    var steps = curriculumSteps(exerciseId);
    if (!steps.length) return -1;
    var path = "";
    if (state.selected.exerciseId === exerciseId && state.selected.nodeId && revision &&
        typeof revision.nodeRelPath === "function") {
      var ex = state.workspace.exercises[exerciseId];
      if (ex) path = revision.nodeRelPath(ex.nodes, state.selected.nodeId) || "";
    }
    if (path) {
      var found = findStepForPath(steps, path);
      if (found && found.index >= 0) return found.index;
    }
    return 0;
  }

  function stepStateAt(index, currentIndex) {
    if (currentIndex < 0) return "next";
    if (index < currentIndex) return "done";
    if (index === currentIndex) return "current";
    return "next";
  }

  function presentationForNode(exerciseId, nodeId) {
    var ex = state.workspace.exercises[exerciseId];
    var node = findNode(exerciseId, nodeId);
    var fallback = node && node.name ? String(node.name) : "Untitled";
    if (!ex || !node || !revision || typeof revision.nodeRelPath !== "function") {
      return { title: fallback, pathLabel: fallback, kind: "file" };
    }
    var rel = revision.nodeRelPath(ex.nodes, nodeId) || fallback;
    var steps = curriculumSteps(exerciseId);
    if (!steps.length) {
      return { title: fallback, pathLabel: (ex.name || exerciseId) + " / " + fallback, kind: "file" };
    }
    var found = findStepForPath(steps, rel);
    if (!found || !found.step) {
      if (/^readme\.md$/i.test(fallback) || /^worksheet\.md$/i.test(fallback) || /^steps\.json$/i.test(fallback)) {
        return {
          title: ex.name || exerciseId,
          pathLabel: ex.name || exerciseId,
          kind: "meta",
        };
      }
      return { title: fallback, pathLabel: (ex.name || exerciseId) + " / " + fallback, kind: "file" };
    }
    var label = stepProgressLabel(found.step);
    var answer = answerNodeForStep(exerciseId, found.step);
    if (answer && answer.id === nodeId) {
      return {
        title: "Your answer",
        pathLabel: (ex.name || exerciseId) + " / " + label + " / Your answer",
        kind: "answer",
        step: found.step,
      };
    }
    return {
      title: label,
      pathLabel: (ex.name || exerciseId) + " / " + label,
      kind: "step",
      step: found.step,
    };
  }

  function openStepContent(exerciseId, step) {
    var readme = readmeNodeForStep(exerciseId, step);
    if (readme) {
      openFile(exerciseId, readme.id);
      return;
    }
    var answer = answerNodeForStep(exerciseId, step);
    if (answer) openFile(exerciseId, answer.id);
  }

  function openStepAnswer(exerciseId, step) {
    var answer = answerNodeForStep(exerciseId, step);
    if (answer) openFile(exerciseId, answer.id);
  }

  function renderModuleProgress(container, exerciseId) {
    var steps = curriculumSteps(exerciseId);
    var currentIndex = currentCurriculumIndex(exerciseId);
    var progress = document.createElement("div");
    progress.className = "repo-ex-module__progress";
    progress.setAttribute("data-exercise-id", exerciseId);

    if (!steps.length) {
      // Custom / empty modules: no fake file tree and no "steps" chrome.
      return;
    }

    steps.forEach(function (step, index) {
      var stateName = stepStateAt(index, currentIndex);
      var row = document.createElement("div");
      row.className = "repo-ex-step is-" + stateName;
      row.setAttribute("data-step-id", step.id || String(index));
      row.setAttribute("data-step-folder", step.folder || "");

      var stepBtn = document.createElement("button");
      stepBtn.type = "button";
      stepBtn.className = "repo-ex-step__btn" + (stateName === "current" ? " is-selected" : "");
      var mark = document.createElement("span");
      mark.className = "repo-ex-step__mark";
      mark.setAttribute("aria-hidden", "true");
      if (stateName === "done") {
        text(mark, "\u2713");
      } else {
        var idText = String(step.id != null && step.id !== "" ? step.id : index);
        if (/^\d+$/.test(idText) && idText.length < 2) {
          idText = ("0" + idText).slice(-2);
        }
        text(mark, idText);
      }
      stepBtn.appendChild(mark);
      var label = document.createElement("span");
      label.className = "repo-ex-step__label";
      // Title only in the main label when mark already shows the id.
      var titleOnly = String(step.title || "").trim();
      if (!titleOnly && step.folder) {
        titleOnly = String(step.folder).replace(/^\d{2}-/, "").replace(/-/g, " ");
      }
      text(label, titleOnly || stepProgressLabel(step));
      stepBtn.appendChild(label);
      var stateHint = document.createElement("span");
      stateHint.className = "repo-ex-step__state";
      text(stateHint, stateName === "done" ? "Done" : stateName === "current" ? "Current" : "Next");
      stepBtn.appendChild(stateHint);
      stepBtn.addEventListener("click", function () {
        if (!isLearningSignedIn()) {
          requestLearningSignIn();
          return;
        }
        openStepContent(exerciseId, step);
      });
      row.appendChild(stepBtn);

      if (stateName === "current") {
        var answer = answerNodeForStep(exerciseId, step);
        if (answer) {
          var answerRow = document.createElement("div");
          answerRow.className = "repo-ex-step__answer";
          var answerBtn = document.createElement("button");
          answerBtn.type = "button";
          answerBtn.className = "repo-ex-step__answer-btn" +
            (state.selected.exerciseId === exerciseId && state.selected.nodeId === answer.id
              ? " is-selected"
              : "");
          text(answerBtn, "Your answer");
          answerBtn.addEventListener("click", function (event) {
            if (event && event.stopPropagation) event.stopPropagation();
            if (!isLearningSignedIn()) {
              requestLearningSignIn();
              return;
            }
            openStepAnswer(exerciseId, step);
          });
          answerRow.appendChild(answerBtn);
          row.appendChild(answerRow);
        }
      }

      progress.appendChild(row);
    });
    container.appendChild(progress);
  }

  function renderUpcomingModulePlaceholders(container) {
    var placeholder = document.createElement("div");
    placeholder.className = "repo-ex-module-placeholder";
    placeholder.setAttribute("aria-disabled", "true");
    var title = document.createElement("p");
    title.className = "repo-ex-module-placeholder__title";
    text(title, "Next module");
    placeholder.appendChild(title);
    var copy = document.createElement("p");
    copy.className = "repo-ex-module-placeholder__copy";
    text(copy, "Generated after you finish this one");
    placeholder.appendChild(copy);
    container.appendChild(placeholder);
  }

  function setRefactorStatus(message) {
    if (!els.codeRefactorStatus) return;
    if (!message) {
      els.codeRefactorStatus.hidden = true;
      text(els.codeRefactorStatus, "");
      return;
    }
    els.codeRefactorStatus.hidden = false;
    text(els.codeRefactorStatus, message);
  }

  function selectionForRefactor() {
    var view = cmEditor && cmEditor.view;
    if (!view || !view.state) return null;
    var main = view.state.selection.main;
    var from = main.from;
    var to = main.to;
    if (from !== to) {
      return {
        from: from,
        to: to,
        empty: false,
        text: view.state.doc.sliceString(from, to),
      };
    }
    // No highlight: use the current line so a step under the cursor still works.
    var line = view.state.doc.lineAt(from);
    var lineText = String(line.text || "");
    if (!lineText.trim()) return null;
    return {
      from: line.from,
      to: line.to,
      empty: false,
      text: lineText,
    };
  }

  function replaceEditorRange(from, to, text) {
    if (cmEditor && typeof cmEditor.replaceRange === "function") {
      cmEditor.replaceRange(from, to, text);
      return true;
    }
    var view = cmEditor && cmEditor.view;
    if (!view) return false;
    var docLen = view.state.doc.length;
    var start = Math.max(0, Math.min(Number(from) || 0, docLen));
    var end = Math.max(start, Math.min(Number(to) || 0, docLen));
    var insert = text == null ? "" : String(text);
    view.dispatch({
      changes: { from: start, to: end, insert: insert },
      selection: { anchor: start, head: start + insert.length },
    });
    return true;
  }

  function openRefactorPanel() {
    if (!isWideDesktop() || !isLearningSignedIn()) return;
    var sel = selectionForRefactor();
    if (!sel || !sel.text) {
      setRefactorStatus("Select text or a step in the open file first.");
      if (els.codeRefactorPanel) els.codeRefactorPanel.hidden = false;
      return;
    }
    if (els.codeRefactorPanel) els.codeRefactorPanel.hidden = false;
    if (els.codeRefactorDiff) els.codeRefactorDiff.hidden = true;
    setRefactorStatus("Selected " + sel.text.length + " characters. Say what to change.");
    if (els.codeRefactorInput) {
      els.codeRefactorInput.focus();
      try { els.codeRefactorInput.select(); } catch (e) { /* ignore */ }
    }
  }

  function askRefactor() {
    if (refactorBusy) return;
    if (!refactorApi || typeof refactorApi.buildRefactorUserMessage !== "function") {
      setRefactorStatus("Refactor helper missing.");
      return;
    }
    var api = resolveClaudeApi();
    if (!api) {
      setRefactorStatus("Sign in to refactor with Claude.");
      return;
    }
    var sel = selectionForRefactor();
    if (!sel || !sel.text) {
      setRefactorStatus("Select text or a step in the open file first.");
      return;
    }
    var instruction = els.codeRefactorInput ? String(els.codeRefactorInput.value || "").trim() : "";
    if (!instruction) {
      setRefactorStatus("Say what should change.");
      return;
    }
    var full = editorContent();
    var beforeContext = full.slice(Math.max(0, sel.from - 1200), sel.from);
    var afterContext = full.slice(sel.to, Math.min(full.length, sel.to + 1200));
    var fileName = activeFileName();
    var userMessage;
    try {
      userMessage = refactorApi.buildRefactorUserMessage({
        fileName: fileName,
        instruction: instruction,
        selectedText: sel.text,
        beforeContext: beforeContext,
        afterContext: afterContext,
      });
    } catch (err) {
      setRefactorStatus((err && err.message) || "Could not build refactor request.");
      return;
    }
    var model =
      (refactorApi && refactorApi.MODEL) ||
      (models && models.EXERCISE_REFACTOR) ||
      "claude-opus-5-5";
    refactorBusy = true;
    refactorProposal = null;
    if (els.codeRefactorDiff) els.codeRefactorDiff.hidden = true;
    setRefactorStatus("Asking Claude…");
    if (els.codeRefactorAsk) els.codeRefactorAsk.disabled = true;
    var schema =
      (refactorApi && refactorApi.REPLY_SCHEMA) ||
      (structuredApi && structuredApi.REFACTOR_SCHEMA);
    var runCall =
      structuredApi && typeof structuredApi.runStructuredJsonCall === "function"
        ? structuredApi.runStructuredJsonCall({
            callFn: function (payload) {
              return api.callClaude(payload);
            },
            system: refactorApi.SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
            model: model,
            maxTokens: 16000,
            effort: "low",
            schema: schema,
            toolName:
              (refactorApi && refactorApi.TOOL_NAME) || "submit_exercise_refactor",
            validate: function (payload) {
              return refactorApi.parseRefactorReply(payload);
            },
            friendlyError:
              (structuredApi && structuredApi.FRIENDLY_ERROR) ||
              "Claude's reply came back in a shape we couldn't use. Try again.",
          })
        : api
            .callClaude({
              system: refactorApi.SYSTEM_PROMPT,
              messages: [{ role: "user", content: userMessage }],
              model: model,
              maxTokens: 16000,
            })
            .then(function (result) {
              return {
                value: refactorApi.parseRefactorReply(result && result.text),
              };
            });
    runCall
      .then(function (out) {
        var parsed = out && out.value ? out.value : out;
        refactorProposal = {
          from: sel.from,
          to: sel.to,
          before: sel.text,
          after: parsed.replacement,
          summary: parsed.summary,
        };
        text(els.codeRefactorSummary, parsed.summary || "Proposed refactor");
        text(els.codeRefactorBefore, sel.text);
        text(els.codeRefactorAfter, parsed.replacement);
        if (els.codeRefactorDiff) els.codeRefactorDiff.hidden = false;
        setRefactorStatus("Review the inline diff, then Accept or Reject.");
      })
      .catch(function (err) {
        setRefactorStatus((err && err.message) || "Refactor failed.");
      })
      .then(function () {
        refactorBusy = false;
        if (els.codeRefactorAsk) els.codeRefactorAsk.disabled = false;
      });
  }

  function acceptRefactor() {
    if (!refactorProposal || !cmEditor) return;
    if (!replaceEditorRange(
      refactorProposal.from,
      refactorProposal.to,
      refactorProposal.after
    )) return;
    state.dirty = true;
    if (els.codeEditor) els.codeEditor.value = cmEditor.getValue();
    if (els.codeStatus) {
      els.codeStatus.hidden = false;
      text(els.codeStatus, "Unsaved changes");
    }
    clearRefactorUi();
    if (els.codeRefactorPanel) els.codeRefactorPanel.hidden = true;
  }

  function rejectRefactor() {
    clearRefactorUi();
    if (els.codeRefactorPanel) els.codeRefactorPanel.hidden = true;
    setRefactorStatus("");
  }

  function runThatsEverything() {
    if (evaluateBusy) return;
    if (!isWideDesktop() || !isLearningSignedIn()) {
      requestLearningSignIn();
      return;
    }
    if (!evaluateApi || typeof evaluateApi.buildEvaluateUserMessage !== "function") {
      setEvaluateStatus("Evaluate helper missing.");
      if (els.codeEvaluatePanel) els.codeEvaluatePanel.hidden = false;
      return;
    }
    var api = resolveClaudeApi();
    if (!api) {
      setEvaluateStatus("Sign in to evaluate with Claude.");
      if (els.codeEvaluatePanel) els.codeEvaluatePanel.hidden = false;
      return;
    }
    var tab = activeTab();
    if (!tab) {
      setEvaluateStatus("Open an exercise answer file first.");
      if (els.codeEvaluatePanel) els.codeEvaluatePanel.hidden = false;
      return;
    }
    var filePath = activeFilePath();
    var stepsDoc = stepsJsonForExercise(tab.exerciseId);
    var steps = evaluateApi.listSteps(stepsDoc);
    var found = evaluateApi.findCurrentStep(steps, filePath);
    if (!found.step) {
      setEvaluateStatus("Open a practice file inside a curriculum step folder.");
      if (els.codeEvaluatePanel) els.codeEvaluatePanel.hidden = false;
      return;
    }
    // Module sidebar opens the lesson README on step click. That's everything
    // must grade the practice answer (api.md / openapi.yaml), not the lesson.
    var answerNode = answerNodeForStep(tab.exerciseId, found.step);
    var answerNodeId = tab.nodeId;
    var answerPath = filePath;
    var answer = editorContent();
    var openIsLesson =
      /^readme\.md$/i.test(String(activeFileName() || "")) ||
      (answerNode && answerNode.id && answerNode.id !== tab.nodeId);
    if (openIsLesson && answerNode) {
      answerNodeId = answerNode.id;
      answer =
        answerNode.content != null ? String(answerNode.content) : "";
      if (revision && typeof revision.nodeRelPath === "function") {
        var exForPath = state.workspace.exercises[tab.exerciseId];
        if (exForPath) {
          answerPath =
            revision.nodeRelPath(exForPath.nodes, answerNode.id) || answerPath;
        }
      }
      filePath = answerPath;
    }
    if (!String(answer || "").trim()) {
      setEvaluateStatus("Write an answer before That's everything.");
      if (els.codeEvaluatePanel) els.codeEvaluatePanel.hidden = false;
      return;
    }
    var next = evaluateApi.nextStepAfter(steps, found.index);
    var currentReadmePath = evaluateApi.readmePathForStep(found.step);
    var nextReadmePath = next ? evaluateApi.readmePathForStep(next) : "";
    var ex = state.workspace.exercises[tab.exerciseId];
    var userMessage;
    try {
      userMessage = evaluateApi.buildEvaluateUserMessage({
        exerciseId: tab.exerciseId,
        exerciseName: ex && ex.name,
        filePath: filePath,
        answerText: answer,
        currentStep: found.step,
        currentReadme: readmeContentForPath(tab.exerciseId, currentReadmePath),
        nextStep: next,
        nextReadme: nextReadmePath
          ? readmeContentForPath(tab.exerciseId, nextReadmePath)
          : "",
      });
    } catch (err) {
      setEvaluateStatus((err && err.message) || "Could not build evaluate request.");
      if (els.codeEvaluatePanel) els.codeEvaluatePanel.hidden = false;
      return;
    }

    var model =
      (evaluateApi && evaluateApi.MODEL) ||
      (models && models.EXERCISE_REFACTOR) ||
      "claude-opus-5-5";

    evaluateBusy = true;
    evaluateProposal = null;
    clearRefactorUi();
    if (els.codeEvaluatePanel) els.codeEvaluatePanel.hidden = false;
    if (els.codeEvaluateDiff) els.codeEvaluateDiff.hidden = true;
    if (els.codeEvaluateFeedback) text(els.codeEvaluateFeedback, "");
    setEvaluateStatus("Saving, then asking Claude…");
    if (els.codeThatsEverything) els.codeThatsEverything.disabled = true;

    // Persist the answer through the existing exercise_workspace write_file path.
    // When the lesson README is open, still write the practice answer node.
    var savePromise = persistMutation(
      "write_file",
      { exerciseId: tab.exerciseId, nodeId: answerNodeId, content: answer },
      function (ws) {
        return core.writeFile(ws, {
          exerciseId: tab.exerciseId,
          nodeId: answerNodeId,
          content: answer,
        });
      }
    ).then(function () {
      state.dirty = false;
    }).catch(function () {
      // Still evaluate the in-editor answer if save fails.
    });

    // Opus 5.5 adaptive thinking shares max_tokens with the JSON body.
    // Evaluate rewrites a full next-step README; leave room (effort:low
    // is set by the structured helper).
    var evaluateMaxTokens = 32000;

    savePromise
      .then(function () {
        setEvaluateStatus("Asking Claude…");
        var schema =
          (evaluateApi && evaluateApi.REPLY_SCHEMA) ||
          (structuredApi && structuredApi.EVALUATE_SCHEMA);
        if (
          structuredApi &&
          typeof structuredApi.runStructuredJsonCall === "function" &&
          schema
        ) {
          return structuredApi.runStructuredJsonCall({
            callFn: function (payload) {
              return api.callClaude(payload);
            },
            system: evaluateApi.SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
            model: model,
            maxTokens: evaluateMaxTokens,
            effort: "low",
            schema: schema,
            toolName:
              (evaluateApi && evaluateApi.TOOL_NAME) ||
              "submit_exercise_evaluation",
            validate: function (payload) {
              return evaluateApi.parseEvaluateReply(payload);
            },
            friendlyError:
              (structuredApi && structuredApi.FRIENDLY_ERROR) ||
              "Claude's reply came back in a shape we couldn't use. Try again.",
          });
        }
        return api
          .callClaude({
            system: evaluateApi.SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
            model: model,
            maxTokens: evaluateMaxTokens,
          })
          .then(function (result) {
            return {
              value: evaluateApi.parseEvaluateReply(result && result.text),
            };
          });
      })
      .then(function (out) {
        var parsed = out && out.value ? out.value : out;
        var before = nextReadmePath
          ? readmeContentForPath(tab.exerciseId, nextReadmePath)
          : "";
        var proposedPath = parsed.nextStepPath || nextReadmePath || "";
        var hasDiff = !!(
          proposedPath &&
          typeof parsed.nextStepContent === "string" &&
          parsed.nextStepContent.length
        );
        evaluateProposal = {
          exerciseId: tab.exerciseId,
          feedback: parsed.feedback,
          summary: parsed.summary,
          nextStepPath: proposedPath,
          before: before,
          after: parsed.nextStepContent || "",
          aggressiveness: parsed.aggressiveness,
          hasDiff: hasDiff,
        };
        text(els.codeEvaluateFeedback, parsed.feedback || "");
        if (hasDiff) {
          text(
            els.codeEvaluateSummary,
            parsed.summary || "Proposed next-step update"
          );
          text(els.codeEvaluatePath, proposedPath);
          text(els.codeEvaluateBefore, before || "(empty)");
          text(els.codeEvaluateAfter, parsed.nextStepContent);
          if (els.codeEvaluateDiff) els.codeEvaluateDiff.hidden = false;
          setEvaluateStatus("Review the next-step diff, then Accept or Reject.");
        } else {
          if (els.codeEvaluateDiff) els.codeEvaluateDiff.hidden = true;
          setEvaluateStatus("Feedback ready. No next-step change proposed.");
        }
      })
      .catch(function (err) {
        setEvaluateStatus((err && err.message) || "Evaluation failed.");
      })
      .then(function () {
        evaluateBusy = false;
        if (els.codeThatsEverything) els.codeThatsEverything.disabled = false;
      });
  }

  function acceptEvaluate() {
    if (!evaluateProposal || !evaluateProposal.hasDiff) {
      clearEvaluateUi();
      return;
    }
    var proposal = evaluateProposal;
    var applied;
    try {
      applied = evaluateApi.applyNextStepReadme(state.workspace, {
        core: core,
        revision: revision,
        exerciseId: proposal.exerciseId,
        nextStepPath: proposal.nextStepPath,
        nextStepContent: proposal.after,
        workspace: state.workspace,
      });
    } catch (err) {
      setEvaluateStatus((err && err.message) || "Could not apply next-step update.");
      return;
    }
    var nodeId = applied && applied.nodeId;
    persistMutation(
      "write_file",
      {
        exerciseId: proposal.exerciseId,
        nodeId: nodeId,
        content: proposal.after,
      },
      function (ws) {
        return core.writeFile(ws, {
          exerciseId: proposal.exerciseId,
          nodeId: nodeId,
          content: proposal.after,
        });
      }
    ).then(function () {
      state.status = "Next step updated in Tinker.";
      clearEvaluateUi();
      render();
    }).catch(function () {
      // Local apply already on workspace via writeFile in apply; re-apply.
      applyWorkspace(applied.workspace || state.workspace);
      state.status = "Next step updated locally.";
      clearEvaluateUi();
      render();
    });
  }

  function rejectEvaluate() {
    clearEvaluateUi();
    setEvaluateStatus("");
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
      if (!focused && !refactorProposal && !evaluateProposal) cmEditor.setValue(content || "");
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

  function rememberResume(exerciseId, nodeId) {
    var nextApi = window.tinkerExercisesNext;
    if (!nextApi || typeof nextApi.setResume !== "function") return;
    var node = findNode(exerciseId, nodeId);
    nextApi.setResume(exerciseId, {
      nodeId: nodeId,
      fileName: node ? String(node.name || "") : "",
      updatedAt: new Date().toISOString(),
    }, window.localStorage);
  }

  function firstFileNode(exerciseId) {
    var ex = state.workspace.exercises[exerciseId];
    if (!ex || !Array.isArray(ex.nodes)) return null;
    // Prefer the first curriculum step's content (README), not root meta files.
    var steps = curriculumSteps(exerciseId);
    if (steps.length) {
      var stepReadme = readmeNodeForStep(exerciseId, steps[0]);
      if (stepReadme) return stepReadme;
      var stepAnswer = answerNodeForStep(exerciseId, steps[0]);
      if (stepAnswer) return stepAnswer;
    }
    var readme = null;
    var first = null;
    ex.nodes.forEach(function (node) {
      if (!node || node.type !== "file") return;
      if (!first) first = node;
      if (String(node.name || "").toLowerCase() === "readme.md") readme = node;
    });
    return readme || first;
  }

  function openExercise(exerciseId, opts) {
    var options = opts || {};
    var id = String(exerciseId || "").trim();
    if (!id || !state.workspace.exercises[id]) return false;
    if (!isLearningSignedIn()) {
      requestLearningSignIn();
      return false;
    }
    setExplorerOpen(true);
    var nodeId = options.nodeId == null ? "" : String(options.nodeId);
    var node = nodeId ? findNode(id, nodeId) : null;
    if (!node || node.type !== "file") {
      var fallback = firstFileNode(id);
      if (!fallback) {
        state.selected = { exerciseId: id, nodeId: null };
        render();
        return true;
      }
      nodeId = fallback.id;
    }
    openFile(id, nodeId, { focus: options.focus !== false });
    return true;
  }

  function openFile(exerciseId, nodeId, opts) {
    opts = opts || {};
    if (!isLearningSignedIn()) {
      requestLearningSignIn();
      applyAuthGate();
      return;
    }
    var node = findNode(exerciseId, nodeId);
    if (!node || node.type !== "file") return;
    if (!isWideDesktop()) {
      if (state.readerBackPending) {
        state.queuedMobileFile = { exerciseId: exerciseId, nodeId: nodeId };
        return;
      }
      state.selected = { exerciseId: exerciseId, nodeId: nodeId };
      state.mobileFile = { exerciseId: exerciseId, nodeId: nodeId, session: state.readerSession };
      if (window.history) {
        var historyState = Object.assign({}, window.history.state || {}, { tinkerExerciseReader: state.mobileFile });
        // One history entry for the reader, even on repeated opens.
        if (window.history.state && window.history.state.tinkerExerciseReader) window.history.replaceState(historyState, "");
        else window.history.pushState(historyState, "");
      }
      setExplorerOpen(true);
      render();
      if (els.readerContent) { els.readerContent.scrollTop = 0; els.readerContent.scrollLeft = 0; }
      if (els.readerBack) els.readerBack.focus();
      return;
    }
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
    var pres = presentationForNode(exerciseId, nodeId);
    var tabTitle = pres.title || node.name;
    if (existing) {
      existing.title = tabTitle;
      existing.blank = !!blankPractice;
    } else {
      state.openTabs.push({
        id: id,
        exerciseId: exerciseId,
        nodeId: nodeId,
        title: tabTitle,
        blank: !!blankPractice,
      });
    }
    state.activeTabId = id;
    state.selected = { exerciseId: exerciseId, nodeId: nodeId };
    state.dirty = false;
    rememberResume(exerciseId, nodeId);
    render();
    if (!isDesktopStepPreview(exerciseId, nodeId) &&
        cmEditor && typeof cmEditor.focus === "function") {
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
    var codePres = presentationForNode(tab.exerciseId, tab.nodeId);
    text(els.codePath, codePres.pathLabel);
    var content = tab.blank ? "" : (node.content || "");
    // Lesson steps: read-only rendered markdown. Your answer stays editable.
    if (codePres.kind === "step" && isMarkdownFileName(node.name)) {
      showDesktopStepPreview(content);
      return;
    }
    clearDesktopStepPreview();
    ensureCm(node.name, content);
    if (els.codeSave) els.codeSave.hidden = false;
    if (els.codeThatsEverything) els.codeThatsEverything.hidden = false;
    if (els.codeRefactor) els.codeRefactor.hidden = false;
    if (els.codeStatus) {
      if (state.status) {
        els.codeStatus.hidden = false;
        text(els.codeStatus, state.status);
      } else if (tab.blank) {
        els.codeStatus.hidden = false;
        text(els.codeStatus, "Practice learning module opens blank. Write from scratch.");
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
      row.draggable = isWideDesktop();

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
      if (isWideDesktop()) row.appendChild(renameBtn);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "repo-ex-node__icon repo-ex-node__icon--danger";
      delBtn.title = "Delete";
      delBtn.textContent = "\u00d7";
      delBtn.addEventListener("click", function (event) {
        if (event.stopPropagation) event.stopPropagation();
        requestDelete(exerciseId, node);
      });
      if (isWideDesktop()) row.appendChild(delBtn);

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
    if (!isWideDesktop() || !isLearningSignedIn()) return;
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
    if (els.toolbar) els.toolbar.hidden = !isWideDesktop();
    if (els.loadStatus) {
      els.loadStatus.hidden = !state.loading && !state.loadError;
      text(els.loadStatus, state.loading ? "Loading exercises…" : state.loadError);
    }
    if (els.loadRetry) els.loadRetry.hidden = !state.loadError || state.loading;
    if (els.empty) els.empty.hidden = order.length > 0 || state.loading || !!state.loadError;
    if (els.hint) {
      text(
        els.hint,
        !isWideDesktop()
          ? (state.localOnly ? "Read only · Exercise templates. Sign in to Tinker for your saved learning modules." : "Read only · Your saved exercises. Edit on desktop.")
          : state.localOnly
          ? "Browsing learning modules. Sign in to Tinker to save changes."
          : "Learning modules. Edits save in Tinker; Blob holds the shared copy when configured."
      );
    }

    order.forEach(function (exerciseId, index) {
      var ex = state.workspace.exercises[exerciseId];
      if (!ex) return;
      var rootKey = "ex:" + exerciseId;
      var collapsed = !!state.collapsed[rootKey];
      var group = document.createElement("div");
      group.className = "repo-explorer__group repo-ex-module";
      group.setAttribute("data-exercise-id", exerciseId);
      group.draggable = isWideDesktop();

      var head = document.createElement("div");
      head.className = "repo-explorer__group-row repo-ex-module__head";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "repo-explorer__group-btn repo-ex-module__btn" +
        (state.selected.exerciseId === exerciseId && !state.selected.nodeId ? " is-selected" : "");
      var name = document.createElement("span");
      name.className = "repo-explorer__name repo-ex-module__title";
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
      if (tStatus === "error" && isWideDesktop()) {
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

      if (index > 0 && isWideDesktop()) {
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
      if (index < order.length - 1 && isWideDesktop()) {
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

      // Module card: write-about + ordered step progression (no file/folder tree).
      // Storage paths stay unchanged; this is presentation only.
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
        if (isWideDesktop()) group.appendChild(writeAbout);

        if (ex.nodes && ex.nodes.length) {
          renderModuleProgress(group, exerciseId);
        } else {
          var empty = document.createElement("p");
          empty.className = "repo-ex-module__empty";
          text(empty, "No learning modules yet");
          group.appendChild(empty);
        }
      }
      els.body.appendChild(group);
    });

    if (order.length) {
      renderUpcomingModulePlaceholders(els.body);
    }
  }

  function render() {
    applyAuthGate();
    renderMobileReader();
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
      ? ("Exercise updated (" + filesN + " learning module" + (filesN === 1 ? "" : "s") + ").")
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
    if (!isWideDesktop()) return Promise.reject(new Error("Exercises are read-only on mobile."));
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
    if (!isWideDesktop() || !isLearningSignedIn()) return;
    var exerciseId = state.selected.exerciseId || (state.workspace.exerciseOrder || [])[0];
    if (!exerciseId) return;
    var label = type === "folder" ? "Learning modules name" : "Learning module name";
    var name = window.prompt(label, type === "folder" ? "new-learning-modules" : "untitled.ts");
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
    if (!isWideDesktop() || !isLearningSignedIn()) return;
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
    if (!isWideDesktop() || !isLearningSignedIn()) return;
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
    if (!isWideDesktop() || !isLearningSignedIn()) return;
    state.pendingDelete = { exerciseId: exerciseId, node: node };
    if (els.confirmHint) {
      text(
        els.confirmHint,
        node.type === "folder"
          ? ("Delete learning modules \"" + node.name + "\" and everything inside it?")
          : ("Delete learning module \"" + node.name + "\"?")
      );
    }
    if (els.confirm) els.confirm.hidden = false;
  }

  function closeConfirm() {
    state.pendingDelete = null;
    if (els.confirm) els.confirm.hidden = true;
  }

  function confirmDelete() {
    if (!isWideDesktop() || !isLearningSignedIn()) return;
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
    if (!isWideDesktop() || !isLearningSignedIn()) return;
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
    if (!isWideDesktop() || !isLearningSignedIn()) return;
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
    var essaysButton = $("repo-past-essays");
    if (essaysButton) essaysButton.addEventListener("click", function () {
      if (!isWideDesktop()) setExplorerOpen(false);
    });
    if (els.readerBack) els.readerBack.addEventListener("click", backToExerciseFiles);
    if (els.loadRetry) els.loadRetry.addEventListener("click", function () { loadWorkspace(); });
    window.addEventListener("popstate", function (event) {
      state.readerBackPending = false;
      var queued = state.queuedMobileFile;
      state.queuedMobileFile = null;
      var entry = event.state && event.state.tinkerExerciseReader;
      state.mobileFile = entry && entry.session === state.readerSession ? entry : null;
      if (state.mobileFile && !isWideDesktop() && isLearningSignedIn()) setExplorerOpen(true);
      render();
      if (!state.mobileFile) focusSelectedFile();
      if (queued && !isWideDesktop() && isLearningSignedIn()) openFile(queued.exerciseId, queued.nodeId);
    });
    var media = window.matchMedia && window.matchMedia("(min-width: 801px)");
    if (media && media.addEventListener) media.addEventListener("change", function () {
      state.drag = null;
      closeConfirm();
      render();
    });
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
    if (els.codeThatsEverything) {
      els.codeThatsEverything.addEventListener("click", function () {
        runThatsEverything();
      });
    }
    if (els.codeEvaluateAccept) els.codeEvaluateAccept.addEventListener("click", acceptEvaluate);
    if (els.codeEvaluateReject) els.codeEvaluateReject.addEventListener("click", rejectEvaluate);
    if (els.codeRefactor) els.codeRefactor.addEventListener("click", openRefactorPanel);
    if (els.codeRefactorAsk) els.codeRefactorAsk.addEventListener("click", askRefactor);
    if (els.codeRefactorCancel) {
      els.codeRefactorCancel.addEventListener("click", function () {
        clearRefactorUi();
        if (els.codeRefactorPanel) els.codeRefactorPanel.hidden = true;
      });
    }
    if (els.codeRefactorAccept) els.codeRefactorAccept.addEventListener("click", acceptRefactor);
    if (els.codeRefactorReject) els.codeRefactorReject.addEventListener("click", rejectRefactor);
    if (els.codeRefactorInput) {
      els.codeRefactorInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          if (event.preventDefault) event.preventDefault();
          askRefactor();
        }
      });
    }
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
    // Desktop + signed-in mobile: show exercises by default so the write
    // surface is not a blank void under the location picker on phones.
    if (isWideDesktop() || isLearningSignedIn()) {
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
      if (!isWideDesktop()) setExplorerOpen(true);
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
    openExercise: openExercise,
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

