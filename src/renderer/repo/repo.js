/* /repo — stories as Markdown files + blank writing surface.
 *
 * Left list: every self-reflection / You-thread story as
 * stories/<date>-<slug>.md. Center: blank Markdown editor.
 * Mac: when a Tinker location is set, write into <location>/stories/
 * (skip files whose local content already differs). Web: download.
 */

(function () {
  "use strict";

  var LOCATION_KEY = "tinker.repo.location.v1";
  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var md = window.tinkerStoriesMd;
  if (!md) return;

  var state = {
    stories: [],
    localFiles: {},
    selectedId: null,
    draft: null,
    location: "",
    locationOpen: false,
    status: "",
    pieceCounter: 0,
  };

  var els = {
    name: document.getElementById("repo-name"),
    branch: document.getElementById("repo-branch"),
    tree: document.getElementById("repo-tree"),
    empty: document.getElementById("repo-stories-empty"),
    newPiece: document.getElementById("repo-new-piece"),
    body: document.getElementById("repo-body"),
    locationBtn: document.getElementById("repo-location-btn"),
    locationPanel: document.getElementById("repo-location-panel"),
    locationInput: document.getElementById("repo-location-input"),
    locationSave: document.getElementById("repo-location-save"),
    locationChoose: document.getElementById("repo-location-choose"),
    filePath: document.getElementById("repo-file-path"),
    syncHint: document.getElementById("repo-sync-hint"),
    downloadOne: document.getElementById("repo-download-one"),
    downloadAll: document.getElementById("repo-download-all"),
    mobile: document.getElementById("repo-mobile"),
    mobileTree: document.getElementById("repo-mobile-tree"),
    mobilePiece: document.getElementById("repo-mobile-piece"),
    mobileTitle: document.getElementById("repo-mobile-title"),
    mobileBody: document.getElementById("repo-mobile-body"),
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

  function isDesktopShell() {
    return !!(window.tinker && (window.tinker.isDesktopApp || window.tinker.supportsWebview));
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
    render();
  }

  function addNewFile() {
    state.pieceCounter += 1;
    var now = new Date();
    var draft = {
      id: "draft-new-" + state.pieceCounter,
      title: "",
      body: "",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      fileName: md.storyDate(now) + "-untitled.md",
      relPath: "stories/" + md.storyDate(now) + "-untitled.md",
      markdown: "",
      isNew: true,
    };
    // Unique untitled name if needed.
    var used = {};
    state.stories.forEach(function (s) { used[s.relPath] = true; });
    var n = 1;
    while (used[draft.relPath]) {
      n += 1;
      draft.fileName = md.storyDate(now) + "-untitled-" + n + ".md";
      draft.relPath = "stories/" + draft.fileName;
    }
    state.draft = draft;
    state.selectedId = draft.id;
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

  function renderLocation() {
    if (!els.locationBtn) return;
    var short = shortenPath(state.location);
    text(els.locationBtn, short || "Tinker location");
    els.locationBtn.setAttribute("title", state.location || "Set local Tinker folder path");
    els.locationBtn.setAttribute("aria-expanded", state.locationOpen ? "true" : "false");
    if (els.locationPanel) els.locationPanel.hidden = !state.locationOpen;
    if (els.locationInput && document.activeElement !== els.locationInput) {
      els.locationInput.value = state.location;
    }
    if (els.locationChoose) {
      els.locationChoose.hidden = !canPickFolder();
    }
  }

  function toggleLocationPanel(force) {
    state.locationOpen = typeof force === "boolean" ? force : !state.locationOpen;
    if (state.locationOpen && els.locationInput) {
      els.locationInput.value = state.location;
    }
    renderLocation();
    if (state.locationOpen && els.locationInput) {
      try { els.locationInput.focus(); } catch (e) { /* ignore */ }
    }
  }

  function saveLocationFromInput() {
    if (!els.locationInput) return;
    setLocation(els.locationInput.value);
    state.locationOpen = false;
    renderLocation();
  }

  function chooseLocationFolder() {
    if (!canPickFolder()) return;
    window.tinker.pickNotesFolder().then(function (picked) {
      if (!picked || !picked.path) return;
      if (els.locationInput) els.locationInput.value = picked.path;
      setLocation(picked.path);
      state.locationOpen = false;
      renderLocation();
    }).catch(function () { /* cancelled */ });
  }

  function renderTree() {
    clear(els.tree);
    var files = state.stories.slice();
    if (state.draft) files = [state.draft].concat(files);

    if (els.empty) {
      els.empty.hidden = files.length > 0;
    }

    if (!files.length) return;

    var wrap = document.createElement("div");
    wrap.className = "repo-tree__folder";
    wrap.setAttribute("data-open", "true");
    wrap.setAttribute("role", "treeitem");
    wrap.setAttribute("aria-expanded", "true");

    var folderBtn = document.createElement("button");
    folderBtn.type = "button";
    folderBtn.className = "repo-tree__folder-btn";
    var chevron = document.createElement("span");
    chevron.className = "repo-tree__chevron";
    chevron.textContent = "▾";
    folderBtn.appendChild(chevron);
    var name = document.createElement("span");
    name.textContent = "stories";
    folderBtn.appendChild(name);
    wrap.appendChild(folderBtn);

    var list = document.createElement("ul");
    list.className = "repo-tree__pieces";
    list.setAttribute("role", "group");
    files.forEach(function (story) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "repo-tree__piece";
      btn.setAttribute("role", "treeitem");
      btn.setAttribute("data-story-id", story.id);
      if (state.selectedId === story.id) btn.className += " is-selected";
      btn.textContent = story.fileName || story.relPath;
      btn.title = story.title || story.fileName || "";
      btn.addEventListener("click", function () {
        selectStory(story.id);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
    wrap.appendChild(list);
    els.tree.appendChild(wrap);
  }

  function renderCenter() {
    if (!els.body) return;
    els.body.disabled = false;
    var story = selectedStory();
    if (!story) {
      if (document.activeElement !== els.body) els.body.value = "";
      text(els.filePath, "");
      if (els.downloadOne) els.downloadOne.hidden = true;
      return;
    }
    if (document.activeElement !== els.body) {
      els.body.value = story.isNew ? (story.markdown || "") : story.markdown;
    }
    text(els.filePath, story.relPath);
    if (els.downloadOne) els.downloadOne.hidden = isDesktopShell();
  }

  function renderMobile() {
    if (!els.mobileTree) return;
    clear(els.mobileTree);
    var files = state.stories.slice();
    if (state.draft) files = [state.draft].concat(files);
    var list = document.createElement("ul");
    list.className = "repo-reflections__list";
    files.forEach(function (story) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "repo-tree__piece";
      if (state.selectedId === story.id) btn.className += " is-selected";
      btn.textContent = story.fileName || story.relPath;
      btn.addEventListener("click", function () {
        selectStory(story.id);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
    els.mobileTree.appendChild(list);

    if (els.mobilePiece) {
      var story = selectedStory();
      if (story) {
        els.mobilePiece.hidden = false;
        text(els.mobileTitle, story.title || story.fileName);
        text(els.mobileBody, story.markdown);
      } else {
        els.mobilePiece.hidden = true;
      }
    }
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
    text(els.branch, "stories");
    renderTree();
    renderCenter();
    renderMobile();
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
      return chain.then(function () {
        state.status = skipped
          ? "Wrote " + wrote + ", skipped " + skipped + " differing"
          : (wrote ? "Wrote " + wrote + " story file" + (wrote === 1 ? "" : "s") : "");
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
    return fetch("/api/self-reflections?action=list&limit=200", {
      headers: { Authorization: "Bearer " + t, Accept: "application/json" },
    }).then(function (res) {
      if (res.status === 401) {
        try { window.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
        sendHomeForAuth();
        return null;
      }
      if (!res.ok) return { reflections: [] };
      return res.json();
    }).then(function (json) {
      if (!json) return;
      var rows = Array.isArray(json.reflections) ? json.reflections : [];
      state.stories = md.uniqueStoryFiles(rows);
      render();
      return syncStoriesToDisk();
    }).catch(function () {
      state.stories = [];
      render();
    });
  }

  if (els.newPiece) els.newPiece.addEventListener("click", addNewFile);
  if (els.body) els.body.addEventListener("input", onBodyInput);
  if (els.locationBtn) {
    els.locationBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      toggleLocationPanel();
    });
  }
  if (els.locationSave) {
    els.locationSave.addEventListener("click", function (event) {
      event.preventDefault();
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
        toggleLocationPanel(false);
      }
    });
  }
  if (els.downloadOne) els.downloadOne.addEventListener("click", downloadOne);
  if (els.downloadAll) els.downloadAll.addEventListener("click", downloadAll);
  document.addEventListener("click", function (event) {
    if (!state.locationOpen) return;
    var root = document.getElementById("repo-location");
    if (root && root.contains(event.target)) return;
    toggleLocationPanel(false);
  });

  state.location = readStoredLocation();

  window.tinkerRepo = {
    getLocation: getLocation,
    getStories: function () { return state.stories.slice(); },
    syncStoriesToDisk: syncStoriesToDisk,
    ready: null,
  };

  render();
  window.tinkerRepo.ready = loadStories();
})();
