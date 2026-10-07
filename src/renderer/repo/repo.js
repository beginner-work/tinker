/* /repo — stories as Markdown files + blank writing surface + folders.
 *
 * Write page: blank Markdown editor + Location as writing place
 * (where the writer is). Files page: nested folders and Saved in
 * (disk / cloud root). Folders/placements/places persist via
 * /api/repo-folders. Mac: when a Tinker disk root is set, write into
 * mirrored directories.
 */

(function () {
  "use strict";

  var LOCATION_KEY = "tinker.repo.location.v1";
  var RECENT_PLACES_KEY = "tinker.repo.placesRecent.v1";
  var ESSAYS_KEY = "tinker.essays.v1";
  var PAD_DRAFT_KEY = "tinker.repo.padDraft.v1";
  var PLACE_STARTERS = ["Home", "Coffee shop", "San Diego"];
  var STORAGE_EVENT = "tinker-storage-root-changed";
  var TOKEN_KEY = "tinker_jwt";
  var PHONE_KEY = "tinker_phone";
  var RETURN_KEY = "tinker_mcp_return";
  var md = window.tinkerStoriesMd;
  var core = window.tinkerRepoFoldersCore;
  var padReveal = window.tinkerRepoPadReveal || null;
  var essayRead = window.tinkerEssayRead || null;
  var writeScroll = window.tinkerRepoWriteScroll || null;
  if (!md || !core) return;

  var pageMode = (document.body && document.body.getAttribute("data-repo-mode")) || "write";
  var isFilesPage = pageMode === "files";
  var isWritePage = !isFilesPage;

  var state = {
    stories: [],
    folders: [],
    placements: {},
    places: {},
    localFiles: {},
    selectedId: null,
    selectedFolderId: null,
    draft: null,
    location: "",
    locationOpen: false,
    // Session writing place when no file is selected yet; also seeds new files.
    currentPlace: "",
    placeActive: 0,
    placeRows: [],
    savedInCustom: false,
    savedInError: "",
    savedInSaving: false,
    status: "",
    pieceCounter: 0,
    collapsed: {},
    creatingFolder: false,
    createParentId: null,
    createError: "",
    renamingFolderId: null,
    renameError: "",
    moveFileId: null,
    pendingDeleteId: null,
    openMenuFolderId: null,
    dragFileId: null,
    mirroredFolders: {},
    padActionsVisible: false,
    padIdleTimer: null,
    padIdleMsOverride: null,
    keystrokeGaps: [],
    lastKeystrokeAt: 0,
    lastRevealDelayMs: 0,
    lastMedianGapMs: 0,
    padSaving: false,
    padAsking: false,
    followupAsked: [],
    followupQuestion: "",
    keepFinishedWriting: false,
    // Mobile: full-screen essay list (same .repo-right tree as desktop).
    mobileEssayList: false,
    // Read-view mount for saved essays (toggle always starts off per essay).
    essayReadMount: null,
    essayReadStoryId: null,
  };

  var els = {
    name: document.getElementById("repo-name"),
    branch: document.getElementById("repo-branch"),
    tree: document.getElementById("repo-tree"),
    empty: document.getElementById("repo-stories-empty"),
    newPiece: document.getElementById("repo-new-piece"),
    sidebarNewPiece: document.getElementById("repo-sidebar-new-piece"),
    newFolder: document.getElementById("repo-new-folder"),
    body: document.getElementById("repo-body"),
    pad: document.getElementById("repo-pad"),
    essayView: document.getElementById("repo-essay-view"),
    surface: document.getElementById("repo-surface"),
    followup: document.getElementById("repo-followup"),
    padError: document.getElementById("repo-pad-error"),
    padErrorText: document.getElementById("repo-pad-error-text"),
    padErrorRetry: document.getElementById("repo-pad-error-retry"),
    padErrorSignin: document.getElementById("repo-pad-error-signin"),
    padActions: document.getElementById("repo-pad-actions"),
    keepCrafting: document.getElementById("repo-keep-crafting"),
    thisIsEverything: document.getElementById("repo-this-is-everything"),
    locationBtn: document.getElementById("repo-location-btn"),
    locationPanel: document.getElementById("repo-location-panel"),
    locationInput: document.getElementById("repo-location-input"),
    locationSave: document.getElementById("repo-location-save"),
    locationChoose: document.getElementById("repo-location-choose"),
    locationValue: document.getElementById("repo-location-value"),
    locationList: document.getElementById("repo-location-list"),
    locationCustom: document.getElementById("repo-location-custom"),
    locationError: document.getElementById("repo-location-error"),
    filePath: document.getElementById("repo-file-path"),
    fileType: document.getElementById("repo-file-type"),
    filePlace: document.getElementById("repo-file-place"),
    syncHint: document.getElementById("repo-sync-hint"),
    signin: document.getElementById("repo-signin"),
    account: document.getElementById("repo-account"),
    accountLabel: document.getElementById("repo-account-label"),
    signout: document.getElementById("repo-signout"),
    savedInList: document.getElementById("repo-saved-in-list"),
    savedInCustom: document.getElementById("repo-saved-in-custom"),
    savedInInput: document.getElementById("repo-saved-in-input"),
    savedInError: document.getElementById("repo-saved-in-error"),
    savedInSave: document.getElementById("repo-saved-in-save"),
    moveSheet: document.getElementById("repo-move-sheet"),
    moveList: document.getElementById("repo-move-list"),
    moveCancel: document.getElementById("repo-move-cancel"),
    moveBackdrop: document.getElementById("repo-move-backdrop"),
    moveHint: document.getElementById("repo-move-hint"),
    confirmSheet: document.getElementById("repo-confirm-sheet"),
    confirmHint: document.getElementById("repo-confirm-hint"),
    confirmKeep: document.getElementById("repo-confirm-keep"),
    confirmDelete: document.getElementById("repo-confirm-delete"),
    confirmCancel: document.getElementById("repo-confirm-cancel"),
    confirmBackdrop: document.getElementById("repo-confirm-backdrop"),
  };

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

  function clearAuthSession() {
    try { window.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    try { window.localStorage.removeItem("tinker_phone"); } catch (e2) { /* ignore */ }
    try { window.localStorage.removeItem("tinker_phone_id"); } catch (e3) { /* ignore */ }
  }

  function returnPathForAuth() {
    try {
      var path = String(window.location.pathname || "/repo");
      var search = String(window.location.search || "");
      if (path.indexOf("/repo") !== 0) return "/repo";
      return path + search;
    } catch (e) {
      return "/repo";
    }
  }

  function sendHomeForAuth() {
    stashPadDraftForAuth();
    // Drop any stale/rejected token first. Otherwise repo-redirect.js sees
    // tinker_jwt and bounces / → /repo before the phone gate can render.
    clearAuthSession();
    try { window.sessionStorage.setItem(RETURN_KEY, returnPathForAuth()); }
    catch (e) { /* ignore */ }
    // signin=1 is an explicit allowlist skip in repo-redirect.js.
    window.location.assign("/?signin=1");
  }

  function accountLabelText() {
    var phone = "";
    try { phone = String(window.localStorage.getItem(PHONE_KEY) || "").replace(/\D/g, ""); }
    catch (e) { phone = ""; }
    if (phone.length >= 4) return "••• " + phone.slice(-4);
    return "Signed in";
  }

  function renderAuthChrome() {
    var signedIn = hasSessionToken();
    if (els.signin) els.signin.hidden = signedIn;
    if (els.account) els.account.hidden = !signedIn;
    if (els.accountLabel) text(els.accountLabel, signedIn ? accountLabelText() : "");
  }

  function isAuthFailure(err) {
    if (!err) return false;
    var code = err.code;
    if (code === "MISSING_TOKEN" || code === "SESSION_EXPIRED") return true;
    var status = Number(err.status);
    if (status === 401 || status === 403) return true;
    return false;
  }

  function stashPadDraftForAuth() {
    try {
      var body = padBody();
      if (!String(body || "").trim()) {
        window.sessionStorage.removeItem(PAD_DRAFT_KEY);
        return;
      }
      window.sessionStorage.setItem(PAD_DRAFT_KEY, JSON.stringify({
        body: body,
        place: activePlace() || "",
        at: Date.now(),
      }));
    } catch (e) { /* ignore */ }
  }

  function restorePadDraftAfterAuth() {
    if (!isWritePage || !els.body) return;
    var raw = "";
    try { raw = window.sessionStorage.getItem(PAD_DRAFT_KEY) || ""; }
    catch (e) { return; }
    if (!raw) return;
    try { window.sessionStorage.removeItem(PAD_DRAFT_KEY); } catch (e2) { /* ignore */ }
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e3) { return; }
    if (!parsed || typeof parsed.body !== "string" || !parsed.body.trim()) return;
    if (padBody().trim()) return;
    setPadMarkdown(parsed.body, { focusEnd: true });
    if (parsed.place) {
      state.currentPlace = String(parsed.place).slice(0, 120);
      pushRecentPlace(state.currentPlace);
    }
    ensureDraftFromPad();
    syncPadFromDom();
    renderPlace();
    bumpPadTypingIdle();
  }

  function hasSessionToken() {
    return !!token();
  }

  /** Prefer window.tinker when it has callClaude; else platform-mobile's
   * writable facade (window.tinkerApi) for Electron contextBridge freezes. */
  function resolveTinkerApi() {
    if (window.tinker && typeof window.tinker.callClaude === "function") return window.tinker;
    if (window.tinkerApi && typeof window.tinkerApi.callClaude === "function") return window.tinkerApi;
    return null;
  }

  function ensureClaudeClient() {
    return !!resolveTinkerApi();
  }

  function authHeaders() {
    return {
      Authorization: "Bearer " + token(),
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  function shortenPath(value) {
    var s = String(value || "").trim().replace(/\\/g, "/");
    if (!s) return "";
    var parts = s.split("/").filter(Boolean);
    if (parts.length <= 2) return s;
    return "…/" + parts.slice(-2).join("/");
  }

  function formatUserPath(absPath) {
    var s = String(absPath || "").trim().replace(/\\/g, "/");
    if (!s) return "";
    var userMatch = s.match(/^\/Users\/[^/]+(\/.*)?$/);
    if (userMatch) return "~" + (userMatch[1] || "");
    if (s.indexOf("/home/") === 0) {
      var parts = s.split("/").filter(Boolean);
      if (parts.length >= 2) {
        var rest = parts.slice(2).join("/");
        return rest ? "~/" + rest : "~";
      }
    }
    return shortenPath(s) || s;
  }

  function readStoredLocation() {
    try {
      var raw = window.localStorage.getItem(LOCATION_KEY);
      return raw ? String(raw) : "";
    } catch (e) {
      return "";
    }
  }

  function writeStoredLocation(value) {
    try {
      if (value) window.localStorage.setItem(LOCATION_KEY, value);
      else window.localStorage.removeItem(LOCATION_KEY);
    } catch (e) { /* ignore */ }
  }

  function getLocation() {
    return state.location || "";
  }

  function getPlace() {
    return activePlace();
  }

  function setLocation(value) {
    state.location = String(value || "").trim();
    writeStoredLocation(state.location);
    refreshLocation();
    syncStoriesToDisk();
  }

  function canPickFolder() {
    return !!(window.tinker && typeof window.tinker.pickNotesFolder === "function");
  }

  function canUseCustomPath() {
    return !!(window.tinker && typeof window.tinker.useCustomStoragePath === "function");
  }

  function selectedStorageInfo() {
    var storage = window.tinkerRepoStorage;
    if (storage && typeof storage.getSelected === "function") {
      try {
        var selected = storage.getSelected();
        if (selected) return selected;
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  function readStorageMeta() {
    var fsAccess = window.tinkerFsAccessFolder;
    if (fsAccess && typeof fsAccess.readMeta === "function") {
      try { return fsAccess.readMeta(); } catch (e) { return null; }
    }
    return null;
  }

  function isMacFolderSelected() {
    var meta = readStorageMeta();
    if (meta && meta.id === "mac-folder" && meta.path && meta.path === state.location) return true;
    var selected = selectedStorageInfo();
    if (selected && selected.id === "mac-folder") return true;
    if (selected && (selected.id === "custom" || selected.kind === "fs-access")) return false;
    if (selected && selected.path && state.location && selected.path === state.location) return false;
    return !selected && !!state.location;
  }

  function isCustomPathSelected() {
    var meta = readStorageMeta();
    if (meta && meta.id === "custom" && meta.path && meta.path === state.location) return true;
    var selected = selectedStorageInfo();
    return !!(selected && selected.id === "custom");
  }

  function persistPhysicalRoot(info) {
    if (!info || !info.path) return;
    var fsAccess = window.tinkerFsAccessFolder;
    if (fsAccess && typeof fsAccess.writeMeta === "function") {
      try {
        fsAccess.writeMeta({
          folderName: info.name || "Tinker",
          kind: "electron",
          id: info.id || "electron",
          label: info.label || info.name || "Tinker",
          path: info.path,
        });
      } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT, {
        detail: {
          id: info.id || "",
          label: info.label || info.name || "Tinker",
          path: info.path || "",
          kind: info.kind || "electron",
          name: info.name || "Tinker",
        },
      }));
    } catch (e) { /* ignore */ }
  }

  function applyPhysicalRoot(info) {
    if (!info || !info.path) return;
    persistPhysicalRoot(info);
    setLocation(info.path);
    state.savedInCustom = false;
    state.savedInError = "";
    refreshLocation();
  }

  function canWriteDisk() {
    var storage = window.tinkerRepoStorage;
    if (storage && typeof storage.getAdapter === "function") {
      var adapter = storage.getAdapter();
      if (adapter && adapter.available && adapter.available()) return true;
    }
    return !!(
      state.location &&
      window.tinker &&
      typeof window.tinker.writeNotesFile === "function" &&
      typeof window.tinker.listNotesFiles === "function"
    );
  }

  function activeStorageAdapter() {
    var storage = window.tinkerRepoStorage;
    if (storage && typeof storage.getAdapter === "function") {
      var adapter = storage.getAdapter();
      if (adapter && adapter.available && adapter.available()) return adapter;
    }
    if (
      state.location &&
      window.tinker &&
      typeof window.tinker.writeNotesFile === "function"
    ) {
      return {
        list: function () { return window.tinker.listNotesFiles(state.location); },
        write: function (rel, text) { return window.tinker.writeNotesFile(state.location, rel, text); },
        move: function (from, to) { return window.tinker.moveNotesFile(state.location, from, to); },
        remove: function (rel) { return window.tinker.removeNotesFile(state.location, rel); },
      };
    }
    return null;
  }

  function canMoveDisk() {
    return !!(window.tinker && typeof window.tinker.moveNotesFile === "function");
  }

  function isDesktopShell() {
    return !!(window.tinker && (window.tinker.isDesktopApp || window.tinker.supportsWebview));
  }

  function applyTree(tree) {
    if (!tree) return;
    state.folders = Array.isArray(tree.folders) ? tree.folders : [];
    state.placements = tree.placements && typeof tree.placements === "object" ? tree.placements : {};
    state.places = tree.places && typeof tree.places === "object" ? tree.places : {};
    recomputeStoryPaths();
  }

  function recomputeStoryPaths() {
    state.stories = state.stories.map(function (story) {
      var folderId = state.placements[story.id] || null;
      var fileName = story.fileName || (story.relPath && story.relPath.split("/").pop()) || "untitled.md";
      return Object.assign({}, story, {
        folderId: folderId,
        contentType: core.effectiveContentType(state.folders, state.placements, story.id),
        fileName: fileName,
        relPath: core.fileRelPath(state.folders, folderId, fileName),
      });
    });
    if (state.draft) {
      var dFolder = state.draft.folderId || null;
      state.draft = Object.assign({}, state.draft, {
        contentType: dFolder
          ? core.normalizeContentType((core.folderById(state.folders, dFolder) || {}).contentType)
          : core.DEFAULT_CONTENT_TYPE,
        relPath: core.fileRelPath(state.folders, dFolder, state.draft.fileName),
      });
    }
  }

  function selectedStory() {
    if (state.draft && state.selectedId === state.draft.id) return state.draft;
    for (var i = 0; i < state.stories.length; i += 1) {
      if (state.stories[i].id === state.selectedId) return state.stories[i];
    }
    return null;
  }

  function selectStory(id) {
    if (isFilesPage && id) {
      try {
        window.location.assign("/repo?file=" + encodeURIComponent(id));
      } catch (e) {
        window.location.href = "/repo?file=" + encodeURIComponent(id);
      }
      return;
    }
    state.keepFinishedWriting = false;
    setMobileEssayList(false);
    state.selectedId = id || null;
    state.selectedFolderId = null;
    render();
  }

  function selectFolder(id) {
    state.selectedFolderId = id || null;
    state.selectedId = null;
    render();
  }

  function toggleCollapsed(folderId) {
    state.collapsed[folderId] = !state.collapsed[folderId];
    renderTree();
  }

  function allFiles() {
    var files = state.stories.slice();
    if (state.draft) files = [state.draft].concat(files);
    return files;
  }

  function addNewFile() {
    if (isFilesPage) {
      var folderQ = state.selectedFolderId
        ? "&folder=" + encodeURIComponent(state.selectedFolderId)
        : "";
      try {
        window.location.assign("/repo?new=1" + folderQ);
      } catch (e) {
        window.location.href = "/repo?new=1" + folderQ;
      }
      return;
    }
    setMobileEssayList(false);
    state.keepFinishedWriting = false;
    state.pieceCounter += 1;
    var now = new Date();
    var folderId = state.selectedFolderId || null;
    var draft = {
      id: "draft-new-" + state.pieceCounter,
      title: "",
      body: "",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      fileName: md.storyDate(now) + "-untitled.md",
      folderId: folderId,
      contentType: folderId
        ? core.normalizeContentType((core.folderById(state.folders, folderId) || {}).contentType)
        : core.DEFAULT_CONTENT_TYPE,
      markdown: "",
      isNew: true,
    };
    var used = {};
    allFiles().forEach(function (s) { used[s.fileName] = true; });
    var n = 1;
    while (used[draft.fileName]) {
      n += 1;
      draft.fileName = md.storyDate(now) + "-untitled-" + n + ".md";
    }
    draft.relPath = core.fileRelPath(state.folders, folderId, draft.fileName);
    state.draft = draft;
    state.selectedId = draft.id;
    state.selectedFolderId = folderId;
    // Carry the session place onto the new file so it shows and survives first save.
    if (state.currentPlace) {
      state.places[draft.id] = state.currentPlace.slice(0, 120);
    }
    render();
    if (els.body) {
      try { els.body.focus(); } catch (e) { /* ignore */ }
    }
  }

  function padBody() {
    return els.body ? String(els.body.value || "") : "";
  }

  // Parse Markdown into text / question segments. Question lines are
  // `> …` in the file; the visual pad renders them without the marker.
  function parsePadMarkdown(md) {
    var src = String(md == null ? "" : md);
    var segments = [];
    var re = /(^|\n)(>\s+)(.+?)[ \t]*(?=\n|$)/g;
    var last = 0;
    var match;
    while ((match = re.exec(src))) {
      var markerStart = match.index + match[1].length;
      segments.push({ type: "text", text: src.slice(last, markerStart) });
      segments.push({
        type: "question",
        text: String(match[3] || "").replace(/\s+/g, " ").trim(),
        marker: match[2],
      });
      last = match.index + match[0].length;
    }
    segments.push({ type: "text", text: src.slice(last) });
    if (!segments.length) segments.push({ type: "text", text: "" });
    return segments;
  }

  function serializePadSegments(segments) {
    var out = "";
    var list = Array.isArray(segments) ? segments : [];
    for (var i = 0; i < list.length; i += 1) {
      var seg = list[i];
      if (!seg) continue;
      if (seg.type === "question") {
        var marker = seg.marker && String(seg.marker).indexOf(">") >= 0 ? seg.marker : "> ";
        out += marker + String(seg.text || "");
      } else {
        out += String(seg.text == null ? "" : seg.text);
      }
    }
    return out;
  }

  function readPadSegmentsFromDom() {
    if (!els.pad) return parsePadMarkdown(padBody());
    var segments = [];
    var nodes = els.pad.childNodes || [];
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!node || node.nodeType !== 1) continue;
      if (node.getAttribute && node.getAttribute("data-pad-q") === "1") {
        var q = node.getAttribute("data-q") || (node.textContent || "");
        segments.push({
          type: "question",
          text: String(q).replace(/\s+/g, " ").trim(),
          marker: node.getAttribute("data-marker") || "> ",
        });
      } else if (node.tagName === "TEXTAREA") {
        segments.push({ type: "text", text: String(node.value || "") });
      }
    }
    if (!segments.length) segments.push({ type: "text", text: "" });
    return segments;
  }

  function syncMirrorFromPadDom() {
    if (!els.body) return padBody();
    var next = serializePadSegments(readPadSegmentsFromDom());
    if (els.body.value !== next) els.body.value = next;
    return next;
  }

  function resizePadTurn(ta) {
    if (!ta) return;
    try {
      ta.style.height = "auto";
      var minPx = 0;
      try {
        minPx = parseFloat(window.getComputedStyle(ta).minHeight) || 0;
      } catch (e) { minPx = 0; }
      var next = Math.max(ta.scrollHeight || 0, minPx || 0);
      ta.style.height = Math.max(next, 48) + "px";
    } catch (err) { /* ignore */ }
  }

  function resizeAllPadTurns() {
    if (!els.pad) return;
    var turns = els.pad.querySelectorAll("textarea.repo-pad__turn");
    for (var i = 0; i < turns.length; i += 1) resizePadTurn(turns[i]);
  }

  function isPhoneWriteWidth() {
    try {
      return !!(window.matchMedia && window.matchMedia("(max-width: 800px)").matches);
    } catch (e) {
      return false;
    }
  }

  /** Mobile finish: show the desktop essays rail as a full-screen list. */
  function setMobileEssayList(open) {
    state.mobileEssayList = !!open && isWritePage;
    try {
      if (document.body) {
        if (state.mobileEssayList) {
          document.body.setAttribute("data-repo-essays-list", "1");
        } else {
          document.body.removeAttribute("data-repo-essays-list");
        }
      }
    } catch (e) { /* ignore */ }
    if (els.sidebarNewPiece) {
      // New essay only when the mobile list is up (desktop pad stays open).
      els.sidebarNewPiece.hidden = !state.mobileEssayList;
    }
  }

  function readSafeAreaInsetTop() {
    try {
      var raw = window.getComputedStyle(document.documentElement)
        .getPropertyValue("--repo-write-safe-inset-top");
      var n = parseFloat(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    } catch (e) { /* ignore */ }
    try {
      // env() is not readable directly; probe a zero-size measuring node.
      var probe = document.createElement("div");
      probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)";
      document.body.appendChild(probe);
      var pt = parseFloat(window.getComputedStyle(probe).paddingTop) || 0;
      document.body.removeChild(probe);
      return pt;
    } catch (e2) {
      return 0;
    }
  }

  /** Align the latest question below the top safe area; fade covers the rest. */
  function scrollQuestionIntoSafeView() {
    if (!els.pad || !writeScroll) return;
    var questions = els.pad.querySelectorAll(".repo-pad__q");
    var q = questions.length ? questions[questions.length - 1] : null;
    if (!q) return;
    var scrollY = window.scrollY || 0;
    var safeTop = writeScroll.resolveWriteSafeTopPx({
      isDesktop: isDesktopShell()
        || !!(document.documentElement
          && document.documentElement.hasAttribute("data-tinker-desktop")),
      isPhone: isPhoneWriteWidth(),
      safeAreaInsetTop: readSafeAreaInsetTop(),
    });
    try {
      document.documentElement.style.setProperty("--repo-write-safe-top", safeTop + "px");
    } catch (e) { /* ignore */ }
    var questionTop = writeScroll.documentTop(q, scrollY);
    var prevBottom = null;
    var prev = q.previousElementSibling;
    if (prev) {
      try {
        var prevRect = prev.getBoundingClientRect();
        prevBottom = prevRect.bottom + scrollY;
      } catch (e2) {
        prevBottom = writeScroll.documentTop(prev, scrollY)
          + (prev.offsetHeight || 0);
      }
    }
    var lineHeight = 24;
    try {
      var cs = window.getComputedStyle(prev || q);
      lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.65 || 24;
    } catch (e3) { /* ignore */ }
    var top = writeScroll.computeQuestionScrollTop({
      questionTop: questionTop,
      safeTop: safeTop,
      prevBottom: prevBottom,
      lineHeight: lineHeight,
      fadePx: writeScroll.WRITE_SCROLL.FADE_PX,
      scrollY: scrollY,
    });
    try {
      window.scrollTo({ top: top, behavior: "smooth" });
    } catch (e4) {
      try { window.scrollTo(0, top); } catch (e5) { /* ignore */ }
    }
  }

  function focusLastPadTurn(caretEnd) {
    if (!els.pad) return null;
    var turns = els.pad.querySelectorAll("textarea.repo-pad__turn");
    var ta = turns.length ? turns[turns.length - 1] : null;
    if (!ta) {
      // Ensure there is a turn to type into (blank pad / after load).
      renderPadFromMarkdown(padBody(), {});
      turns = els.pad.querySelectorAll("textarea.repo-pad__turn");
      ta = turns.length ? turns[turns.length - 1] : null;
    }
    if (!ta) return null;
    try {
      ta.focus();
      if (caretEnd && typeof ta.setSelectionRange === "function") {
        var end = String(ta.value || "").length;
        ta.setSelectionRange(end, end);
      }
      // Prefer question-aligned safe-area scroll so earlier writing never
      // peeks as a sliced line under the titlebar / traffic lights.
      if (writeScroll && els.pad.querySelector(".repo-pad__q")) {
        scrollQuestionIntoSafeView();
      } else if (typeof ta.scrollIntoView === "function") {
        ta.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } catch (e) { /* ignore */ }
    return ta;
  }

  /** Keep fixed mobile actions above the soft keyboard via visualViewport. */
  function syncVisualViewportInset() {
    if (!isWritePage) return;
    var inset = 0;
    try {
      var vv = window.visualViewport;
      if (vv && typeof vv.height === "number") {
        inset = Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
      }
    } catch (e) {
      inset = 0;
    }
    try {
      document.documentElement.style.setProperty("--repo-keyboard-inset", inset + "px");
    } catch (e2) { /* ignore */ }
  }

  function isInteractiveChrome(node) {
    if (!node || !node.closest) return false;
    if (node.closest("#repo-location")) return true;
    if (node.closest("#repo-pad-actions")) return true;
    if (node.closest("#repo-pad-error")) return true;
    if (node.closest("#repo-essay-view")) return true;
    if (node.closest(".repo-top")) return true;
    if (node.closest(".repo-right")) return true;
    if (node.closest(".repo-sheet")) return true;
    if (node.closest(".repo-pad__q")) return true;
    if (node.closest("a, button, input, select, label")) return true;
    // Existing turn: let the caret land where the user tapped.
    if (node.closest("textarea.repo-pad__turn")) return true;
    return false;
  }

  /** Tap blank writing space → focus editor, caret at end (opens keyboard on mobile). */
  function onBlankPadActivate(event) {
    if (!isWritePage) return;
    if (isEssayReadMode()) return;
    var target = event && event.target;
    if (isInteractiveChrome(target)) return;
    if (!els.surface || !els.surface.contains(target)) return;
    // Never cancel a real control click that bubbled past a miss in closest().
    if (event && event.preventDefault) event.preventDefault();
    focusLastPadTurn(true);
  }

  function padHasFocus() {
    var active = document.activeElement;
    if (!active) return false;
    if (els.pad && els.pad.contains(active)) return true;
    if (els.body && active === els.body) return true;
    return false;
  }

  function renderPadFromMarkdown(md, opts) {
    opts = opts || {};
    if (!els.pad) {
      if (els.body && md != null) els.body.value = String(md);
      return;
    }
    var source = md == null ? padBody() : String(md);
    if (els.body && els.body.value !== source) els.body.value = source;
    var segments = parsePadMarkdown(source);
    if (segments[0] && segments[0].type !== "text") {
      segments = [{ type: "text", text: "" }].concat(segments);
    }
    if (segments[segments.length - 1] && segments[segments.length - 1].type !== "text") {
      segments = segments.concat([{ type: "text", text: "" }]);
    }
    while (els.pad.firstChild) els.pad.removeChild(els.pad.firstChild);
    for (var i = 0; i < segments.length; i += 1) {
      var seg = segments[i];
      if (seg.type === "question") {
        var qEl = document.createElement("div");
        qEl.className = "repo-pad__q";
        qEl.setAttribute("data-pad-q", "1");
        qEl.setAttribute("data-q", seg.text || "");
        qEl.setAttribute("data-marker", seg.marker || "> ");
        qEl.setAttribute("contenteditable", "false");
        var qText = document.createElement("span");
        qText.className = "repo-pad__q-text";
        qText.textContent = seg.text || "";
        qEl.appendChild(qText);
        els.pad.appendChild(qEl);
      } else {
        var ta = document.createElement("textarea");
        ta.className = "writing-input repo-pad__turn";
        ta.setAttribute("data-pad-turn", "1");
        ta.spellcheck = true;
        ta.value = seg.text == null ? "" : String(seg.text);
        ta.addEventListener("input", onPadTurnInput);
        ta.addEventListener("keydown", onPadTurnKeydown);
        els.pad.appendChild(ta);
      }
    }
    resizeAllPadTurns();
    if (opts.focusEnd) focusLastPadTurn(true);
  }

  function onPadTurnInput(event) {
    var ta = event && event.target;
    resizePadTurn(ta);
    syncMirrorFromPadDom();
    onBodyInput();
  }

  function onPadTurnKeydown(event) {
    if (handleKeepCraftingShortcut(event)) return;
    onPadTypingKey(event);
  }

  function isAppleModHint() {
    try {
      var nav = window.navigator || {};
      var p = String(nav.platform || "");
      var ua = String(nav.userAgent || "");
      // Mac desktop / laptop only — not iPhone/iPad (hint is CSS-hidden there).
      if (/iPhone|iPad|iPod/i.test(p) || /iPhone|iPad|iPod/i.test(ua)) return false;
      if (/Mac/i.test(p) || /Mac OS X|Macintosh/i.test(ua)) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function syncKeepCraftingShortcutHint() {
    var kbd = document.getElementById("repo-keep-crafting-kbd");
    if (!kbd) return;
    kbd.textContent = isAppleModHint() ? "⌘↵" : "Ctrl↵";
    if (els.keepCrafting) {
      els.keepCrafting.setAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
    }
  }

  /** Cmd/Ctrl+Enter → Keep crafting (same as the button). No newline; ignore in-flight. */
  function handleKeepCraftingShortcut(event) {
    if (!event) return false;
    var key = event.key || event.code || "";
    var isEnter = key === "Enter" || key === "NumpadEnter" || event.keyCode === 13;
    if (!isEnter || !(event.metaKey || event.ctrlKey)) return false;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    if (!isWritePage || state.padSaving || state.padAsking) return true;
    if (!padBody().trim()) return true;
    try {
      if (window.tinkerAnalytics && typeof window.tinkerAnalytics.keepCrafting === "function") {
        window.tinkerAnalytics.keepCrafting();
      }
    } catch (e) { /* ignore */ }
    keepCraftingPad();
    return true;
  }

  function setPadMarkdown(md, opts) {
    renderPadFromMarkdown(md == null ? "" : String(md), opts || {});
  }

  function isEssayReadMode() {
    var story = selectedStory();
    return !!(story && !story.isNew && essayRead && els.essayView);
  }

  function clearEssayViewNode() {
    if (!els.essayView) return;
    while (els.essayView.firstChild) {
      els.essayView.removeChild(els.essayView.firstChild);
    }
  }

  function hideEssayReadView() {
    if (els.essayView) {
      els.essayView.hidden = true;
      clearEssayViewNode();
    }
    if (els.pad) els.pad.hidden = false;
    if (els.body) els.body.hidden = false;
    state.essayReadMount = null;
    state.essayReadStoryId = null;
    if (els.surface) els.surface.classList.remove("repo-surface--reading");
  }

  function showEssayReadView(story) {
    if (!els.essayView || !essayRead || !story) {
      hideEssayReadView();
      return;
    }
    state.keepFinishedWriting = false;
    var markdown = story.markdown != null ? String(story.markdown) : String(story.body || "");
    els.essayView.hidden = false;
    if (els.pad) els.pad.hidden = true;
    if (els.body) els.body.hidden = true;
    setPadActionsVisible(false);
    if (els.surface) els.surface.classList.add("repo-surface--reading");

    // Fresh essay open: toggle always off (do not persist across essays).
    if (!state.essayReadMount || state.essayReadStoryId !== story.id) {
      state.essayReadStoryId = story.id;
      state.essayReadMount = essayRead.mount(els.essayView, {
        markdown: markdown,
        showQuestions: false,
      });
    } else if (state.essayReadMount && typeof state.essayReadMount.setMarkdown === "function") {
      // Same story re-render (tree refresh): keep toggle state for this essay only.
      var keep = state.essayReadMount.getShowQuestions
        ? state.essayReadMount.getShowQuestions()
        : false;
      state.essayReadMount.setMarkdown(markdown);
      if (keep && typeof state.essayReadMount.setShowQuestions === "function") {
        state.essayReadMount.setShowQuestions(true);
      }
    }

    // Keep the mirror in sync so save/export paths still see the bytes.
    if (els.body && els.body.value !== markdown) els.body.value = markdown;
  }

  function firstLineTitle(text) {
    var lines = String(text || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i += 1) {
      var line = String(lines[i] || "").trim().replace(/^#\s*/, "");
      if (line) return line.slice(0, 120);
    }
    return "Untitled";
  }

  function ensureDraftFromPad() {
    var story = selectedStory();
    if (story) return story;
    if (!isWritePage) return null;
    var body = padBody();
    state.pieceCounter += 1;
    var now = new Date();
    var folderId = state.selectedFolderId || null;
    var draft = {
      id: "draft-new-" + state.pieceCounter,
      title: firstLineTitle(body),
      body: body,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      fileName: md.storyDate(now) + "-" + md.slugifyTitle(firstLineTitle(body)) + ".md",
      folderId: folderId,
      contentType: folderId
        ? core.normalizeContentType((core.folderById(state.folders, folderId) || {}).contentType)
        : core.DEFAULT_CONTENT_TYPE,
      markdown: body,
      isNew: true,
    };
    var used = {};
    allFiles().forEach(function (s) { used[s.fileName] = true; });
    var n = 1;
    while (used[draft.fileName]) {
      n += 1;
      draft.fileName = md.storyDate(now) + "-" + md.slugifyTitle(firstLineTitle(body)) + "-" + n + ".md";
    }
    draft.relPath = core.fileRelPath(state.folders, folderId, draft.fileName);
    if (state.currentPlace) state.places[draft.id] = state.currentPlace.slice(0, 120);
    state.draft = draft;
    state.selectedId = draft.id;
    state.selectedFolderId = folderId;
    return draft;
  }

  function clearPadIdleTimer() {
    if (state.padIdleTimer) {
      clearTimeout(state.padIdleTimer);
      state.padIdleTimer = null;
    }
  }

  function setPadActionsVisible(visible) {
    var show = !!visible && !!padBody().trim() && !state.padSaving && !state.padAsking;
    state.padActionsVisible = show;
    if (!els.padActions) return;
    if (show) els.padActions.classList.add("is-visible");
    else els.padActions.classList.remove("is-visible");
    els.padActions.setAttribute("aria-hidden", show ? "false" : "true");
    var tab = show ? 0 : -1;
    if (els.keepCrafting) {
      els.keepCrafting.tabIndex = tab;
      els.keepCrafting.disabled = !show || state.padSaving || state.padAsking || !padBody().trim();
    }
    if (els.thisIsEverything) {
      els.thisIsEverything.tabIndex = tab;
      els.thisIsEverything.disabled = !show || state.padSaving || state.padAsking || !padBody().trim();
    }
  }

  function renderFollowup() {
    // Questions are inserted into the pad; keep the legacy slot hidden.
    if (els.followup) {
      els.followup.hidden = true;
      text(els.followup, "");
    }
  }

  var padNoticeTimer = null;

  function clearPadError() {
    if (padNoticeTimer) {
      clearTimeout(padNoticeTimer);
      padNoticeTimer = null;
    }
    if (els.padError) {
      els.padError.hidden = true;
      els.padError.classList.remove("repo-pad-error--ok");
    }
    if (els.padErrorText) text(els.padErrorText, "");
    if (els.padErrorRetry) els.padErrorRetry.hidden = true;
    if (els.padErrorSignin) els.padErrorSignin.hidden = true;
  }

  function showPadError(message, opts) {
    opts = opts || {};
    if (!els.padError || !els.padErrorText) {
      state.status = message || "";
      renderSyncHint();
      return;
    }
    if (padNoticeTimer) {
      clearTimeout(padNoticeTimer);
      padNoticeTimer = null;
    }
    els.padError.classList.remove("repo-pad-error--ok");
    text(els.padErrorText, message || "Something went wrong.");
    els.padError.hidden = false;
    if (els.padErrorRetry) els.padErrorRetry.hidden = !opts.retry;
    if (els.padErrorSignin) els.padErrorSignin.hidden = !opts.signin;
    state.status = "";
    renderSyncHint();
  }

  /** Visible on the write pad (including mobile, where the sidebar sync hint is hidden). */
  function showPadNotice(message, opts) {
    opts = opts || {};
    if (!els.padError || !els.padErrorText) {
      state.status = message || "";
      renderSyncHint();
      return;
    }
    if (padNoticeTimer) {
      clearTimeout(padNoticeTimer);
      padNoticeTimer = null;
    }
    text(els.padErrorText, message || "");
    els.padError.hidden = false;
    els.padError.classList.add("repo-pad-error--ok");
    if (els.padErrorRetry) els.padErrorRetry.hidden = true;
    if (els.padErrorSignin) els.padErrorSignin.hidden = true;
    var ms = Number(opts.autoHideMs);
    if (!Number.isFinite(ms) || ms < 0) ms = 2800;
    if (ms > 0) {
      padNoticeTimer = setTimeout(function () {
        padNoticeTimer = null;
        if (els.padError && els.padError.classList.contains("repo-pad-error--ok")) {
          els.padError.hidden = true;
          els.padError.classList.remove("repo-pad-error--ok");
          if (els.padErrorText) text(els.padErrorText, "");
        }
      }, ms);
    }
  }

  function syncPadFromDom() {
    var story = selectedStory();
    var value = padBody();
    if (!story && value.trim()) story = ensureDraftFromPad();
    if (story) {
      story.markdown = value;
      story.body = value;
      story.updatedAt = new Date().toISOString();
      if (!story.isNew) story.dirty = true;
    }
  }

  // Questions persist as Markdown blockquotes in the same pad document.
  function extractAskedQuestions(text) {
    var asked = [];
    var seen = {};
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var m = String(line || "").match(/^>\s+(.+?)\s*$/);
      if (!m) return;
      var q = m[1].replace(/\s+/g, " ").trim();
      if (!q) return;
      var key = q.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      asked.push(q);
    });
    return asked;
  }

  function questionAlreadyInPad(question, text) {
    var key = String(question || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) return true;
    return extractAskedQuestions(text).some(function (q) {
      return q.toLowerCase() === key;
    });
  }

  function insertQuestionInline(question) {
    if (!els.body && !els.pad) return "";
    var q = String(question || "").replace(/\s+/g, " ").trim();
    if (!q) return "";
    syncMirrorFromPadDom();
    var current = padBody().replace(/\s+$/g, "");
    if (questionAlreadyInPad(q, current)) return current;
    var block = (current ? current + "\n\n" : "") + "> " + q + "\n\n";
    setPadMarkdown(block, { focusEnd: true });
    if (els.body) {
      try {
        els.body.selectionStart = els.body.selectionEnd = block.length;
      } catch (e) { /* ignore */ }
    }
    state.followupQuestion = q;
    syncPadFromDom();
    renderFollowup();
    return block;
  }

  function medianGapMs() {
    if (!padReveal || typeof padReveal.median !== "function") return 0;
    var med = padReveal.median(state.keystrokeGaps);
    return med == null ? 0 : Math.round(med);
  }

  function resolveRevealDelayMs() {
    if (state.padIdleMsOverride != null && Number.isFinite(state.padIdleMsOverride)) {
      return Math.max(0, state.padIdleMsOverride);
    }
    if (padReveal && typeof padReveal.computeRevealDelayMs === "function") {
      return padReveal.computeRevealDelayMs(state.keystrokeGaps);
    }
    return 1500;
  }

  function emitPadActionsRevealed(delayMs, medianMs) {
    try {
      if (window.tinkerAnalytics && typeof window.tinkerAnalytics.padActionsRevealed === "function") {
        window.tinkerAnalytics.padActionsRevealed(delayMs, medianMs);
      }
    } catch (e) { /* ignore */ }
  }

  function bumpPadTypingIdle() {
    if (!isWritePage) return;
    clearPadIdleTimer();
    setPadActionsVisible(false);
    if (!padBody().trim()) return;
    if (state.keepFinishedWriting) state.keepFinishedWriting = false;
    var delay = resolveRevealDelayMs();
    var med = medianGapMs();
    state.lastRevealDelayMs = delay;
    state.lastMedianGapMs = med;
    state.padIdleTimer = setTimeout(function () {
      state.padIdleTimer = null;
      setPadActionsVisible(true);
      if (state.padActionsVisible) {
        emitPadActionsRevealed(state.lastRevealDelayMs, state.lastMedianGapMs);
      }
    }, delay);
  }

  function onPadTypingKey(event) {
    if (!isWritePage) return;
    var typing = padReveal && typeof padReveal.isTypingKey === "function"
      ? padReveal.isTypingKey(event)
      : !!(event && event.key && event.key.length === 1 && !event.metaKey && !event.ctrlKey);
    var reset = padReveal && typeof padReveal.isRevealResetKey === "function"
      ? padReveal.isRevealResetKey(event)
      : true;
    if (typing && padReveal && typeof padReveal.recordGap === "function") {
      var next = padReveal.recordGap(state.keystrokeGaps, state.lastKeystrokeAt, Date.now());
      state.keystrokeGaps = next.gaps;
      state.lastKeystrokeAt = next.lastAt;
    } else if (typing) {
      state.lastKeystrokeAt = Date.now();
    }
    if (!reset) return;
    if (padBody().trim()) bumpPadTypingIdle();
    else setPadActionsVisible(false);
  }

  function onBodyInput() {
    var story = selectedStory();
    var value = padBody();
    if (!story && value.trim()) {
      story = ensureDraftFromPad();
      if (story) {
        text(els.filePath, md.displayTitle(story));
        if (els.fileType) {
          els.fileType.hidden = false;
          text(els.fileType, "Type: " + core.contentTypeLabel(story.contentType || core.DEFAULT_CONTENT_TYPE));
        }
        renderPlace();
        if (els.tree) renderTree();
      }
    } else if (story) {
      story.markdown = value;
      story.body = value;
      story.title = firstLineTitle(value);
      story.updatedAt = new Date().toISOString();
      if (!story.isNew) story.dirty = true;
      if (els.filePath) text(els.filePath, md.displayTitle(story));
    }
    bumpPadTypingIdle();
  }

  function readLocalEssays() {
    try {
      var raw = window.localStorage.getItem(ESSAYS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocalEssays(list) {
    try {
      window.localStorage.setItem(ESSAYS_KEY, JSON.stringify(list || []));
    } catch (e) { /* ignore */ }
  }

  function fetchEssays() {
    return fetch("/api/user-data/essays", { headers: authHeaders() }).then(function (res) {
      if (res.status === 401) return null;
      if (!res.ok) return readLocalEssays();
      return res.json().then(function (json) {
        return Array.isArray(json && json.data) ? json.data : readLocalEssays();
      }).catch(function () { return readLocalEssays(); });
    }).catch(function () { return readLocalEssays(); });
  }

  function putEssays(list) {
    writeLocalEssays(list);
    return fetch("/api/user-data/essays", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ data: list }),
    }).then(function (res) {
      return { ok: res.ok, status: res.status };
    }).catch(function () {
      return { ok: false, status: 0 };
    });
  }

  /**
   * After a successful This is everything:
   * - Desktop: keep the typed conversation on screen (no handoff chrome).
   * - Mobile (≤800px): open the essays list (same .repo-right tree).
   */
  function finishWritingAfterSave() {
    state.draft = null;
    state.selectedId = null;
    state.selectedFolderId = null;
    state.followupQuestion = "";
    state.followupAsked = [];
    state.status = "";
    clearPadError();
    clearPadIdleTimer();
    state.padActionsVisible = false;
    hideEssayReadView();
    setPadActionsVisible(false);
    if (isPhoneWriteWidth()) {
      state.keepFinishedWriting = false;
      if (els.body && !padHasFocus()) setPadMarkdown("");
      setMobileEssayList(true);
    } else {
      state.keepFinishedWriting = true;
      setMobileEssayList(false);
    }
    render();
  }

    function storyFromEssay(essay, folderId) {
    var title = essay.title || firstLineTitle(essay.body || "");
    var createdAt = essay.createdAt
      ? (typeof essay.createdAt === "number" ? new Date(essay.createdAt).toISOString() : String(essay.createdAt))
      : new Date().toISOString();
    var fileName = md.storyFileName({ title: title, createdAt: createdAt, updatedAt: createdAt });
    return {
      id: essay.id,
      title: title,
      body: essay.body || "",
      createdAt: createdAt,
      updatedAt: createdAt,
      fileName: fileName,
      folderId: folderId || null,
      contentType: core.DEFAULT_CONTENT_TYPE,
      markdown: md.storyMarkdown(title, essay.body || ""),
      isNew: false,
      relPath: core.fileRelPath(state.folders, folderId || null, fileName),
    };
  }

  function savePad() {
    if (!isWritePage || state.padSaving || state.padAsking) return Promise.resolve(null);
    var body = padBody().trim();
    if (!body) return Promise.resolve(null);
    clearPadError();
    if (!hasSessionToken()) {
      // Don't silently toast — send the owner to the phone gate with draft stashed.
      sendHomeForAuth();
      return Promise.resolve(null);
    }
    var draft = ensureDraftFromPad();
    if (!draft) {
      showPadError("Could not prepare this piece to save.", { retry: false });
      return Promise.resolve(null);
    }
    state.padSaving = true;
    setPadActionsVisible(false);
    state.status = "";
    renderSyncHint();

    var place = activePlace();
    var folderId = draft.folderId || null;
    var existingId = draft.isNew ? null : draft.id;

    return fetchEssays().then(function (list) {
      var essays = Array.isArray(list) ? list.slice() : [];
      var title = firstLineTitle(body);
      var essay;
      if (existingId) {
        var idx = -1;
        for (var i = 0; i < essays.length; i += 1) {
          if (essays[i] && essays[i].id === existingId) { idx = i; break; }
        }
        if (idx >= 0) {
          essay = Object.assign({}, essays[idx], {
            title: title,
            body: body,
            updatedAt: Date.now(),
          });
          essays[idx] = essay;
        }
      }
      if (!essay) {
        essay = {
          id: "e_" + Math.random().toString(36).slice(2, 10),
          slug: md.slugifyTitle(title) + "-" + Math.random().toString(36).slice(2, 6),
          author: "you",
          title: title,
          body: body,
          createdAt: Date.now(),
          url: "/you/" + md.slugifyTitle(title),
          sourceDraft: draft.isNew ? draft.id : null,
          kind: "essay",
          seed: place || null,
          pendingPitch: true,
        };
        essays = [essay].concat(essays);
      }
      return putEssays(essays).then(function (putResult) {
        if (!putResult || !putResult.ok) {
          state.status = "";
          renderSyncHint();
          showPadError("Could not save this piece. Try again.", { retry: false });
          return null;
        }
        var saved = storyFromEssay(essay, folderId);
        if (place) state.places[saved.id] = place.slice(0, 120);
        if (draft.isNew && state.draft && state.draft.id === draft.id) state.draft = null;
        var replaced = false;
        state.stories = state.stories.map(function (s) {
          if (s.id === saved.id || (draft.isNew && s.id === draft.id)) {
            replaced = true;
            return saved;
          }
          return s;
        });
        if (!replaced) state.stories = [saved].concat(state.stories);
        state.followupQuestion = "";
        state.status = "";
        // Keep the conversation on screen after save.
        finishWritingAfterSave();
        var placePromise = place && !isDraftId(saved.id)
          ? apiPost("set_place", { fileId: saved.id, place: place }).then(function (result) {
              if (result && result.ok && result.json && result.json.tree) applyTree(result.json.tree);
            }).catch(function () { /* ignore */ })
          : Promise.resolve();
        return placePromise.then(function () { return syncStoriesToDisk(); }).then(function () {
          return saved;
        });
      });
    }).catch(function () {
      state.status = "";
      renderSyncHint();
      showPadError("Could not save this piece. Try again.", { retry: false });
      return null;
    }).finally(function () {
      state.padSaving = false;
      // Post-save chrome owns the idle reveal; do not re-show pad actions yet.
      if (state.keepFinishedWriting) return;
      if (padBody().trim()) bumpPadTypingIdle();
    });
  }

  function keepCraftingPad() {
    if (!isWritePage || state.padSaving || state.padAsking) return Promise.resolve(null);
    var draftText = padBody().trim();
    if (!draftText) return Promise.resolve(null);
    clearPadError();

    if (!hasSessionToken()) {
      showPadError("Sign in to get follow-up questions.", { signin: true });
      return Promise.resolve(null);
    }
    if (!ensureClaudeClient()) {
      // Token is present but the Claude client never mounted — not an auth
      // failure. Asking to "Sign in" here caused the stale-token bounce loop.
      showPadError(
        "Follow-ups unavailable: Claude client (callClaude) did not load.",
        { retry: true }
      );
      return Promise.resolve(null);
    }
    var interview = window.tinkerInterview;
    if (!interview || typeof interview.buildFollowupRequest !== "function") {
      showPadError(
        "Follow-ups unavailable: interview helpers (buildFollowupRequest) did not load.",
        { retry: true }
      );
      return Promise.resolve(null);
    }

    var asked = extractAskedQuestions(padBody());
    state.followupAsked = asked.slice();
    var built = interview.buildFollowupRequest({
      draft: draftText,
      seed: activePlace() || undefined,
      priorTurns: asked.slice(),
    });
    if (built.error) {
      showPadError(built.error, { retry: true });
      return Promise.resolve(null);
    }

    state.padAsking = true;
    setPadActionsVisible(false);
    state.status = "Thinking through what to ask next…";
    renderSyncHint();

    var api = resolveTinkerApi();
    return api.callClaude({
      system: built.system,
      messages: [{ role: "user", content: built.user }],
      model: interview.KEEP_CRAFTING_MODEL || "claude-opus-4-8",
      maxTokens: 2048,
    }).then(function (result) {
      var parsed = typeof interview.parseFreeformResponse === "function"
        ? interview.parseFreeformResponse(result && result.text)
        : { questions: [] };
      var questions = Array.isArray(parsed.questions)
        ? parsed.questions.map(function (q) { return String(q || "").replace(/\s+/g, " ").trim(); }).filter(Boolean)
        : [];
      var next = "";
      for (var i = 0; i < questions.length; i += 1) {
        if (!questionAlreadyInPad(questions[i], padBody())) {
          next = questions[i];
          break;
        }
      }
      if (!next) {
        showPadError("Could not get a new follow-up question. Try again.", { retry: true });
        return null;
      }
      insertQuestionInline(next);
      state.followupAsked = extractAskedQuestions(padBody());
      state.status = "";
      renderSyncHint();
      clearPadError();
      return next;
    }).catch(function (err) {
      var msg = (err && err.message) || "Could not ask a follow-up.";
      // Only genuine auth failures get the Sign in control. 5xx / model /
      // timeout / parse errors must show Retry with the real message.
      if (isAuthFailure(err)) {
        clearAuthSession();
        showPadError("Sign in to get follow-up questions.", { signin: true });
      } else {
        showPadError(msg, { retry: true });
      }
      return null;
    }).finally(function () {
      state.padAsking = false;
      bumpPadTypingIdle();
    });
  }

  function apiGetTree() {
    return fetch("/api/repo-folders?action=list", {
      headers: authHeaders(),
    }).then(function (res) {
      if (res.status === 401) return null;
      if (!res.ok) return { folders: [], placements: {} };
      return res.json();
    });
  }

  function apiPost(action, body) {
    return fetch("/api/repo-folders?action=" + encodeURIComponent(action), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().then(function (json) {
        return { ok: res.ok, status: res.status, json: json || {} };
      }).catch(function () {
        return { ok: res.ok, status: res.status, json: {} };
      });
    });
  }

  function startCreateFolder() {
    state.creatingFolder = true;
    state.createParentId = state.selectedFolderId || null;
    state.createError = "";
    state.renamingFolderId = null;
    renderTree();
    var input = document.getElementById("repo-folder-create-name");
    if (input) {
      try { input.focus(); } catch (e) { /* ignore */ }
    }
  }

  function cancelCreateFolder() {
    state.creatingFolder = false;
    state.createError = "";
    renderTree();
  }

  function submitCreateFolder() {
    var input = document.getElementById("repo-folder-create-name");
    var select = document.getElementById("repo-folder-create-type");
    var name = input ? String(input.value || "").trim() : "";
    if (!name) {
      state.createError = "Name is required.";
      renderTree();
      return;
    }
    var parentId = state.createParentId;
    var contentType = select ? select.value : core.DEFAULT_CONTENT_TYPE;
    if (parentId) {
      var parent = core.folderById(state.folders, parentId);
      if (parent) contentType = parent.contentType;
    }
    var siblings = core.childFolders(state.folders, parentId);
    var clash = siblings.some(function (f) {
      return String(f.name).toLowerCase() === name.toLowerCase();
    });
    if (clash) {
      state.createError = "That name is already used here.";
      renderTree();
      return;
    }
    apiPost("create_folder", {
      name: name,
      parentId: parentId,
      contentType: contentType,
    }).then(function (result) {
      if (!result.ok) {
        state.createError = (result.json && result.json.error) || "Could not create folder.";
        renderTree();
        return;
      }
      state.creatingFolder = false;
      state.createError = "";
      applyTree(result.json.tree);
      if (result.json.folder) state.selectedFolderId = result.json.folder.id;
      render();
      return syncStoriesToDisk();
    }).catch(function () {
      state.createError = "Could not create folder.";
      renderTree();
    });
  }

  function startRenameFolder(folderId) {
    state.renamingFolderId = folderId;
    state.renameError = "";
    state.creatingFolder = false;
    renderTree();
    var input = document.getElementById("repo-folder-rename-name");
    if (input) {
      try { input.focus(); input.select(); } catch (e) { /* ignore */ }
    }
  }

  function cancelRenameFolder() {
    state.renamingFolderId = null;
    state.renameError = "";
    renderTree();
  }

  function submitRenameFolder() {
    var input = document.getElementById("repo-folder-rename-name");
    var name = input ? String(input.value || "").trim() : "";
    var folderId = state.renamingFolderId;
    if (!folderId) return;
    if (!name) {
      state.renameError = "Name is required.";
      renderTree();
      return;
    }
    var folder = core.folderById(state.folders, folderId);
    if (!folder) return;
    var clash = core.childFolders(state.folders, folder.parentId).some(function (f) {
      return f.id !== folderId && String(f.name).toLowerCase() === name.toLowerCase();
    });
    if (clash) {
      state.renameError = "That name is already used here.";
      renderTree();
      return;
    }
    var beforePaths = {};
    allFiles().forEach(function (s) { beforePaths[s.id] = s.relPath; });
    apiPost("rename_folder", { id: folderId, name: name }).then(function (result) {
      if (!result.ok) {
        state.renameError = (result.json && result.json.error) || "Could not rename.";
        renderTree();
        return;
      }
      state.renamingFolderId = null;
      applyTree(result.json.tree);
      render();
      return mirrorPathMoves(beforePaths).then(function () { return syncStoriesToDisk(); });
    });
  }

  function requestDeleteFolder(folderId) {
    var folder = core.folderById(state.folders, folderId);
    if (!folder) return;
    var children = core.childFolders(state.folders, folderId);
    var files = core.filesInFolder(allFiles(), state.placements, folderId);
    var hasContents = children.length > 0 || files.length > 0;
    if (!hasContents) {
      apiPost("delete_folder", { id: folderId, confirm: true }).then(function (result) {
        if (!result.ok) {
          state.status = (result.json && result.json.error) || "Could not delete folder.";
          renderSyncHint();
          return;
        }
        applyTree(result.json.tree);
        if (state.selectedFolderId === folderId) state.selectedFolderId = null;
        render();
      });
      return;
    }
    state.pendingDeleteId = folderId;
    if (els.confirmHint) {
      text(
        els.confirmHint,
        "“" + folder.name + "” has " +
          files.length + " file" + (files.length === 1 ? "" : "s") +
          (children.length ? " and nested folders" : "") +
          ". Your writing is never deleted — choose how to clear the folder."
      );
    }
    if (els.confirmSheet) els.confirmSheet.hidden = false;
  }

  function closeConfirmSheet() {
    state.pendingDeleteId = null;
    if (els.confirmSheet) els.confirmSheet.hidden = true;
  }

  function confirmDeleteFolder(deleteContents) {
    var folderId = state.pendingDeleteId;
    if (!folderId) return;
    var beforePaths = {};
    allFiles().forEach(function (s) { beforePaths[s.id] = s.relPath; });
    apiPost("delete_folder", {
      id: folderId,
      confirm: true,
      deleteContents: !!deleteContents,
    }).then(function (result) {
      closeConfirmSheet();
      if (!result.ok) {
        if (result.status === 409) {
          state.status = "Folder is not empty — confirm to continue.";
        } else {
          state.status = (result.json && result.json.error) || "Could not delete folder.";
        }
        renderSyncHint();
        return;
      }
      applyTree(result.json.tree);
      if (state.selectedFolderId === folderId) state.selectedFolderId = null;
      render();
      return mirrorPathMoves(beforePaths).then(function () { return syncStoriesToDisk(); });
    });
  }

  function openMoveSheet(fileId) {
    state.moveFileId = fileId;
    renderMoveSheet();
    if (els.moveSheet) els.moveSheet.hidden = false;
  }

  function closeMoveSheet() {
    state.moveFileId = null;
    if (els.moveSheet) els.moveSheet.hidden = true;
  }

  function renderMoveSheet() {
    if (!els.moveList) return;
    clear(els.moveList);
    var file = allFiles().find(function (s) { return s.id === state.moveFileId; });
    if (els.moveHint) {
      text(els.moveHint, file ? ("Move " + md.displayTitle(file)) : "Choose a folder");
    }

    function addOption(label, folderId, depth) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "repo-sheet__option";
      var current = file && (file.folderId || null) === (folderId || null);
      if (current) btn.className += " is-current";
      btn.style.paddingLeft = (12 + depth * 14) + "px";
      btn.textContent = label;
      btn.addEventListener("click", function () {
        moveFileTo(state.moveFileId, folderId);
      });
      els.moveList.appendChild(btn);
    }

    addOption("Top level", null, 0);

    function walk(parentId, depth) {
      core.sortByName(core.childFolders(state.folders, parentId)).forEach(function (folder) {
        addOption(folder.name, folder.id, depth);
        walk(folder.id, depth + 1);
      });
    }
    walk(null, 1);
  }

  function moveFileTo(fileId, folderId) {
    if (!fileId) return;
    if (String(fileId).indexOf("draft-new-") === 0 && state.draft && state.draft.id === fileId) {
      state.draft.folderId = folderId || null;
      state.draft.relPath = core.fileRelPath(state.folders, folderId, state.draft.fileName);
      state.draft.contentType = folderId
        ? core.normalizeContentType((core.folderById(state.folders, folderId) || {}).contentType)
        : core.DEFAULT_CONTENT_TYPE;
      closeMoveSheet();
      render();
      return;
    }
    var before = {};
    allFiles().forEach(function (s) { before[s.id] = s.relPath; });
    apiPost("move_file", { fileId: fileId, folderId: folderId }).then(function (result) {
      closeMoveSheet();
      if (!result.ok) {
        state.status = (result.json && result.json.error) || "Could not move file.";
        renderSyncHint();
        return;
      }
      applyTree(result.json.tree);
      render();
      return mirrorPathMoves(before).then(function () { return syncStoriesToDisk(); });
    });
  }

  function mirrorPathMoves(beforePaths) {
    if (!canWriteDisk() || !canMoveDisk()) return Promise.resolve();
    var root = state.location;
    var chain = Promise.resolve();
    allFiles().forEach(function (story) {
      if (story.isNew) return;
      var from = beforePaths[story.id];
      var to = story.relPath;
      if (!from || !to || from === to) return;
      chain = chain.then(function () {
        return window.tinker.moveNotesFile(root, from, to).catch(function () { return false; });
      });
    });
    return chain;
  }

  /* Writing place (Write page) + Saved in storage (Files page).
   * Place: combobox of recent/starters for where the writer is.
   * Saved in: disk/cloud roots via registerLocationSection (cloud first,
   * then Mac folder, then Custom path). No geolocation. */

  var locationSections = {};

  function registerLocationSection(spec) {
    if (!spec || !spec.key) return;
    var key = String(spec.key);
    var incoming = {
      key: key,
      label: spec.label == null ? "" : String(spec.label),
      order: typeof spec.order === "number" ? spec.order : 100,
      getOptions: typeof spec.getOptions === "function" ? spec.getOptions : function () { return []; },
      onSelect: typeof spec.onSelect === "function" ? spec.onSelect : function () {},
      _builtin: !!spec._builtin,
    };
    var prev = locationSections[key];
    if (prev && prev._builtin && !incoming._builtin) {
      // Cloud roots (incoming) first, then Mac folder / Custom path.
      locationSections[key] = {
        key: key,
        label: "",
        order: typeof spec.order === "number" ? spec.order : prev.order,
        _builtin: true,
        getOptions: function () {
          return [].concat(incoming.getOptions() || [], prev.getOptions() || []);
        },
        onSelect: function (option) {
          var id = option && option.id;
          if (id === "mac-folder" || id === "custom-path") return prev.onSelect(option);
          return incoming.onSelect(option);
        },
      };
    } else {
      locationSections[key] = incoming;
    }
    refreshLocation();
  }

  function refreshLocation() {
    if (isWritePage) renderPlace();
    if (isFilesPage) renderSavedIn();
  }

  function placeForSelectedFile() {
    var story = selectedStory();
    if (!story || !story.id) return "";
    return state.places[story.id] ? String(state.places[story.id]) : "";
  }

  // Displayed / active place: per-file when a story is open, else session place.
  function activePlace() {
    var story = selectedStory();
    if (story && story.id) {
      if (state.places[story.id]) return String(state.places[story.id]);
      // Draft/new file with no stored place yet still shows the session place.
      if (isDraftId(story.id) && state.currentPlace) return state.currentPlace;
      return "";
    }
    return state.currentPlace || "";
  }

  function isDraftId(id) {
    return String(id || "").indexOf("draft-") === 0;
  }

  function readPlacesState() {
    try {
      var raw = window.localStorage.getItem(RECENT_PLACES_KEY);
      if (!raw) return { recent: [], dismissed: [] };
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return {
          recent: parsed.map(function (item) { return String(item || "").trim(); }).filter(Boolean).slice(0, 12),
          dismissed: [],
        };
      }
      if (!parsed || typeof parsed !== "object") return { recent: [], dismissed: [] };
      var recent = Array.isArray(parsed.recent) ? parsed.recent : [];
      var dismissed = Array.isArray(parsed.dismissed) ? parsed.dismissed : [];
      return {
        recent: recent.map(function (item) { return String(item || "").trim(); }).filter(Boolean).slice(0, 12),
        dismissed: dismissed.map(function (item) { return String(item || "").trim(); }).filter(Boolean).slice(0, 24),
      };
    } catch (e) {
      return { recent: [], dismissed: [] };
    }
  }

  function writePlacesState(statePlaces) {
    try {
      var recent = ((statePlaces && statePlaces.recent) || []).slice(0, 12);
      var dismissed = ((statePlaces && statePlaces.dismissed) || []).slice(0, 24);
      window.localStorage.setItem(RECENT_PLACES_KEY, JSON.stringify({ recent: recent, dismissed: dismissed }));
    } catch (e) { /* ignore */ }
  }

  function readRecentPlaces() {
    return readPlacesState().recent;
  }

  function writeRecentPlaces(list) {
    var cur = readPlacesState();
    cur.recent = (list || []).slice(0, 12);
    writePlacesState(cur);
  }

  function pushRecentPlace(label) {
    var place = String(label || "").trim();
    if (!place) return;
    var cur = readPlacesState();
    var next = [place];
    cur.recent.forEach(function (item) {
      if (item.toLowerCase() === place.toLowerCase()) return;
      next.push(item);
    });
    cur.recent = next.slice(0, 12);
    cur.dismissed = cur.dismissed.filter(function (item) {
      return item.toLowerCase() !== place.toLowerCase();
    });
    writePlacesState(cur);
  }

  function removeSuggestedPlace(label) {
    var place = String(label || "").trim();
    if (!place) return;
    var key = place.toLowerCase();
    var cur = readPlacesState();
    cur.recent = cur.recent.filter(function (item) {
      return item.toLowerCase() !== key;
    });
    var already = false;
    cur.dismissed.forEach(function (item) {
      if (item.toLowerCase() === key) already = true;
    });
    if (!already) cur.dismissed = [place].concat(cur.dismissed).slice(0, 24);
    writePlacesState(cur);
    // Only remove from the suggestions list; leave the typed/current place alone.
    renderPlaceList();
  }

  function buildPlaceRows(query) {
    var q = String(query || "").trim().toLowerCase();
    var rows = [];
    var seen = {};
    var current = activePlace();
    var placesState = readPlacesState();
    var dismissed = {};
    placesState.dismissed.forEach(function (item) {
      dismissed[String(item || "").toLowerCase()] = true;
    });

    function addRow(label, kind) {
      var name = String(label || "").trim();
      if (!name) return;
      var key = name.toLowerCase();
      if (seen[key] || dismissed[key]) return;
      if (q && key.indexOf(q) === -1) return;
      seen[key] = true;
      rows.push({
        kind: kind || "place",
        label: name,
        selected: current.toLowerCase() === key,
        removable: kind === "recent" || kind === "starter",
      });
    }

    placesState.recent.forEach(function (item) { addRow(item, "recent"); });
    PLACE_STARTERS.forEach(function (item) { addRow(item, "starter"); });

    var typed = String(query || "").trim();
    if (typed && !seen[typed.toLowerCase()] && !dismissed[typed.toLowerCase()]) {
      rows.push({
        kind: "use",
        label: typed,
        display: 'Use "' + typed + '"',
        selected: false,
        removable: false,
      });
    }
    return rows;
  }

  function placeQueryFromInput() {
    if (!els.locationInput) return "";
    return String(els.locationInput.value || "");
  }

  function placeInputIsTyping() {
    return !!(els.locationInput && document.activeElement === els.locationInput);
  }

  // While typing, filter suggestions. Opening the chevron shows the full list.
  function placeListQuery() {
    if (placeInputIsTyping()) return placeQueryFromInput();
    return "";
  }

  function renderPlace() {
    if (!isWritePage) return;
    var place = activePlace();
    if (els.locationValue) text(els.locationValue, place || "");
    if (els.locationInput && !placeInputIsTyping()) {
      els.locationInput.value = place;
    }
    var expanded = state.locationOpen ? "true" : "false";
    if (els.locationInput) els.locationInput.setAttribute("aria-expanded", expanded);
    if (els.locationBtn) {
      els.locationBtn.setAttribute("aria-expanded", expanded);
      els.locationBtn.setAttribute("title", place ? ("Place: " + place) : "Suggested places");
    }
    if (els.locationPanel) els.locationPanel.hidden = !state.locationOpen;
    if (els.locationChoose) els.locationChoose.hidden = true;
    if (els.locationCustom) els.locationCustom.hidden = true;
    if (els.locationError) els.locationError.hidden = true;
    if (els.filePlace) {
      if (place) {
        els.filePlace.hidden = false;
        text(els.filePlace, "Place: " + place);
      } else {
        els.filePlace.hidden = true;
        text(els.filePlace, "");
      }
    }
    renderPlaceList();
  }

  function renderPlaceList() {
    if (!els.locationList) return;
    clear(els.locationList);
    var rows = buildPlaceRows(placeListQuery());
    state.placeRows = rows;
    if (state.placeActive >= rows.length) state.placeActive = Math.max(0, rows.length - 1);
    var activeId = "";

    rows.forEach(function (row, index) {
      var li = document.createElement("li");
      var id = "repo-location-opt-" + index;
      li.setAttribute("id", id);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", row.selected ? "true" : "false");
      var className = "repo-location__option";
      if (row.kind === "use") className += " repo-location__option--custom";
      if (index === state.placeActive) className += " is-active";
      li.className = className;
      if (index === state.placeActive) activeId = id;

      var check = document.createElement("span");
      check.className = "repo-location__check";
      check.setAttribute("aria-hidden", "true");
      text(check, row.selected ? "\u2713" : "");
      li.appendChild(check);

      var name = document.createElement("span");
      name.className = "repo-location__option-name";
      text(name, row.display || row.label);
      li.appendChild(name);

      if (row.removable) {
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "repo-location__remove";
        removeBtn.setAttribute("aria-label", "Remove " + row.label);
        removeBtn.textContent = "\u00d7";
        removeBtn.addEventListener("mousedown", function (event) {
          if (event && event.preventDefault) event.preventDefault();
          if (event && event.stopPropagation) event.stopPropagation();
        });
        removeBtn.addEventListener("click", function (event) {
          if (event && event.preventDefault) event.preventDefault();
          if (event && event.stopPropagation) event.stopPropagation();
          removeSuggestedPlace(row.label);
        });
        li.appendChild(removeBtn);
      }

      li.addEventListener("mousedown", function (event) {
        if (event && event.preventDefault) event.preventDefault();
      });
      li.addEventListener("click", function (event) {
        if (event && event.target && event.target.closest && event.target.closest(".repo-location__remove")) {
          return;
        }
        if (event && event.stopPropagation) event.stopPropagation();
        choosePlace(row.label);
      });
      li.addEventListener("mousemove", function () {
        if (state.placeActive === index) return;
        setPlaceActive(index);
      });
      els.locationList.appendChild(li);
    });

    if (els.locationList) {
      els.locationList.setAttribute("role", "listbox");
      if (activeId) els.locationList.setAttribute("aria-activedescendant", activeId);
      else els.locationList.removeAttribute("aria-activedescendant");
    }
  }

  function setPlaceActive(index) {
    var rows = state.placeRows || [];
    if (!rows.length) return;
    var next = Math.max(0, Math.min(rows.length - 1, index));
    state.placeActive = next;
    var items = els.locationList ? els.locationList.children || [] : [];
    for (var i = 0; i < items.length; i += 1) {
      var node = items[i];
      if (!node || !node.className || String(node.className).indexOf("repo-location__option") === -1) continue;
      var base = String(node.className || "").replace(/\s*is-active\b/g, "");
      var isActive = node.id === "repo-location-opt-" + next;
      node.className = isActive ? base + " is-active" : base;
    }
    if (els.locationList) els.locationList.setAttribute("aria-activedescendant", "repo-location-opt-" + next);
    var active = document.getElementById("repo-location-opt-" + next);
    if (active && typeof active.scrollIntoView === "function") {
      try { active.scrollIntoView({ block: "nearest" }); } catch (e) { /* ignore */ }
    }
  }

  function movePlaceActive(delta) {
    var rows = state.placeRows || [];
    if (!rows.length) return;
    var next = state.placeActive + delta;
    if (next < 0) next = rows.length - 1;
    if (next >= rows.length) next = 0;
    setPlaceActive(next);
  }

  function togglePlacePanel(force) {
    var open = typeof force === "boolean" ? force : !state.locationOpen;
    state.locationOpen = open;
    if (open) {
      // Chevron open shows the full list; typing filters separately.
      state.placeRows = buildPlaceRows("");
      var idx = 0;
      for (var i = 0; i < state.placeRows.length; i += 1) {
        if (state.placeRows[i].selected) {
          idx = i;
          break;
        }
      }
      state.placeActive = idx;
    }
    renderPlace();
    if (open && els.locationList) {
      try { els.locationList.focus(); } catch (e) { /* ignore */ }
    }
  }

  function closePlacePanel(returnFocus) {
    if (!state.locationOpen) return;
    state.locationOpen = false;
    renderPlace();
    if (returnFocus && els.locationBtn) {
      try { els.locationBtn.focus(); } catch (e) { /* ignore */ }
    }
  }

  function choosePlace(label) {
    var place = String(label || "").trim().slice(0, 120);
    // Always hold as the session place so the field stays filled with no file open
    // and the next new file / first save inherits it.
    state.currentPlace = place;
    if (place) pushRecentPlace(place);

    var story = selectedStory();
    if (story && story.id) {
      if (place) state.places[story.id] = place;
      else delete state.places[story.id];
      if (!isDraftId(story.id)) {
        apiPost("set_place", { fileId: story.id, place: place || "" }).then(function (result) {
          if (result && result.ok && result.json && result.json.tree) {
            applyTree(result.json.tree);
            render();
          }
        }).catch(function () { /* ignore */ });
      }
    }

    state.locationOpen = false;
    if (els.locationInput) els.locationInput.value = place;
    render();
  }

  function commitPlaceFromInput() {
    var typed = placeQueryFromInput().trim();
    var rows = state.placeRows || [];
    var active = rows[state.placeActive];
    if (active && active.label) {
      choosePlace(active.label);
      return;
    }
    choosePlace(typed);
  }

  function onPlaceInputKey(event) {
    var key = event && event.key;
    if (key === "ArrowDown") {
      if (event.preventDefault) event.preventDefault();
      if (!state.locationOpen) togglePlacePanel(true);
      else movePlaceActive(1);
    } else if (key === "ArrowUp") {
      if (event.preventDefault) event.preventDefault();
      if (!state.locationOpen) togglePlacePanel(true);
      else movePlaceActive(-1);
    } else if (key === "Enter") {
      if (event.preventDefault) event.preventDefault();
      commitPlaceFromInput();
    } else if (key === "Escape") {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      closePlacePanel(true);
    }
  }

  function onPlaceListKey(event) {
    var key = event && event.key;
    if (key === "ArrowDown") {
      if (event.preventDefault) event.preventDefault();
      movePlaceActive(1);
    } else if (key === "ArrowUp") {
      if (event.preventDefault) event.preventDefault();
      movePlaceActive(-1);
    } else if (key === "Enter" || key === " ") {
      if (event.preventDefault) event.preventDefault();
      var row = (state.placeRows || [])[state.placeActive];
      if (row) choosePlace(row.label);
    } else if (key === "Escape") {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      closePlacePanel(true);
    } else if (key === "Tab") {
      closePlacePanel(false);
    }
  }

  function onPlaceTriggerKey(event) {
    var key = event && event.key;
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
      if (event.preventDefault) event.preventDefault();
      togglePlacePanel(true);
    } else if (key === "Escape" && state.locationOpen) {
      if (event.preventDefault) event.preventDefault();
      closePlacePanel(true);
    }
  }

  function buildSavedInRows() {
    var rows = [];
    var sections = Object.keys(locationSections).map(function (key) {
      return locationSections[key];
    }).sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });

    sections.forEach(function (section) {
      var options = [];
      try { options = section.getOptions() || []; } catch (e) { options = []; }
      if (!options.length) return;
      if (section.label) {
        rows.push({
          kind: "section",
          sectionKey: section.key,
          label: section.label,
        });
      }
      options.forEach(function (opt, i) {
        if (!opt) return;
        var optionId = opt.id == null ? section.key + "-" + i : String(opt.id);
        rows.push({
          kind: optionId === "custom-path" ? "custom" : "storage",
          sectionKey: section.key,
          optionId: optionId,
          label: String(opt.label || opt.id || "Option"),
          detail: opt.detail ? String(opt.detail) : "",
          badge: opt.badge ? String(opt.badge) : "",
          selected: !!opt.selected,
          option: opt,
          onSelect: section.onSelect,
        });
      });
    });
    return rows;
  }

  function renderSavedIn() {
    if (!isFilesPage || !els.savedInList) return;
    clear(els.savedInList);
    var rows = buildSavedInRows();
    rows.forEach(function (row, index) {
      if (row.kind === "section") {
        var heading = document.createElement("li");
        heading.className = "repo-location__section-label";
        heading.setAttribute("role", "presentation");
        text(heading, row.label);
        els.savedInList.appendChild(heading);
        return;
      }

      var li = document.createElement("li");
      var id = "repo-saved-in-opt-" + index;
      li.setAttribute("id", id);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", row.selected ? "true" : "false");
      var className = "repo-location__option";
      if (row.kind === "custom") className += " repo-location__option--custom";
      if (row.kind === "storage") className += " repo-location__option--storage";
      li.className = className;
      if (row.kind === "custom") li.setAttribute("data-location-custom", "true");
      if (row.kind === "storage") li.setAttribute("data-location-storage", row.optionId || "");

      var check = document.createElement("span");
      check.className = "repo-location__check";
      check.setAttribute("aria-hidden", "true");
      text(check, row.selected ? "\u2713" : "");
      li.appendChild(check);

      var name = document.createElement("span");
      name.className = "repo-location__option-name";
      text(name, row.label);
      li.appendChild(name);

      if (row.badge) {
        var badge = document.createElement("span");
        badge.className = "repo-location__option-badge";
        text(badge, row.badge);
        li.appendChild(badge);
      }
      if (row.detail) {
        var detail = document.createElement("span");
        detail.className = "repo-location__option-detail";
        text(detail, row.detail);
        li.appendChild(detail);
      }

      li.addEventListener("click", function (event) {
        if (event && event.stopPropagation) event.stopPropagation();
        chooseSavedInRow(row);
      });
      els.savedInList.appendChild(li);
    });

    if (els.savedInCustom) els.savedInCustom.hidden = !state.savedInCustom;
    if (els.savedInError) {
      els.savedInError.hidden = !state.savedInError;
      text(els.savedInError, state.savedInError || "");
    }
    if (els.locationChoose) {
      els.locationChoose.hidden = true;
      text(els.locationChoose, state.location ? "Mac folder: " + shortenPath(state.location) : "Mac folder\u2026");
    }
  }

  function openSavedInCustom() {
    if (!canUseCustomPath()) {
      state.savedInError = "Custom paths need the desktop app.";
      state.savedInCustom = true;
      renderSavedIn();
      return;
    }
    state.savedInCustom = true;
    state.savedInError = "";
    renderSavedIn();
    if (els.savedInInput) {
      var selected = selectedStorageInfo();
      var seed = "";
      if (selected && selected.id === "custom" && selected.label) seed = selected.label;
      else if (selected && selected.id === "custom" && selected.path) seed = formatUserPath(selected.path);
      else if (state.location && isCustomPathSelected()) seed = formatUserPath(state.location);
      els.savedInInput.value = seed;
      try { els.savedInInput.focus(); } catch (e) { /* ignore */ }
      try { if (els.savedInInput.select) els.savedInInput.select(); } catch (e) { /* ignore */ }
    }
  }

  function chooseSavedInRow(row) {
    if (!row || row.kind === "section") return;
    if (row.kind === "custom" || row.optionId === "custom-path") {
      openSavedInCustom();
      return;
    }
    state.savedInCustom = false;
    state.savedInError = "";
    if (row.kind === "storage") {
      try { row.onSelect(row.option || row); } catch (e) { /* ignore */ }
    }
    renderSavedIn();
  }

  function saveSavedInCustomPath() {
    if (!els.savedInInput || state.savedInSaving) return Promise.resolve();
    if (!canUseCustomPath()) {
      state.savedInError = "Custom paths need the desktop app.";
      renderSavedIn();
      return Promise.resolve();
    }
    var raw = String(els.savedInInput.value || "").trim();
    if (!raw) {
      state.savedInCustom = false;
      state.savedInError = "";
      renderSavedIn();
      return Promise.resolve();
    }
    state.savedInSaving = true;
    state.savedInError = "";
    renderSavedIn();
    return window.tinker.useCustomStoragePath(raw).then(function (result) {
      state.savedInSaving = false;
      if (!result || result.error || !result.path) {
        state.savedInCustom = true;
        state.savedInError = (result && result.error) || "Could not use that path.";
        renderSavedIn();
        return null;
      }
      applyPhysicalRoot({
        id: result.id || "custom",
        label: result.label || formatUserPath(result.path),
        name: result.name || "Tinker",
        path: result.path,
        kind: "electron",
      });
      return syncStoriesToDisk();
    }).catch(function (err) {
      state.savedInSaving = false;
      state.savedInCustom = true;
      state.savedInError = (err && err.message) || "Could not save location.";
      renderSavedIn();
    });
  }

  function chooseLocationFolder() {
    if (!canPickFolder()) return;
    window.tinker.pickNotesFolder().then(function (picked) {
      if (!picked || !picked.path) return;
      applyPhysicalRoot({
        id: "mac-folder",
        label: picked.name || formatUserPath(picked.path),
        name: picked.name || "Tinker",
        path: picked.path,
        kind: "electron",
      });
    }).catch(function () { /* cancelled */ });
  }

  // Built-in Saved in options: Mac folder + typed Custom path (desktop IPC).
  // Cloud roots / Choose folder merge in via storage-section.js.
  registerLocationSection({
    key: "storage",
    label: "",
    order: 100,
    _builtin: true,
    getOptions: function () {
      var options = [];
      if (canPickFolder()) {
        options.push({
          id: "mac-folder",
          label: "Mac folder\u2026",
          detail: isMacFolderSelected() && state.location ? formatUserPath(state.location) : "",
          selected: isMacFolderSelected() && !isCustomPathSelected(),
        });
      }
      if (canUseCustomPath()) {
        options.push({
          id: "custom-path",
          label: "Custom path\u2026",
          detail: isCustomPathSelected() && state.location ? formatUserPath(state.location) : "",
          selected: isCustomPathSelected(),
        });
      }
      return options;
    },
    onSelect: function (option) {
      if (!option) return;
      if (option.id === "mac-folder") chooseLocationFolder();
      else if (option.id === "custom-path") openSavedInCustom();
    },
  });

  function appendCreateForm(parent, parentId) {
    var wrap = document.createElement("div");
    wrap.className = "repo-tree__inline";
    wrap.setAttribute("data-folder-create", "true");

    var row = document.createElement("div");
    row.className = "repo-tree__inline-row";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "repo-tree__inline-input";
    input.id = "repo-folder-create-name";
    input.placeholder = "Folder name";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Folder name");
    row.appendChild(input);

    var parentFolder = parentId ? core.folderById(state.folders, parentId) : null;
    var select = document.createElement("select");
    select.className = "repo-tree__inline-select";
    select.id = "repo-folder-create-type";
    select.setAttribute("aria-label", "Content type");
    core.CONTENT_TYPES.forEach(function (type) {
      var opt = document.createElement("option");
      opt.value = type;
      opt.textContent = core.contentTypeLabel(type);
      select.appendChild(opt);
    });
    if (parentFolder) {
      select.value = core.normalizeContentType(parentFolder.contentType);
      select.disabled = true;
    } else {
      select.value = core.DEFAULT_CONTENT_TYPE;
    }
    row.appendChild(select);

    var err = document.createElement("p");
    err.className = "repo-tree__inline-error";
    err.id = "repo-folder-create-error";
    if (state.createError) err.textContent = state.createError;
    else err.hidden = true;
    row.appendChild(err);

    wrap.appendChild(row);
    parent.appendChild(wrap);

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        submitCreateFolder();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelCreateFolder();
      }
    });
  }

  function appendRenameForm(parent, folder) {
    var wrap = document.createElement("div");
    wrap.className = "repo-tree__inline";
    var input = document.createElement("input");
    input.type = "text";
    input.className = "repo-tree__inline-input";
    input.id = "repo-folder-rename-name";
    input.value = folder.name;
    input.setAttribute("aria-label", "Rename folder");
    wrap.appendChild(input);
    var err = document.createElement("p");
    err.className = "repo-tree__inline-error";
    if (state.renameError) err.textContent = state.renameError;
    else err.hidden = true;
    wrap.appendChild(err);
    parent.appendChild(wrap);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        submitRenameFolder();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelRenameFolder();
      }
    });
  }

  function renderFileRow(list, story) {
    var li = document.createElement("li");
    var row = document.createElement("div");
    row.className = "repo-tree__piece-row";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "repo-tree__piece";
    btn.setAttribute("role", "treeitem");
    btn.setAttribute("data-story-id", story.id);
    btn.setAttribute("draggable", "true");
    if (state.selectedId === story.id) btn.className += " is-selected";
    var label = md.displayTitle(story);
    btn.textContent = label;
    btn.title = label;
    btn.addEventListener("click", function () {
      selectStory(story.id);
    });
    btn.addEventListener("dragstart", function (event) {
      state.dragFileId = story.id;
      try {
        event.dataTransfer.setData("text/plain", story.id);
        event.dataTransfer.effectAllowed = "move";
      } catch (e) { /* ignore */ }
    });
    btn.addEventListener("dragend", function () {
      state.dragFileId = null;
    });
    row.appendChild(btn);

    var moveBtn = document.createElement("button");
    moveBtn.type = "button";
    moveBtn.className = "repo-tree__icon-btn";
    moveBtn.setAttribute("aria-label", "Move to folder");
    moveBtn.textContent = "Move";
    moveBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      openMoveSheet(story.id);
    });
    row.appendChild(moveBtn);

    li.appendChild(row);

    list.appendChild(li);
  }

  function renderFolderNode(container, folder, depth) {
    var open = !state.collapsed[folder.id];
    var wrap = document.createElement("div");
    wrap.className = "repo-tree__folder";
    wrap.setAttribute("data-open", open ? "true" : "false");
    wrap.setAttribute("data-folder-id", folder.id);
    wrap.setAttribute("role", "treeitem");
    wrap.setAttribute("aria-expanded", open ? "true" : "false");

    if (state.renamingFolderId === folder.id) {
      appendRenameForm(wrap, folder);
      container.appendChild(wrap);
      return;
    }

    var row = document.createElement("div");
    row.className = "repo-tree__folder-row";

    var folderBtn = document.createElement("button");
    folderBtn.type = "button";
    folderBtn.className = "repo-tree__folder-btn";
    if (state.selectedFolderId === folder.id) folderBtn.className += " is-selected";
    folderBtn.setAttribute("data-folder-id", folder.id);

    var chevron = document.createElement("button");
    chevron.type = "button";
    chevron.className = "repo-tree__chevron";
    chevron.setAttribute("aria-label", open ? "Collapse folder" : "Expand folder");
    chevron.textContent = open ? "▾" : "▸";
    chevron.addEventListener("click", function (event) {
      event.stopPropagation();
      toggleCollapsed(folder.id);
    });
    folderBtn.appendChild(chevron);

    var name = document.createElement("span");
    name.className = "repo-tree__folder-name";
    name.textContent = folder.name;
    folderBtn.appendChild(name);

    var type = document.createElement("span");
    type.className = "repo-tree__type";
    type.textContent = core.contentTypeLabel(folder.contentType);
    folderBtn.appendChild(type);

    folderBtn.addEventListener("click", function () {
      selectFolder(folder.id);
      if (state.collapsed[folder.id]) {
        state.collapsed[folder.id] = false;
        renderTree();
      }
    });
    folderBtn.addEventListener("dragover", function (event) {
      event.preventDefault();
      folderBtn.className = folderBtn.className.replace(" is-drop", "") + " is-drop";
    });
    folderBtn.addEventListener("dragleave", function () {
      folderBtn.className = folderBtn.className.replace(" is-drop", "");
    });
    folderBtn.addEventListener("drop", function (event) {
      event.preventDefault();
      folderBtn.className = folderBtn.className.replace(" is-drop", "");
      var fileId = state.dragFileId;
      try { fileId = event.dataTransfer.getData("text/plain") || fileId; } catch (e) { /* ignore */ }
      if (fileId) moveFileTo(fileId, folder.id);
    });
    row.appendChild(folderBtn);

    var menuWrap = document.createElement("div");
    menuWrap.className = "repo-tree__more";
    var menuOpen = state.openMenuFolderId === folder.id;
    var menuId = "repo-folder-menu-" + folder.id;

    var moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "repo-tree__icon-btn repo-tree__more-btn";
    moreBtn.setAttribute("aria-label", "More folder actions");
    moreBtn.setAttribute("aria-haspopup", "menu");
    moreBtn.setAttribute("aria-expanded", menuOpen ? "true" : "false");
    moreBtn.setAttribute("aria-controls", menuId);
    moreBtn.textContent = "⋯";
    moreBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      state.openMenuFolderId = menuOpen ? null : folder.id;
      renderTree();
      if (!menuOpen) {
        var first = document.querySelector("#" + menuId + " [role='menuitem']");
        if (first) first.focus();
      }
    });
    menuWrap.appendChild(moreBtn);

    var pop = document.createElement("ul");
    pop.className = "repo-tree__more-pop";
    pop.id = menuId;
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-label", "Folder actions");
    if (!menuOpen) pop.hidden = true;

    var renameItem = document.createElement("li");
    renameItem.setAttribute("role", "none");
    var renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "repo-tree__more-item";
    renameBtn.setAttribute("role", "menuitem");
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      state.openMenuFolderId = null;
      startRenameFolder(folder.id);
    });
    renameItem.appendChild(renameBtn);
    pop.appendChild(renameItem);

    var deleteItem = document.createElement("li");
    deleteItem.setAttribute("role", "none");
    var deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "repo-tree__more-item repo-tree__more-item--danger";
    deleteBtn.setAttribute("role", "menuitem");
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      state.openMenuFolderId = null;
      requestDeleteFolder(folder.id);
    });
    deleteItem.appendChild(deleteBtn);
    pop.appendChild(deleteItem);

    menuWrap.appendChild(pop);
    row.appendChild(menuWrap);

    wrap.appendChild(row);

    var list = document.createElement("ul");
    list.className = "repo-tree__pieces";
    list.setAttribute("role", "group");

    if (state.creatingFolder && state.createParentId === folder.id) {
      var createLi = document.createElement("li");
      appendCreateForm(createLi, folder.id);
      list.appendChild(createLi);
    }

    core.sortByName(core.childFolders(state.folders, folder.id)).forEach(function (child) {
      var childLi = document.createElement("li");
      renderFolderNode(childLi, child, depth + 1);
      list.appendChild(childLi);
    });

    core.filesInFolder(allFiles(), state.placements, folder.id).forEach(function (story) {
      renderFileRow(list, story);
    });

    wrap.appendChild(list);
    container.appendChild(wrap);
  }

  function renderTree() {
    clear(els.tree);
    var files = allFiles();
    var hasFolders = state.folders.length > 0;
    if (els.empty) {
      els.empty.hidden = files.length > 0 || hasFolders || state.creatingFolder;
    }
    if (!els.tree) return;

    if (state.creatingFolder && !state.createParentId) {
      appendCreateForm(els.tree, null);
    }

    core.sortByName(core.childFolders(state.folders, null)).forEach(function (folder) {
      renderFolderNode(els.tree, folder, 0);
    });

    var rootFiles = core.filesInFolder(files, state.placements, null);
    if (rootFiles.length) {
      var list = document.createElement("ul");
      list.className = "repo-tree__pieces";
      list.style.paddingLeft = "0";
      rootFiles.forEach(function (story) {
        renderFileRow(list, story);
      });
      els.tree.appendChild(list);
    }
  }

  if (els.tree) {
    els.tree.addEventListener("dragover", function (event) {
      if (!state.dragFileId) return;
      event.preventDefault();
    });
    els.tree.addEventListener("drop", function (event) {
      if (!state.dragFileId) return;
      var onFolder = event.target && event.target.closest && event.target.closest("[data-folder-id]");
      if (onFolder) return;
      event.preventDefault();
      moveFileTo(state.dragFileId, null);
    });
  }

  document.addEventListener("click", function (event) {
    if (!state.openMenuFolderId) return;
    var target = event.target;
    if (target && target.closest && target.closest(".repo-tree__more")) return;
    state.openMenuFolderId = null;
    renderTree();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !state.openMenuFolderId) return;
    state.openMenuFolderId = null;
    renderTree();
  });

  function renderCenter() {
    if (!els.body && !els.pad && !els.essayView) return;
    if (els.body) els.body.disabled = false;
    var story = selectedStory();
    if (!story) {
      hideEssayReadView();
      // Keep just-finished writing on screen until the owner types or picks another essay.
      if (!state.keepFinishedWriting && !padHasFocus()) setPadMarkdown("");
      text(els.filePath, "");
      if (els.fileType) {
        els.fileType.hidden = true;
        text(els.fileType, "");
      }
      return;
    }
    if (!story.isNew && essayRead && els.essayView) {
      showEssayReadView(story);
    } else {
      hideEssayReadView();
      if (!padHasFocus()) {
        setPadMarkdown(story.markdown || "");
      }
    }
    text(els.filePath, md.displayTitle(story));
    if (els.fileType) {
      els.fileType.hidden = false;
      text(els.fileType, "Type: " + core.contentTypeLabel(story.contentType || core.DEFAULT_CONTENT_TYPE));
    }
  }

  function renderSyncHint() {
    if (!els.syncHint) return;
    if (state.status) {
      els.syncHint.hidden = false;
      text(els.syncHint, state.status);
    } else {
      els.syncHint.hidden = true;
      text(els.syncHint, "");
    }
  }

  function render() {
    // No on-screen wordmark; #repo-name stays hidden for harness/id stability.
    if (els.name && els.name.hidden) text(els.name, "tinker");
    if (els.branch) text(els.branch, isFilesPage ? "files" : "writing");
    renderAuthChrome();
    if (isFilesPage) {
      renderTree();
      renderSavedIn();
    }
    if (isWritePage) {
      // Structure sidebar on desktop write — same tree as /repo/files.
      if (els.tree) renderTree();
      renderCenter();
      renderPlace();
      renderFollowup();
      renderSyncHint();
      if (isEssayReadMode()) setPadActionsVisible(false);
      else setPadActionsVisible(state.padActionsVisible && !!padBody().trim());
    }
  }

  function readQueryParam(name) {
    try {
      return new URLSearchParams(window.location.search || "").get(name) || "";
    } catch (e) {
      return "";
    }
  }

  function applyWriteQuery() {
    if (!isWritePage) return;
    var folderId = readQueryParam("folder");
    if (folderId) state.selectedFolderId = folderId;
    if (readQueryParam("new") === "1") {
      addNewFile();
      return;
    }
    var fileId = readQueryParam("file");
    if (fileId) selectStory(fileId);
  }

  function syncStoriesToDisk() {
    if (!canWriteDisk()) return Promise.resolve({ wrote: 0, skipped: 0 });
    var adapter = activeStorageAdapter();
    if (!adapter) return Promise.resolve({ wrote: 0, skipped: 0 });
    return adapter.list().then(function (listed) {
      var byPath = Object.create(null);
      (listed || []).forEach(function (row) {
        if (row && row.relPath) byPath[String(row.relPath).replace(/\\/g, "/")] = row.text;
      });
      state.localFiles = byPath;
      var wrote = 0;
      var skipped = 0;
      var chain = Promise.resolve();
      state.stories.forEach(function (story) {
        chain = chain.then(function () {
          var local = byPath[story.relPath];
          if (local != null && !md.shouldWriteStoryFile(local, story.markdown)) {
            skipped += 1;
            return null;
          }
          if (!md.needsStoryFileWrite(local, story.markdown)) return null;
          return adapter.write(story.relPath, story.markdown).then(function () {
            wrote += 1;
          });
        });
      });
      // Mirror folders as real directories (one placeholder write per folder/session).
      state.folders.forEach(function (folder) {
        chain = chain.then(function () {
          if (state.mirroredFolders[folder.id]) return null;
          var dir = core.folderRelDir(state.folders, folder.id);
          var marker = dir + "/.tinker-folder";
          return adapter.write(marker, folder.contentType + "\n").then(function () {
            state.mirroredFolders[folder.id] = true;
          });
        });
      });
      return chain.then(function () {
        state.status = skipped
          ? "Wrote " + wrote + ", skipped " + skipped + " differing"
          : (wrote ? "Wrote " + wrote + " file" + (wrote === 1 ? "" : "s") : "");
        renderSyncHint();
        return { wrote: wrote, skipped: skipped };
      });
    }).catch(function () {
      state.status = "";
      renderSyncHint();
      return { wrote: 0, skipped: 0 };
    });
  }

  function loadStories() {
    var t = token();
    if (!t) {
      // Stay on /repo so the pad remains usable while signed out. Keep
      // crafting and cloud save surface an inline Sign in control instead
      // of bouncing to the legacy shell with no return path on the pad.
      state.stories = [];
      applyTree({ folders: [], placements: {} });
      render();
      return Promise.resolve();
    }
    return Promise.all([
      fetch("/api/self-reflections?action=list&limit=200", {
        headers: { Authorization: "Bearer " + t, Accept: "application/json" },
      }).then(function (res) {
        if (res.status === 401) return { auth: false };
        if (!res.ok) return { auth: true, reflections: [] };
        return res.json().then(function (json) {
          return { auth: true, reflections: json.reflections || [] };
        });
      }),
      apiGetTree(),
    ]).then(function (parts) {
      var storiesRes = parts[0];
      var tree = parts[1];
      if (!storiesRes || storiesRes.auth === false) {
        try { window.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
        // Keep the pad; ask for sign-in when the owner tries Keep crafting.
        state.stories = [];
        applyTree({ folders: [], placements: {} });
        render();
        return null;
      }
      if (tree) applyTree(tree);
      else applyTree({ folders: [], placements: {} });
      var rows = Array.isArray(storiesRes.reflections) ? storiesRes.reflections : [];
      state.stories = md.uniqueStoryFiles(rows).map(function (story) {
        var folderId = story.folderId || state.placements[story.id] || null;
        if (rows) {
          var src = rows.find(function (r) { return r && r.id === story.id; });
          if (src && src.folderId) folderId = src.folderId;
          if (src && src.contentType) story.contentType = src.contentType;
        }
        if (folderId) state.placements[story.id] = folderId;
        var fileName = story.fileName;
        return Object.assign({}, story, {
          folderId: folderId,
          contentType: story.contentType || core.effectiveContentType(state.folders, state.placements, story.id),
          relPath: core.fileRelPath(state.folders, folderId, fileName),
        });
      });
      return fetchEssays().then(function () {
        render();
        return syncStoriesToDisk();
      });
    }).catch(function () {
      state.stories = [];
      render();
    });
  }

  if (els.newPiece) els.newPiece.addEventListener("click", addNewFile);
  if (els.sidebarNewPiece) els.sidebarNewPiece.addEventListener("click", addNewFile);
  if (els.newFolder) els.newFolder.addEventListener("click", startCreateFolder);
  if (els.signin) {
    els.signin.addEventListener("click", function (event) {
      if (event && event.preventDefault) event.preventDefault();
      sendHomeForAuth();
    });
  }
  if (els.signout) {
    els.signout.addEventListener("click", function (event) {
      if (event && event.preventDefault) event.preventDefault();
      clearAuthSession();
      try { window.localStorage.removeItem(PHONE_KEY); } catch (e) { /* ignore */ }
      renderAuthChrome();
      state.stories = [];
      applyTree({ folders: [], placements: {} });
      render();
    });
  }
  if (els.body) {
    // Mirror holds canonical Markdown (with "> "). Tests and restore write here;
    // re-render the visual pad so questions never show the raw marker.
    els.body.addEventListener("input", function (event) {
      // Mirror edits (tests / restore) always win. While a visual turn has
      // focus, skip so we don't clobber live typing — unless this event
      // itself came from the mirror.
      var fromMirror = !event || event.target === els.body;
      if (fromMirror || !padHasFocus()) {
        renderPadFromMarkdown(els.body.value || "");
      }
      onBodyInput();
    });
    els.body.addEventListener("keydown", function (event) {
      if (handleKeepCraftingShortcut(event)) return;
      onPadTypingKey(event);
    });
  }
  if (isWritePage) {
    renderPadFromMarkdown(padBody());
    syncKeepCraftingShortcutHint();
    try {
      window.addEventListener("resize", resizeAllPadTurns);
    } catch (e) { /* ignore */ }
    syncVisualViewportInset();
    try {
      window.addEventListener("resize", syncVisualViewportInset);
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", syncVisualViewportInset);
        window.visualViewport.addEventListener("scroll", syncVisualViewportInset);
      }
    } catch (eVv) { /* ignore */ }
    if (els.surface) {
      els.surface.addEventListener("click", onBlankPadActivate);
    }
  }
  if (els.keepCrafting) {
    els.keepCrafting.addEventListener("click", function (event) {
      if (event && event.preventDefault) event.preventDefault();
      if (event && event.stopPropagation) event.stopPropagation();
      try {
        if (window.tinkerAnalytics && typeof window.tinkerAnalytics.keepCrafting === "function") {
          window.tinkerAnalytics.keepCrafting();
        }
      } catch (e) { /* ignore */ }
      keepCraftingPad();
    });
  }
  if (els.thisIsEverything) {
    els.thisIsEverything.addEventListener("click", function (event) {
      if (event && event.preventDefault) event.preventDefault();
      if (event && event.stopPropagation) event.stopPropagation();
      try {
        if (window.tinkerAnalytics && typeof window.tinkerAnalytics.thisIsEverything === "function") {
          window.tinkerAnalytics.thisIsEverything();
        }
      } catch (e) { /* ignore */ }
      savePad();
    });
  }
  if (els.padActions) {
    // Fixed mobile island sits over the tall pad; keep clicks on the chrome.
    els.padActions.addEventListener("click", function (event) {
      if (event && event.stopPropagation) event.stopPropagation();
    });
  }
  if (els.padErrorRetry) {
    els.padErrorRetry.addEventListener("click", function (event) {
      if (event && event.preventDefault) event.preventDefault();
      clearPadError();
      keepCraftingPad();
    });
  }
  if (els.padErrorSignin) {
    els.padErrorSignin.addEventListener("click", function (event) {
      if (event && event.preventDefault) event.preventDefault();
      sendHomeForAuth();
    });
  }
  if (els.locationBtn) {
    els.locationBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      togglePlacePanel();
    });
    els.locationBtn.addEventListener("keydown", onPlaceTriggerKey);
  }
  if (els.locationList) {
    els.locationList.addEventListener("keydown", onPlaceListKey);
  }
  if (els.locationChoose) {
    els.locationChoose.addEventListener("click", function (event) {
      event.preventDefault();
      chooseLocationFolder();
    });
  }
  if (els.locationInput) {
    els.locationInput.addEventListener("focus", function () {
      if (state.locationOpen) return;
      state.locationOpen = true;
      state.placeActive = 0;
      renderPlace();
    });
    els.locationInput.addEventListener("input", function () {
      if (!state.locationOpen) state.locationOpen = true;
      state.placeActive = 0;
      renderPlaceList();
      if (els.locationPanel) els.locationPanel.hidden = false;
      if (els.locationBtn) els.locationBtn.setAttribute("aria-expanded", "true");
      els.locationInput.setAttribute("aria-expanded", "true");
    });
    els.locationInput.addEventListener("keydown", onPlaceInputKey);
    els.locationInput.addEventListener("blur", function () {
      // Commit typed custom place on blur (list mousedown preventDefault keeps
      // focus so option clicks do not race this).
      var typed = placeQueryFromInput().trim();
      var shown = activePlace();
      if (typed === shown) {
        if (state.locationOpen) closePlacePanel(false);
        return;
      }
      choosePlace(typed);
    });
  }
  if (els.savedInSave) {
    els.savedInSave.addEventListener("mousedown", function (event) {
      if (event && event.preventDefault) event.preventDefault();
    });
    els.savedInSave.addEventListener("click", function (event) {
      event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      saveSavedInCustomPath();
    });
  }
  if (els.savedInInput) {
    els.savedInInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        saveSavedInCustomPath();
      } else if (event.key === "Escape") {
        event.preventDefault();
        state.savedInCustom = false;
        state.savedInError = "";
        renderSavedIn();
      }
    });
  }
  if (els.moveCancel) els.moveCancel.addEventListener("click", closeMoveSheet);
  if (els.moveBackdrop) els.moveBackdrop.addEventListener("click", closeMoveSheet);
  if (els.confirmCancel) els.confirmCancel.addEventListener("click", closeConfirmSheet);
  if (els.confirmBackdrop) els.confirmBackdrop.addEventListener("click", closeConfirmSheet);
  if (els.confirmKeep) {
    els.confirmKeep.addEventListener("click", function () {
      confirmDeleteFolder(false);
    });
  }
  if (els.confirmDelete) {
    els.confirmDelete.addEventListener("click", function () {
      confirmDeleteFolder(true);
    });
  }
  document.addEventListener("click", function (event) {
    if (!state.locationOpen) return;
    var root = document.getElementById("repo-location");
    if (root && root.contains(event.target)) return;
    closePlacePanel(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (state.moveFileId) closeMoveSheet();
      if (state.pendingDeleteId) closeConfirmSheet();
      if (state.creatingFolder) cancelCreateFolder();
      if (state.renamingFolderId) cancelRenameFolder();
      if (state.locationOpen) closePlacePanel(false);
      if (state.savedInCustom) {
        state.savedInCustom = false;
        state.savedInError = "";
        renderSavedIn();
      }
    }
  });

  state.location = readStoredLocation();

  if (typeof window.addEventListener === "function") {
    window.addEventListener(STORAGE_EVENT, function (event) {
      var detail = event && event.detail;
      if (detail && detail.path) {
        setLocation(detail.path);
        return;
      }
      syncStoriesToDisk();
    });
  }

  window.tinkerRepo = {
    getLocation: getLocation,
    getPlace: getPlace,
    getStories: function () { return state.stories.slice(); },
    getFolders: function () { return state.folders.slice(); },
    getPlacements: function () { return Object.assign({}, state.placements); },
    syncStoriesToDisk: syncStoriesToDisk,
    registerLocationSection: registerLocationSection,
    refreshLocation: refreshLocation,
    savePad: savePad,
    keepCraftingPad: keepCraftingPad,
    ensureClaudeClient: ensureClaudeClient,
    resolveTinkerApi: resolveTinkerApi,
    insertQuestionInline: insertQuestionInline,
    extractAskedQuestions: extractAskedQuestions,
    parsePadMarkdown: parsePadMarkdown,
    serializePadSegments: serializePadSegments,
    setPadMarkdown: setPadMarkdown,
    getPadMarkdown: padBody,
    isEssayReadMode: isEssayReadMode,
    showEssayReadView: showEssayReadView,
    hideEssayReadView: hideEssayReadView,
    getEssayReadMount: function () { return state.essayReadMount; },
    visibleQuestionTexts: function () {
      if (!els.pad) return [];
      var nodes = els.pad.querySelectorAll("[data-pad-q='1']");
      var out = [];
      for (var i = 0; i < nodes.length; i += 1) {
        out.push(String(nodes[i].getAttribute("data-q") || nodes[i].textContent || "").trim());
      }
      return out;
    },
    arePadActionsVisible: function () { return !!state.padActionsVisible; },
    isMobileEssayListOpen: function () { return !!state.mobileEssayList; },
    getFollowupQuestion: function () { return state.followupQuestion || ""; },
    showPadError: showPadError,
    showPadNotice: showPadNotice,
    clearPadError: clearPadError,
    focusLastPadTurn: focusLastPadTurn,
    scrollQuestionIntoSafeView: scrollQuestionIntoSafeView,
    syncVisualViewportInset: syncVisualViewportInset,
    setPadIdleMs: function (ms) {
      var n = Number(ms);
      if (Number.isFinite(n) && n >= 0) state.padIdleMsOverride = n;
    },
    getPadRevealDelayMs: function () { return resolveRevealDelayMs(); },
    getPadKeystrokeGaps: function () { return state.keystrokeGaps.slice(); },
    syncKeepCraftingShortcutHint: syncKeepCraftingShortcutHint,
    ready: null,
  };

  render();
  window.tinkerRepo.ready = loadStories().then(function () {
    applyWriteQuery();
    restorePadDraftAfterAuth();
  });
})();
