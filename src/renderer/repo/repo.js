/* /repo — UI-only repository preview.
 *
 * Sample fixtures only. Edits, new pieces, and "Develop into the
 * repository" stay in memory for this page load. No API or persistence.
 */

(function () {
  "use strict";

  var fixtures = window.tinkerRepoFixtures && window.tinkerRepoFixtures.SAMPLE_REPO;
  if (!fixtures) return;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var state = {
    name: fixtures.name,
    branchLabel: fixtures.branchLabel,
    reflections: clone(fixtures.reflections),
    folders: clone(fixtures.folders),
    history: clone(fixtures.history),
    openFolders: {},
    selected: null,
    dirtyIds: {},
    changeNote: "",
    viewingHistory: null,
    pieceCounter: 0,
  };

  state.folders.forEach(function (folder) {
    state.openFolders[folder.id] = true;
  });

  var els = {
    name: document.getElementById("repo-name"),
    branch: document.getElementById("repo-branch"),
    reflectionsList: document.getElementById("repo-reflections-list"),
    tree: document.getElementById("repo-tree"),
    newPiece: document.getElementById("repo-new-piece"),
    empty: document.getElementById("repo-empty"),
    reflectionPane: document.getElementById("repo-reflection-pane"),
    reflectionTitle: document.getElementById("repo-reflection-title"),
    reflectionBody: document.getElementById("repo-reflection-body"),
    develop: document.getElementById("repo-develop"),
    editor: document.getElementById("repo-editor"),
    title: document.getElementById("repo-title"),
    body: document.getElementById("repo-body"),
    readonlyNote: document.getElementById("repo-readonly-note"),
    changesList: document.getElementById("repo-changes-list"),
    changeNote: document.getElementById("repo-change-note"),
    saveVersion: document.getElementById("repo-save-version"),
    saveHint: document.getElementById("repo-save-hint"),
    historyList: document.getElementById("repo-history-list"),
    mobile: document.getElementById("repo-mobile"),
    mobileReflections: document.getElementById("repo-mobile-reflections"),
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

  function findPiece(pieceId) {
    for (var i = 0; i < state.folders.length; i += 1) {
      var folder = state.folders[i];
      for (var j = 0; j < folder.pieces.length; j += 1) {
        if (folder.pieces[j].id === pieceId) {
          return { folder: folder, piece: folder.pieces[j] };
        }
      }
    }
    return null;
  }

  function findReflection(id) {
    for (var i = 0; i < state.reflections.length; i += 1) {
      if (state.reflections[i].id === id) return state.reflections[i];
    }
    return null;
  }

  function markDirty(pieceId) {
    state.dirtyIds[pieceId] = true;
    renderChanges();
  }

  function selectReflection(id) {
    state.selected = { kind: "reflection", id: id };
    state.viewingHistory = null;
    render();
  }

  function selectPiece(id) {
    state.selected = { kind: "piece", id: id };
    state.viewingHistory = null;
    render();
  }

  function selectHistory(id) {
    var entry = null;
    for (var i = 0; i < state.history.length; i += 1) {
      if (state.history[i].id === id) {
        entry = state.history[i];
        break;
      }
    }
    if (!entry) return;
    state.viewingHistory = entry;
    state.selected = { kind: "piece", id: entry.pieceId };
    render();
  }

  function developReflection() {
    if (!state.selected || state.selected.kind !== "reflection") return;
    var reflection = findReflection(state.selected.id);
    if (!reflection) return;

    var target = state.folders[0] || {
      id: "folder-developed",
      name: "Developed",
      pieces: [],
    };
    if (state.folders.indexOf(target) === -1) {
      state.folders.push(target);
      state.openFolders[target.id] = true;
    }

    state.pieceCounter += 1;
    var piece = {
      id: "piece-developed-" + state.pieceCounter,
      title: reflection.title || "Sample piece",
      body: reflection.body || "",
      fromReflectionId: reflection.id,
    };
    target.pieces.push(piece);
    state.openFolders[target.id] = true;

    state.reflections = state.reflections.filter(function (item) {
      return item.id !== reflection.id;
    });

    markDirty(piece.id);
    selectPiece(piece.id);
  }

  function addNewPiece() {
    var target = state.folders[0];
    if (!target) {
      target = { id: "folder-new", name: "Pieces", pieces: [] };
      state.folders.push(target);
    }
    state.openFolders[target.id] = true;
    state.pieceCounter += 1;
    var piece = {
      id: "piece-new-" + state.pieceCounter,
      title: "Sample piece",
      body: "",
    };
    target.pieces.push(piece);
    markDirty(piece.id);
    selectPiece(piece.id);
  }

  function onTitleInput() {
    if (state.viewingHistory) return;
    if (!state.selected || state.selected.kind !== "piece") return;
    var found = findPiece(state.selected.id);
    if (!found) return;
    found.piece.title = els.title.value;
    markDirty(found.piece.id);
    renderTree();
    renderMobile();
    renderChanges();
  }

  function onBodyInput() {
    if (state.viewingHistory) return;
    if (!state.selected || state.selected.kind !== "piece") return;
    var found = findPiece(state.selected.id);
    if (!found) return;
    found.piece.body = els.body.value;
    markDirty(found.piece.id);
    renderChanges();
  }

  function renderReflections() {
    clear(els.reflectionsList);
    if (!state.reflections.length) {
      var empty = document.createElement("li");
      empty.className = "repo-changes__empty";
      empty.textContent = "No sample reflections left";
      els.reflectionsList.appendChild(empty);
      return;
    }
    state.reflections.forEach(function (reflection) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "repo-reflections__item";
      if (state.selected && state.selected.kind === "reflection" && state.selected.id === reflection.id) {
        btn.className += " is-selected";
      }
      btn.textContent = reflection.title;
      btn.addEventListener("click", function () {
        selectReflection(reflection.id);
      });
      li.appendChild(btn);
      els.reflectionsList.appendChild(li);
    });
  }

  function renderTree() {
    clear(els.tree);
    state.folders.forEach(function (folder) {
      var open = state.openFolders[folder.id] !== false;
      var wrap = document.createElement("div");
      wrap.className = "repo-tree__folder";
      wrap.setAttribute("data-open", open ? "true" : "false");
      wrap.setAttribute("role", "treeitem");
      wrap.setAttribute("aria-expanded", open ? "true" : "false");

      var folderBtn = document.createElement("button");
      folderBtn.type = "button";
      folderBtn.className = "repo-tree__folder-btn";
      var chevron = document.createElement("span");
      chevron.className = "repo-tree__chevron";
      chevron.textContent = open ? "▾" : "▸";
      folderBtn.appendChild(chevron);
      var name = document.createElement("span");
      name.textContent = folder.name;
      folderBtn.appendChild(name);
      folderBtn.addEventListener("click", function () {
        state.openFolders[folder.id] = !open;
        renderTree();
      });
      wrap.appendChild(folderBtn);

      var list = document.createElement("ul");
      list.className = "repo-tree__pieces";
      list.setAttribute("role", "group");
      folder.pieces.forEach(function (piece) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "repo-tree__piece";
        btn.setAttribute("role", "treeitem");
        if (state.selected && state.selected.kind === "piece" && state.selected.id === piece.id && !state.viewingHistory) {
          btn.className += " is-selected";
        }
        btn.textContent = piece.title || "Untitled";
        btn.addEventListener("click", function () {
          selectPiece(piece.id);
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
      wrap.appendChild(list);
      els.tree.appendChild(wrap);
    });
  }

  function renderCenter() {
    els.empty.hidden = true;
    els.reflectionPane.hidden = true;
    els.editor.hidden = true;
    els.readonlyNote.hidden = true;
    els.title.disabled = false;
    els.body.disabled = false;

    if (!state.selected) {
      els.empty.hidden = false;
      return;
    }

    if (state.viewingHistory) {
      els.editor.hidden = false;
      els.title.value = state.viewingHistory.title || "";
      els.body.value = state.viewingHistory.body || "";
      els.title.disabled = true;
      els.body.disabled = true;
      els.readonlyNote.hidden = false;
      return;
    }

    if (state.selected.kind === "reflection") {
      var reflection = findReflection(state.selected.id);
      if (!reflection) {
        els.empty.hidden = false;
        return;
      }
      els.reflectionPane.hidden = false;
      text(els.reflectionTitle, reflection.title);
      text(els.reflectionBody, reflection.body);
      return;
    }

    var found = findPiece(state.selected.id);
    if (!found) {
      els.empty.hidden = false;
      return;
    }
    els.editor.hidden = false;
    els.title.value = found.piece.title || "";
    els.body.value = found.piece.body || "";
  }

  function renderChanges() {
    clear(els.changesList);
    var ids = Object.keys(state.dirtyIds);
    if (!ids.length) {
      var empty = document.createElement("p");
      empty.className = "repo-changes__empty";
      empty.textContent = "No edits this session";
      els.changesList.appendChild(empty);
      return;
    }
    ids.forEach(function (id) {
      var found = findPiece(id);
      var li = document.createElement("li");
      var row = document.createElement("div");
      row.className = "repo-changes__item is-dirty";
      row.textContent = found ? (found.piece.title || "Untitled") : id;
      li.appendChild(row);
      els.changesList.appendChild(li);
    });
  }

  function renderHistory() {
    clear(els.historyList);
    state.history.forEach(function (entry) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "repo-history__item";
      if (state.viewingHistory && state.viewingHistory.id === entry.id) {
        btn.className += " is-selected";
      }
      var title = document.createElement("span");
      title.textContent = entry.title;
      btn.appendChild(title);
      var meta = document.createElement("span");
      meta.className = "repo-history__meta";
      meta.textContent = entry.date + " · " + entry.note;
      btn.appendChild(meta);
      btn.addEventListener("click", function () {
        selectHistory(entry.id);
      });
      li.appendChild(btn);
      els.historyList.appendChild(li);
    });
  }

  function renderMobile() {
    clear(els.mobileReflections);
    state.reflections.forEach(function (reflection) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "repo-reflections__item";
      if (state.selected && state.selected.kind === "reflection" && state.selected.id === reflection.id) {
        btn.className += " is-selected";
      }
      btn.textContent = reflection.title;
      btn.addEventListener("click", function () {
        selectReflection(reflection.id);
      });
      li.appendChild(btn);
      els.mobileReflections.appendChild(li);
    });

    clear(els.mobileTree);
    state.folders.forEach(function (folder) {
      var heading = document.createElement("p");
      heading.className = "repo-sidebar__heading";
      heading.textContent = folder.name;
      els.mobileTree.appendChild(heading);
      var list = document.createElement("ul");
      list.className = "repo-reflections__list";
      folder.pieces.forEach(function (piece) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "repo-tree__piece";
        if (state.selected && state.selected.kind === "piece" && state.selected.id === piece.id) {
          btn.className += " is-selected";
        }
        btn.textContent = piece.title || "Untitled";
        btn.addEventListener("click", function () {
          selectPiece(piece.id);
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
      els.mobileTree.appendChild(list);
    });

    els.mobilePiece.hidden = true;
    if (state.viewingHistory) {
      els.mobilePiece.hidden = false;
      text(els.mobileTitle, state.viewingHistory.title);
      text(els.mobileBody, state.viewingHistory.body);
      return;
    }
    if (state.selected && state.selected.kind === "reflection") {
      var reflection = findReflection(state.selected.id);
      if (reflection) {
        els.mobilePiece.hidden = false;
        text(els.mobileTitle, reflection.title);
        text(els.mobileBody, reflection.body);
      }
      return;
    }
    if (state.selected && state.selected.kind === "piece") {
      var found = findPiece(state.selected.id);
      if (found) {
        els.mobilePiece.hidden = false;
        text(els.mobileTitle, found.piece.title);
        text(els.mobileBody, found.piece.body);
      }
    }
  }

  function render() {
    text(els.name, state.name);
    text(els.branch, state.branchLabel);
    renderReflections();
    renderTree();
    renderCenter();
    renderChanges();
    renderHistory();
    renderMobile();
  }

  if (els.newPiece) {
    els.newPiece.addEventListener("click", addNewPiece);
  }
  if (els.develop) {
    els.develop.addEventListener("click", developReflection);
  }
  if (els.title) {
    els.title.addEventListener("input", onTitleInput);
  }
  if (els.body) {
    els.body.addEventListener("input", onBodyInput);
  }
  if (els.changeNote) {
    els.changeNote.addEventListener("input", function () {
      state.changeNote = els.changeNote.value;
    });
  }
  if (els.saveVersion) {
    els.saveVersion.addEventListener("click", function () {
      if (els.saveHint) els.saveHint.hidden = false;
    });
  }

  render();
})();
