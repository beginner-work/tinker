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
  var PLACE_STARTERS = ["Home", "Coffee shop", "San Diego"];
  var STORAGE_EVENT = "tinker-storage-root-changed";
  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var md = window.tinkerStoriesMd;
  var core = window.tinkerRepoFoldersCore;
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
  };

  var els = {
    name: document.getElementById("repo-name"),
    branch: document.getElementById("repo-branch"),
    tree: document.getElementById("repo-tree"),
    empty: document.getElementById("repo-stories-empty"),
    newPiece: document.getElementById("repo-new-piece"),
    newFolder: document.getElementById("repo-new-folder"),
    body: document.getElementById("repo-body"),
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
    downloadOne: document.getElementById("repo-download-one"),
    downloadAll: document.getElementById("repo-download-all"),
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

  function sendHomeForAuth() {
    try { window.sessionStorage.setItem(RETURN_KEY, "/repo"); }
    catch (e) { /* ignore */ }
    window.location.assign("/");
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
    return placeForSelectedFile();
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
    render();
    if (els.body) {
      try { els.body.focus(); } catch (e) { /* ignore */ }
    }
  }

  function onBodyInput() {
    var story = selectedStory();
    if (!story || !story.isNew) return;
    story.markdown = els.body.value;
    story.body = els.body.value;
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
      text(els.moveHint, file ? ("Move " + (file.fileName || "file")) : "Choose a folder");
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

  function isDraftId(id) {
    return String(id || "").indexOf("draft-") === 0;
  }

  function readRecentPlaces() {
    try {
      var raw = window.localStorage.getItem(RECENT_PLACES_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(function (item) { return String(item || "").trim(); }).filter(Boolean).slice(0, 12);
    } catch (e) {
      return [];
    }
  }

  function writeRecentPlaces(list) {
    try {
      window.localStorage.setItem(RECENT_PLACES_KEY, JSON.stringify((list || []).slice(0, 12)));
    } catch (e) { /* ignore */ }
  }

  function pushRecentPlace(label) {
    var place = String(label || "").trim();
    if (!place) return;
    var next = [place];
    readRecentPlaces().forEach(function (item) {
      if (item.toLowerCase() === place.toLowerCase()) return;
      next.push(item);
    });
    writeRecentPlaces(next.slice(0, 12));
  }

  function buildPlaceRows(query) {
    var q = String(query || "").trim().toLowerCase();
    var rows = [];
    var seen = {};
    var current = placeForSelectedFile();

    function addRow(label, kind) {
      var name = String(label || "").trim();
      if (!name) return;
      var key = name.toLowerCase();
      if (seen[key]) return;
      if (q && key.indexOf(q) === -1) return;
      seen[key] = true;
      rows.push({
        kind: kind || "place",
        label: name,
        selected: current.toLowerCase() === key,
      });
    }

    readRecentPlaces().forEach(function (item) { addRow(item, "recent"); });
    PLACE_STARTERS.forEach(function (item) { addRow(item, "starter"); });

    var typed = String(query || "").trim();
    if (typed && !seen[typed.toLowerCase()]) {
      rows.push({
        kind: "use",
        label: typed,
        display: "Use \u201c" + typed + "\u201d",
        selected: false,
      });
    }
    return rows;
  }

  function placeQueryFromInput() {
    if (!els.locationInput) return "";
    return String(els.locationInput.value || "");
  }

  function placeInputIsTyping() {
    return !!(els.locationInput && document.activeElement === els.locationInput && state.locationOpen);
  }

  function renderPlace() {
    if (!isWritePage) return;
    var place = placeForSelectedFile();
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
    var rows = buildPlaceRows(placeQueryFromInput());
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

      li.addEventListener("mousedown", function (event) {
        if (event && event.preventDefault) event.preventDefault();
      });
      li.addEventListener("click", function (event) {
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
      state.placeRows = buildPlaceRows(placeQueryFromInput());
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
    if (open && els.locationInput) {
      try { els.locationInput.focus(); } catch (e) { /* ignore */ }
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
    var story = selectedStory();
    if (!story || !story.id) {
      closePlacePanel(false);
      return;
    }
    var place = String(label || "").trim();
    if (place) {
      state.places[story.id] = place.slice(0, 120);
      pushRecentPlace(place);
    } else {
      delete state.places[story.id];
    }
    if (!isDraftId(story.id)) {
      apiPost("set_place", { fileId: story.id, place: place || "" }).then(function (result) {
        if (result && result.ok && result.json && result.json.tree) {
          applyTree(result.json.tree);
          render();
        }
      }).catch(function () { /* ignore */ });
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
    btn.textContent = story.fileName || story.relPath;
    btn.title = story.title || story.fileName || "";
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
    if (!els.body) return;
    els.body.disabled = false;
    var story = selectedStory();
    if (!story) {
      if (document.activeElement !== els.body) els.body.value = "";
      text(els.filePath, "");
      if (els.fileType) {
        els.fileType.hidden = true;
        text(els.fileType, "");
      }
      if (els.downloadOne) els.downloadOne.hidden = true;
      return;
    }
    if (document.activeElement !== els.body) {
      els.body.value = story.isNew ? (story.markdown || "") : story.markdown;
    }
    text(els.filePath, story.relPath);
    if (els.fileType) {
      els.fileType.hidden = false;
      text(els.fileType, "Type: " + core.contentTypeLabel(story.contentType || core.DEFAULT_CONTENT_TYPE));
    }
    if (els.downloadOne) els.downloadOne.hidden = isDesktopShell();
  }

  function renderDownloads() {
    var web = !isDesktopShell();
    if (els.downloadAll) {
      els.downloadAll.hidden = !(web && state.stories.length);
    }
    if (els.downloadOne) {
      els.downloadOne.hidden = !(web && selectedStory() && !selectedStory().isNew);
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
    text(els.name, "tinker");
    if (els.branch) text(els.branch, isFilesPage ? "files" : "writing");
    if (isFilesPage) {
      renderTree();
      renderSavedIn();
    }
    if (isWritePage) {
      renderCenter();
      renderPlace();
      renderDownloads();
      renderSyncHint();
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

  function triggerDownload(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadOne() {
    var story = selectedStory();
    if (!story || story.isNew) return;
    var blob = new Blob([story.markdown], { type: "text/markdown;charset=utf-8" });
    triggerDownload(story.fileName, blob);
  }

  function downloadAll() {
    if (!state.stories.length) return;
    var files = state.stories.map(function (s) {
      return { name: s.relPath, text: s.markdown };
    });
    var bytes = md.buildZip(files);
    var blob = new Blob([bytes], { type: "application/zip" });
    triggerDownload("stories.zip", blob);
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
      sendHomeForAuth();
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
        sendHomeForAuth();
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
      render();
      return syncStoriesToDisk();
    }).catch(function () {
      state.stories = [];
      render();
    });
  }

  if (els.newPiece) els.newPiece.addEventListener("click", addNewFile);
  if (els.newFolder) els.newFolder.addEventListener("click", startCreateFolder);
  if (els.body) els.body.addEventListener("input", onBodyInput);
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
      if (!state.locationOpen) togglePlacePanel(true);
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
  if (els.downloadOne) els.downloadOne.addEventListener("click", downloadOne);
  if (els.downloadAll) els.downloadAll.addEventListener("click", downloadAll);
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
    ready: null,
  };

  render();
  window.tinkerRepo.ready = loadStories().then(function () {
    applyWriteQuery();
  });
})();
