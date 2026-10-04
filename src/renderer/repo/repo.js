/* /repo — stories as Markdown files + blank writing surface + folders.
 *
 * Left list: nested folders (content-typed) and files. Center: blank
 * Markdown editor. Folders/placements persist via /api/repo-folders.
 * Mac: when a Tinker location is set, write into mirrored directories.
 */

(function () {
  "use strict";

  var LOCATION_KEY = "tinker.repo.location.v1";
  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var md = window.tinkerStoriesMd;
  var core = window.tinkerRepoFoldersCore;
  if (!md || !core) return;

  var state = {
    stories: [],
    folders: [],
    placements: {},
    localFiles: {},
    selectedId: null,
    selectedFolderId: null,
    draft: null,
    location: "",
    locationOpen: false,
    locationCustom: false,
    locationActive: 0,
    locationRows: [],
    locationError: "",
    locationSaving: false,
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
    syncHint: document.getElementById("repo-sync-hint"),
    downloadOne: document.getElementById("repo-download-one"),
    downloadAll: document.getElementById("repo-download-all"),
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

  function setLocation(value) {
    state.location = String(value || "").trim();
    writeStoredLocation(state.location);
    renderLocation();
    syncStoriesToDisk();
  }

  function canPickFolder() {
    return !!(window.tinker && typeof window.tinker.pickNotesFolder === "function");
  }

  function canWriteDisk() {
    return !!(
      state.location &&
      window.tinker &&
      typeof window.tinker.writeNotesFile === "function" &&
      typeof window.tinker.listNotesFiles === "function"
    );
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

  /* Location dropdown
   * Custom listbox (not a native <select>): Folders section, then
   * "Custom location...", then Storage section options. Storage providers
   * (Mac folder built-in; iCloud/Drive via registerLocationSection) share
   * keyboard nav, selected state, and outside-click close. */

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
      // Append registered options onto the built-in Storage slot so Mac
      // folder stays available when iCloud/Drive register the same key.
      locationSections[key] = {
        key: key,
        label: incoming.label || prev.label,
        order: typeof spec.order === "number" ? spec.order : prev.order,
        _builtin: true,
        getOptions: function () {
          return [].concat(prev.getOptions() || [], incoming.getOptions() || []);
        },
        onSelect: function (option) {
          var id = option && option.id;
          if (id === "mac-folder") return prev.onSelect(option);
          return incoming.onSelect(option);
        },
      };
    } else {
      locationSections[key] = incoming;
    }
    if (state.locationOpen) renderLocation();
  }

  function refreshLocation() {
    renderLocation();
  }

  function folderDisplayPath(folderId) {
    if (!folderId) return "tinker";
    return core.ancestors(state.folders, folderId).reverse().map(function (f) {
      return String(f.name || "");
    }).join("/");
  }

  function currentLocationFolderId() {
    var story = selectedStory();
    if (story) return story.folderId || null;
    return state.selectedFolderId || null;
  }

  function buildLocationRows() {
    var rows = [];
    var currentId = currentLocationFolderId();

    rows.push({
      kind: "section",
      sectionKey: "folders",
      label: "Folders",
    });
    rows.push({
      kind: "folder",
      folderId: null,
      label: "tinker",
      type: core.DEFAULT_CONTENT_TYPE,
      depth: 0,
      selected: currentId == null,
    });

    function walk(parentId, depth) {
      core.sortByName(core.childFolders(state.folders, parentId)).forEach(function (folder) {
        rows.push({
          kind: "folder",
          folderId: folder.id,
          label: folderDisplayPath(folder.id),
          type: core.normalizeContentType(folder.contentType),
          depth: depth,
          selected: (folder.id || null) === (currentId || null),
        });
        walk(folder.id, depth + 1);
      });
    }
    walk(null, 1);

    rows.push({
      kind: "custom",
      label: "Custom location…",
      depth: 0,
      selected: false,
    });

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
        rows.push({
          kind: "storage",
          sectionKey: section.key,
          optionId: opt.id == null ? section.key + "-" + i : String(opt.id),
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

  function renderLocation() {
    if (!els.locationBtn) return;
    var currentId = currentLocationFolderId();
    var label = folderDisplayPath(currentId);
    if (els.locationValue) text(els.locationValue, label);
    else text(els.locationBtn, label);
    els.locationBtn.setAttribute("title", "Location: " + label);
    els.locationBtn.setAttribute("aria-expanded", state.locationOpen ? "true" : "false");
    if (els.locationPanel) els.locationPanel.hidden = !state.locationOpen;
    if (els.locationCustom) els.locationCustom.hidden = !state.locationCustom;
    if (els.locationList) els.locationList.hidden = !!state.locationCustom;
    if (els.locationError) {
      els.locationError.hidden = !state.locationError;
      text(els.locationError, state.locationError);
    }
    // Keep the legacy choose button in the DOM for id stability / tests,
    // but hide it; Mac folder lives in the Storage listbox section.
    if (els.locationChoose) {
      els.locationChoose.hidden = true;
      text(els.locationChoose, state.location ? "Mac folder: " + shortenPath(state.location) : "Mac folder…");
      els.locationChoose.setAttribute("title", state.location || "Choose the Mac folder Tinker mirrors into");
    }
    renderLocationList();
  }

  function renderLocationList() {
    if (!els.locationList) return;
    clear(els.locationList);
    var rows = buildLocationRows();
    state.locationRows = rows;
    if (state.locationActive >= rows.length) state.locationActive = Math.max(0, rows.length - 1);
    var activeId = "";
    var optionIndex = -1;

    rows.forEach(function (row, index) {
      if (row.kind === "section") {
        var heading = document.createElement("li");
        heading.className = "repo-location__section-label";
        heading.setAttribute("role", "presentation");
        text(heading, row.label);
        els.locationList.appendChild(heading);
        return;
      }

      optionIndex += 1;
      var li = document.createElement("li");
      var id = "repo-location-opt-" + index;
      li.setAttribute("id", id);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", row.selected ? "true" : "false");
      var className = "repo-location__option";
      if (row.kind === "custom") className += " repo-location__option--custom";
      if (row.kind === "storage") className += " repo-location__option--storage";
      if (index === state.locationActive) className += " is-active";
      li.className = className;
      if (row.kind === "custom") li.setAttribute("data-location-custom", "true");
      if (row.kind === "storage") li.setAttribute("data-location-storage", row.optionId || "");
      if (index === state.locationActive) activeId = id;

      var check = document.createElement("span");
      check.className = "repo-location__check";
      check.setAttribute("aria-hidden", "true");
      text(check, row.selected ? "✓" : "");
      li.appendChild(check);

      var name = document.createElement("span");
      name.className = "repo-location__option-name";
      if (row.depth > 1) name.style.paddingLeft = ((row.depth - 1) * 12) + "px";
      text(name, row.label);
      li.appendChild(name);

      if (row.type) {
        var pill = document.createElement("span");
        pill.className = "repo-location__option-type";
        text(pill, core.contentTypeLabel(row.type));
        li.appendChild(pill);
      }
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

      li.addEventListener("mousedown", function (event) {
        if (event && event.preventDefault) event.preventDefault();
      });
      li.addEventListener("click", function (event) {
        if (event && event.stopPropagation) event.stopPropagation();
        chooseLocationRow(index);
      });
      li.addEventListener("mousemove", function () {
        if (state.locationActive === index) return;
        setLocationActive(index);
      });
      els.locationList.appendChild(li);
    });

    // role=group wrappers are logical; the listbox owns the option rows.
    if (els.locationList) {
      els.locationList.setAttribute("role", "listbox");
      if (activeId) els.locationList.setAttribute("aria-activedescendant", activeId);
      else els.locationList.removeAttribute("aria-activedescendant");
    }
  }

  function setLocationActive(index) {
    var rows = state.locationRows || [];
    if (!rows.length) return;
    var next = Math.max(0, Math.min(rows.length - 1, index));
    // Skip section headings when moving with keyboard helpers.
    while (next < rows.length && rows[next] && rows[next].kind === "section") next += 1;
    while (next > 0 && rows[next] && rows[next].kind === "section") next -= 1;
    if (rows[next] && rows[next].kind === "section") return;
    state.locationActive = next;
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

  function focusLocationList() {
    if (!els.locationList) return;
    try { els.locationList.focus(); } catch (e) { /* ignore */ }
  }

  function toggleLocationPanel(force) {
    var open = typeof force === "boolean" ? force : !state.locationOpen;
    state.locationOpen = open;
    state.locationCustom = false;
    state.locationError = "";
    if (open) {
      var rows = buildLocationRows();
      var currentId = currentLocationFolderId();
      var idx = 0;
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].kind === "folder" && (rows[i].folderId || null) === (currentId || null)) {
          idx = i;
          break;
        }
      }
      state.locationActive = idx;
    }
    renderLocation();
    if (open) focusLocationList();
  }

  function closeLocationPanel(returnFocus) {
    if (!state.locationOpen) return;
    toggleLocationPanel(false);
    if (returnFocus && els.locationBtn) {
      try { els.locationBtn.focus(); } catch (e) { /* ignore */ }
    }
  }

  function openCustomLocation() {
    state.locationOpen = true;
    state.locationCustom = true;
    state.locationError = "";
    renderLocation();
    if (els.locationInput) {
      var currentId = currentLocationFolderId();
      els.locationInput.value = currentId ? folderDisplayPath(currentId) : "";
      try { els.locationInput.focus(); } catch (e) { /* ignore */ }
      try { if (els.locationInput.select) els.locationInput.select(); } catch (e) { /* ignore */ }
    }
  }

  function chooseLocationRow(index) {
    var row = (state.locationRows || [])[index];
    if (!row || row.kind === "section") return;
    if (row.kind === "custom") {
      openCustomLocation();
      return;
    }
    if (row.kind === "storage") {
      try { row.onSelect(row.option || row); } catch (e) { /* ignore */ }
      return;
    }
    placeCurrentAt(row.folderId || null);
    closeLocationPanel(true);
  }

  function placeCurrentAt(folderId) {
    var story = selectedStory();
    if (story) {
      if ((story.folderId || null) !== (folderId || null)) moveFileTo(story.id, folderId || null);
      else render();
      return;
    }
    selectFolder(folderId || null);
  }

  function parseLocationPath(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .split("/")
      .map(function (seg) { return seg.trim(); })
      .filter(function (seg) { return seg && seg !== "." && seg !== ".."; });
  }

  function findChildByName(parentId, name) {
    var want = String(name).toLowerCase();
    var kids = core.childFolders(state.folders, parentId);
    for (var i = 0; i < kids.length; i += 1) {
      var f = kids[i];
      if (String(f.name || "").toLowerCase() === want) return f;
      if (core.pathSegment(f.name).toLowerCase() === core.pathSegment(name).toLowerCase()) return f;
    }
    return null;
  }

  function ensureFolderPath(segments) {
    var chain = Promise.resolve(null);
    segments.forEach(function (seg, i) {
      chain = chain.then(function (parentId) {
        var existing = findChildByName(parentId, seg);
        if (existing) return existing.id;
        var body = { name: seg, parentId: parentId };
        if (!parentId) {
          var guess = String(seg).toLowerCase();
          body.contentType = core.CONTENT_TYPES && core.CONTENT_TYPES.indexOf(guess) !== -1
            ? guess
            : core.DEFAULT_CONTENT_TYPE;
        }
        return apiPost("create_folder", body).then(function (result) {
          if (!result.ok || !result.json || !result.json.folder) {
            throw new Error((result.json && result.json.error) || "Could not create " + segments.slice(0, i + 1).join("/") + ".");
          }
          if (result.json.tree) applyTree(result.json.tree);
          return result.json.folder.id;
        });
      });
    });
    return chain;
  }

  function saveCustomLocation() {
    if (!els.locationInput || state.locationSaving) return Promise.resolve();
    var raw = String(els.locationInput.value || "");
    var segs = parseLocationPath(raw);
    if (segs.length && String(segs[0]).toLowerCase() === "tinker" && !findChildByName(null, segs[0])) {
      segs = segs.slice(1);
    }
    if (!raw.trim()) {
      state.locationCustom = false;
      state.locationError = "";
      renderLocation();
      focusLocationList();
      return Promise.resolve();
    }
    state.locationSaving = true;
    state.locationError = "";
    return ensureFolderPath(segs).then(function (folderId) {
      state.locationSaving = false;
      state.locationOpen = false;
      state.locationCustom = false;
      placeCurrentAt(folderId || null);
      renderLocation();
      return syncStoriesToDisk();
    }).catch(function (err) {
      state.locationSaving = false;
      state.locationOpen = true;
      state.locationCustom = true;
      state.locationError = (err && err.message) || "Could not save location.";
      render();
    });
  }

  function moveLocationActive(delta) {
    var rows = state.locationRows || [];
    if (!rows.length) return;
    var next = state.locationActive;
    var guard = 0;
    do {
      next += delta;
      if (next < 0) next = rows.length - 1;
      if (next >= rows.length) next = 0;
      guard += 1;
    } while (rows[next] && rows[next].kind === "section" && guard < rows.length + 2);
    setLocationActive(next);
  }

  function onLocationTriggerKey(event) {
    var key = event && event.key;
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
      if (event.preventDefault) event.preventDefault();
      if (!state.locationOpen) toggleLocationPanel(true);
      else focusLocationList();
    } else if (key === "Escape" && state.locationOpen) {
      if (event.preventDefault) event.preventDefault();
      closeLocationPanel(true);
    }
  }

  function onLocationListKey(event) {
    var key = event && event.key;
    var rows = state.locationRows || [];
    if (key === "ArrowDown") {
      if (event.preventDefault) event.preventDefault();
      moveLocationActive(1);
    } else if (key === "ArrowUp") {
      if (event.preventDefault) event.preventDefault();
      moveLocationActive(-1);
    } else if (key === "Home") {
      if (event.preventDefault) event.preventDefault();
      var first = 0;
      while (first < rows.length && rows[first] && rows[first].kind === "section") first += 1;
      setLocationActive(first);
    } else if (key === "End") {
      if (event.preventDefault) event.preventDefault();
      var last = rows.length - 1;
      while (last > 0 && rows[last] && rows[last].kind === "section") last -= 1;
      setLocationActive(last);
    } else if (key === "Enter" || key === " ") {
      if (event.preventDefault) event.preventDefault();
      chooseLocationRow(state.locationActive);
    } else if (key === "Escape") {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      closeLocationPanel(true);
    } else if (key === "Tab") {
      closeLocationPanel(false);
    }
  }

  function saveLocationFromInput() {
    return saveCustomLocation();
  }

  function chooseLocationFolder() {
    if (!canPickFolder()) return;
    window.tinker.pickNotesFolder().then(function (picked) {
      if (!picked || !picked.path) return;
      setLocation(picked.path);
      state.locationOpen = false;
      state.locationCustom = false;
      renderLocation();
    }).catch(function () { /* cancelled */ });
  }

  // Built-in Storage section: Mac disk root picker (desktop only).
  registerLocationSection({
    key: "storage",
    label: "Storage",
    order: 100,
    _builtin: true,
    getOptions: function () {
      if (!canPickFolder()) return [];
      return [{
        id: "mac-folder",
        label: state.location ? "Mac folder: " + shortenPath(state.location) : "Mac folder…",
        detail: state.location || "",
        selected: !!state.location,
      }];
    },
    onSelect: function (option) {
      if (option && option.id === "mac-folder") chooseLocationFolder();
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
    text(els.branch, "files");
    renderTree();
    renderCenter();
    renderLocation();
    renderDownloads();
    renderSyncHint();
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
    var root = state.location;
    return window.tinker.listNotesFiles(root).then(function (listed) {
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
          return window.tinker.writeNotesFile(root, story.relPath, story.markdown).then(function () {
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
          return window.tinker.writeNotesFile(root, marker, folder.contentType + "\n").then(function () {
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
      toggleLocationPanel();
    });
    els.locationBtn.addEventListener("keydown", onLocationTriggerKey);
  }
  if (els.locationList) {
    els.locationList.addEventListener("keydown", onLocationListKey);
  }
  if (els.locationSave) {
    els.locationSave.addEventListener("mousedown", function (event) {
      // Save via click, not via the input's blur racing it.
      if (event && event.preventDefault) event.preventDefault();
    });
    els.locationSave.addEventListener("click", function (event) {
      event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      saveLocationFromInput();
    });
  }
  if (els.locationChoose) {
    els.locationChoose.addEventListener("click", function (event) {
      event.preventDefault();
      chooseLocationFolder();
    });
  }
  if (els.locationInput) {
    els.locationInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        saveLocationFromInput();
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        state.locationCustom = false;
        state.locationError = "";
        renderLocation();
        focusLocationList();
      }
    });
    els.locationInput.addEventListener("blur", function () {
      if (!state.locationCustom || state.locationSaving) return;
      if (!String(els.locationInput.value || "").trim()) {
        state.locationCustom = false;
        state.locationError = "";
        renderLocation();
        focusLocationList();
        return;
      }
      saveLocationFromInput();
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
    toggleLocationPanel(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (state.moveFileId) closeMoveSheet();
      if (state.pendingDeleteId) closeConfirmSheet();
      if (state.creatingFolder) cancelCreateFolder();
      if (state.renamingFolderId) cancelRenameFolder();
    }
  });

  state.location = readStoredLocation();

  window.tinkerRepo = {
    getLocation: getLocation,
    getStories: function () { return state.stories.slice(); },
    getFolders: function () { return state.folders.slice(); },
    getPlacements: function () { return Object.assign({}, state.placements); },
    syncStoriesToDisk: syncStoriesToDisk,
    registerLocationSection: registerLocationSection,
    refreshLocation: refreshLocation,
    ready: null,
  };

  render();
  window.tinkerRepo.ready = loadStories();
})();
