/* Notes folder sync — Settings row + two-way Markdown notepad files.
 *
 * Browser: File System Access API + IndexedDB directory handle.
 * Electron: native folder dialog + Node fs over IPC.
 * Unsupported (Safari/iOS): one plain line — notes still sync through Tinker.
 *
 * Syncs Lead.notes (the owner's notepad), not the composed outreach draft.
 * Choosing or clearing a folder never deletes server data. Outreach approval
 * lives on LeadDraft and is unchanged by notes-folder sync.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var META_KEY = "tinker.notesFolder.v1";
  var IDB_NAME = "tinker-notes-folder";
  var IDB_STORE = "handles";
  var IDB_KEY = "root";
  var WRITE_DEBOUNCE_MS = 700;
  var POLL_MS = 30000;
  var core = window.tinkerNotesFolderCore;
  if (!core) return;

  var state = {
    capability: "unsupported",
    folderName: "",
    electronPath: "",
    syncMeta: {}, // personId -> { relPath, lastSyncedBody, lastSyncedAt }
    notice: "",
    syncing: false,
    exporting: false,
  };
  var writeTimers = {};
  var pollTimer = null;
  var rootHandle = null; // FileSystemDirectoryHandle

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function loadMeta() {
    try {
      var raw = localStorage.getItem(META_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      state.folderName = String(parsed.folderName || "");
      state.electronPath = String(parsed.electronPath || "");
      state.syncMeta = parsed.syncMeta && typeof parsed.syncMeta === "object" ? parsed.syncMeta : {};
    } catch (e) { /* ignore */ }
  }

  function saveMeta() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify({
        folderName: state.folderName,
        electronPath: state.electronPath,
        syncMeta: state.syncMeta,
      }));
    } catch (e) { /* ignore */ }
  }

  /** iPhone / iPad (incl. desktop-mode iPadOS) cannot use showDirectoryPicker. */
  function isAppleMobile() {
    var ua = String(navigator.userAgent || "");
    if (/iPhone|iPod|iPad/i.test(ua)) return true;
    // iPadOS 13+ can report as Macintosh with touch.
    if (navigator.platform === "MacIntel" && typeof navigator.maxTouchPoints === "number"
      && navigator.maxTouchPoints > 1) {
      return true;
    }
    return false;
  }

  function detectCapability() {
    if (window.tinker && typeof window.tinker.pickNotesFolder === "function") {
      return "electron";
    }
    // Real Safari / iOS PWA: File System Access API is absent or unusable for
    // Drive-synced folders. Never show Choose folder there - clicks no-op.
    if (isAppleMobile()) return "unsupported";
    if (typeof window.showDirectoryPicker === "function" && window.isSecureContext !== false) {
      return "fs-access";
    }
    return "unsupported";
  }

  function hasFolder() {
    if (state.capability === "electron") return !!state.electronPath;
    if (state.capability === "fs-access") return !!rootHandle || !!state.folderName;
    return false;
  }

  // ── IndexedDB handle persistence (browser) ───────────────────────────

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("idb open failed")); };
    });
  }

  function idbPutHandle(handle) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function idbGetHandle() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readonly");
        var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); reject(req.error); };
      });
    });
  }

  function idbClearHandle() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  async function ensureFsPermission(handle, mode) {
    if (!handle) return false;
    var opts = { mode: mode || "readwrite" };
    if (handle.queryPermission) {
      var q = await handle.queryPermission(opts);
      if (q === "granted") return true;
    }
    if (handle.requestPermission) {
      var r = await handle.requestPermission(opts);
      return r === "granted";
    }
    return true;
  }

  // ── FS adapters ──────────────────────────────────────────────────────

  async function pickFolder() {
    if (state.capability === "electron") {
      var picked = await window.tinker.pickNotesFolder();
      if (!picked || !picked.path) return false;
      state.electronPath = picked.path;
      state.folderName = picked.name || folderBasename(picked.path);
      saveMeta();
      return true;
    }
    if (state.capability === "fs-access") {
      if (typeof window.showDirectoryPicker !== "function") {
        throw Object.assign(new Error("Folder picker is not available in this browser."), { name: "NotSupportedError" });
      }
      var handle = await window.showDirectoryPicker({ mode: "readwrite" });
      rootHandle = handle;
      state.folderName = handle.name || "Notes";
      state.electronPath = "";
      await idbPutHandle(handle);
      saveMeta();
      return true;
    }
    return false;
  }

  function pickerErrorMessage(err) {
    var name = err && err.name ? String(err.name) : "";
    if (name === "AbortError") return "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Could not open the folder picker. Allow file access, or try desktop Chrome or Edge.";
    }
    if (name === "NotSupportedError") {
      return "Folder picker is not available here. Use desktop Chrome, Edge, or the Mac app with a local folder (including one synced by Google Drive).";
    }
    return "Could not choose that folder. Pick a local folder (a Google Drive Desktop sync folder works on Mac/Windows).";
  }

  async function clearFolder() {
    rootHandle = null;
    state.folderName = "";
    state.electronPath = "";
    state.syncMeta = {};
    state.notice = "";
    saveMeta();
    if (state.capability === "fs-access") {
      try { await idbClearHandle(); } catch (e) { /* ignore */ }
    }
    if (state.capability === "electron" && window.tinker && window.tinker.clearNotesFolder) {
      try { await window.tinker.clearNotesFolder(); } catch (e) { /* ignore */ }
    }
  }

  async function restoreHandle() {
    if (state.capability === "electron") {
      return !!state.electronPath;
    }
    if (state.capability !== "fs-access") return false;
    try {
      var handle = await idbGetHandle();
      if (!handle) return false;
      var ok = await ensureFsPermission(handle, "readwrite");
      if (!ok) return false;
      rootHandle = handle;
      state.folderName = handle.name || state.folderName || "Notes";
      return true;
    } catch (e) {
      return false;
    }
  }

  function folderBasename(p) {
    var s = String(p || "").replace(/\\/g, "/");
    var parts = s.split("/").filter(Boolean);
    return parts[parts.length - 1] || "Notes";
  }

  async function readAllNotes() {
    if (state.capability === "electron" && state.electronPath) {
      var list = await window.tinker.listNotesFiles(state.electronPath);
      return (Array.isArray(list) ? list : []).map(function (item) {
        var parsed = core.parseNote(item.text || "");
        return {
          relPath: item.relPath,
          text: item.text || "",
          personId: parsed.personId,
          companyId: parsed.companyId,
          updatedAt: parsed.updatedAt,
          body: parsed.body,
          mtimeMs: item.mtimeMs || 0,
        };
      });
    }
    if (state.capability === "fs-access" && rootHandle) {
      return walkDirectory(rootHandle, "");
    }
    return [];
  }

  async function walkDirectory(dirHandle, prefix) {
    var out = [];
    for await (var entry of dirHandle.values()) {
      var rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.kind === "directory") {
        var nested = await walkDirectory(entry, rel);
        out = out.concat(nested);
      } else if (entry.kind === "file" && /\.md$/i.test(entry.name)) {
        var file = await entry.getFile();
        var text = await file.text();
        var parsed = core.parseNote(text);
        out.push({
          relPath: rel.replace(/\\/g, "/"),
          text: text,
          personId: parsed.personId,
          companyId: parsed.companyId,
          updatedAt: parsed.updatedAt,
          body: parsed.body,
          mtimeMs: file.lastModified || 0,
        });
      }
    }
    return out;
  }

  async function writeNoteFile(relPath, text) {
    if (state.capability === "electron" && state.electronPath) {
      await window.tinker.writeNotesFile(state.electronPath, relPath, text);
      return;
    }
    if (state.capability === "fs-access" && rootHandle) {
      await writeViaHandle(rootHandle, relPath, text);
    }
  }

  async function writeViaHandle(dirHandle, relPath, text) {
    var parts = String(relPath).replace(/\\/g, "/").split("/").filter(Boolean);
    var name = parts.pop();
    var cursor = dirHandle;
    for (var i = 0; i < parts.length; i++) {
      cursor = await cursor.getDirectoryHandle(parts[i], { create: true });
    }
    var fileHandle = await cursor.getFileHandle(name, { create: true });
    var writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function moveNoteFile(fromRel, toRel) {
    if (fromRel === toRel) return;
    if (state.capability === "electron" && state.electronPath) {
      await window.tinker.moveNotesFile(state.electronPath, fromRel, toRel);
      return;
    }
    if (state.capability === "fs-access" && rootHandle) {
      var files = await readAllNotes();
      var match = files.find(function (f) { return f.relPath === fromRel; });
      if (!match) return;
      await writeNoteFile(toRel, match.text);
      await removeNoteFile(fromRel);
    }
  }

  async function removeNoteFile(relPath) {
    if (state.capability === "electron" && state.electronPath) {
      await window.tinker.removeNotesFile(state.electronPath, relPath);
      return;
    }
    if (state.capability === "fs-access" && rootHandle) {
      var parts = String(relPath).replace(/\\/g, "/").split("/").filter(Boolean);
      var name = parts.pop();
      var cursor = rootHandle;
      for (var i = 0; i < parts.length; i++) {
        cursor = await cursor.getDirectoryHandle(parts[i], { create: false });
      }
      await cursor.removeEntry(name);
    }
  }

  // ── API helpers ──────────────────────────────────────────────────────

  function api(path, method, action, body, query) {
    var q = new URLSearchParams(Object.assign({ action: action }, query || {}));
    var opts = {
      method: method,
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    };
    if (method !== "GET") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body || {});
    }
    return fetch(path + "?" + q.toString(), opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok) {
          var err = new Error((payload && payload.error) || "Request failed");
          err.status = res.status;
          throw err;
        }
        return payload;
      });
    });
  }

  // ── Export / import / conflict ───────────────────────────────────────

  function setPersonMeta(personId, patch) {
    var id = String(personId || "");
    if (!id) return;
    var cur = state.syncMeta[id] || {};
    state.syncMeta[id] = Object.assign({}, cur, patch);
    saveMeta();
  }

  async function exportPerson(person) {
    if (!hasFolder() || !person || !person.id) return;
    var companyName = person.companyName || person.company || "Unknown";
    var personName = person.personName || "Unknown";
    var rel = core.noteRelPath(companyName, personName);
    var meta = state.syncMeta[person.id] || {};
    var rename = core.resolveRename(companyName, personName, meta.relPath);
    if (rename.moved) {
      try { await moveNoteFile(rename.from, rename.to); } catch (e) { /* write fresh below */ }
    }
    var text = core.serializeNote({
      personId: person.id,
      companyId: person.companyId || "",
      updatedAt: person.updatedAt || new Date().toISOString(),
      body: person.body || "",
    });
    await writeNoteFile(rename.to, text);
    setPersonMeta(person.id, {
      relPath: rename.to,
      lastSyncedBody: core.normalizeBody(person.body || ""),
      lastSyncedAt: new Date().toISOString(),
    });
  }

  async function exportAllExisting() {
    if (!token() || !hasFolder()) return;
    state.exporting = true;
    try {
      var results = await Promise.all([
        api("/api/leads", "GET", "list").catch(function () { return { leads: [] }; }),
        api("/api/leads", "GET", "companies").catch(function () { return { companies: [] }; }),
      ]);
      var leads = Array.isArray(results[0].leads) ? results[0].leads : [];
      var companies = Array.isArray(results[1].companies) ? results[1].companies : [];
      var companyById = {};
      companies.forEach(function (c) { if (c && c.id) companyById[c.id] = c; });

      for (var i = 0; i < leads.length; i++) {
        var lead = leads[i];
        if (!lead || !lead.id) continue;
        var co = (lead.companyId && companyById[lead.companyId]) || null;
        await exportPerson({
          id: lead.id,
          personName: lead.personName,
          companyName: (co && co.name) || lead.company || "",
          companyId: lead.companyId || (co && co.id) || "",
          body: lead.notes || "",
          updatedAt: lead.updatedAt || new Date().toISOString(),
        });
      }
    } finally {
      state.exporting = false;
      renderSettings();
    }
  }

  async function importChangedIntoServer(personId, body, appBody) {
    var nextBody = core.normalizeBody(body);
    // Never drop a completed ### __done__ marker when the file lags the app.
    var app = core.normalizeBody(appBody || "");
    if (/(?:^|\n)###\s*__done__\s*(?:\n|$)/.test(app)
      && !/(?:^|\n)###\s*__done__\s*(?:\n|$)/.test(nextBody)) {
      nextBody = nextBody.replace(/\n+$/, "");
      nextBody = (nextBody ? nextBody + "\n\n" : "") + "### __done__\n";
    }
    var patched = await api("/api/leads", "PATCH", "edit", { notes: nextBody }, { id: personId });
    return patched && patched.lead;
  }

  async function syncOnce() {
    if (!hasFolder() || state.syncing || !token()) return;
    if (state.capability === "fs-access" && !rootHandle) {
      var restored = await restoreHandle();
      if (!restored) return;
    }
    state.syncing = true;
    try {
      var files = await readAllNotes();
      var results = await Promise.all([
        api("/api/leads", "GET", "list").catch(function () { return { leads: [] }; }),
        api("/api/leads", "GET", "companies").catch(function () { return { companies: [] }; }),
      ]);
      var leads = Array.isArray(results[0].leads) ? results[0].leads : [];
      var companies = Array.isArray(results[1].companies) ? results[1].companies : [];
      var companyById = {};
      companies.forEach(function (c) { if (c && c.id) companyById[c.id] = c; });
      var noticed = "";

      for (var i = 0; i < leads.length; i++) {
        var lead = leads[i];
        if (!lead || !lead.id) continue;
        var appBody = lead.notes || "";
        var appUpdatedAt = lead.updatedAt || "";
        var co = (lead.companyId && companyById[lead.companyId]) || null;
        var companyName = (co && co.name) || lead.company || "";
        var meta = state.syncMeta[lead.id] || {};
        var expectedRel = core.noteRelPath(companyName, lead.personName);
        var file = core.findFileForPerson(files, lead.id, meta.relPath || expectedRel);

        if (!file) {
          // No file yet — export current app state.
          await exportPerson({
            id: lead.id,
            personName: lead.personName,
            companyName: companyName,
            companyId: lead.companyId || (co && co.id) || "",
            body: appBody,
            updatedAt: appUpdatedAt || new Date().toISOString(),
          });
          continue;
        }

        // Handle rename/move when names changed.
        var rename = core.resolveRename(companyName, lead.personName, file.relPath);
        if (rename.moved) {
          try {
            await moveNoteFile(rename.from, rename.to);
            file = Object.assign({}, file, { relPath: rename.to });
          } catch (e) { /* continue with old path */ }
        }

        var decision = core.resolveSync({
          appBody: appBody,
          fileBody: file.body,
          lastSyncedBody: meta.lastSyncedBody || "",
          appUpdatedAt: appUpdatedAt,
          fileUpdatedAt: file.updatedAt || "",
        });

        if (decision.action === "export" || decision.action === "noop") {
          if (decision.action === "export") {
            await exportPerson({
              id: lead.id,
              personName: lead.personName,
              companyName: companyName,
              companyId: lead.companyId || (co && co.id) || "",
              body: appBody,
              updatedAt: appUpdatedAt || new Date().toISOString(),
            });
          } else {
            setPersonMeta(lead.id, {
              relPath: file.relPath,
              lastSyncedBody: core.normalizeBody(appBody),
              lastSyncedAt: new Date().toISOString(),
            });
          }
        } else if (decision.action === "import") {
          var updated = await importChangedIntoServer(lead.id, decision.body, appBody);
          var importedBody = (updated && updated.notes != null) ? updated.notes : decision.body;
          setPersonMeta(lead.id, {
            relPath: file.relPath,
            lastSyncedBody: core.normalizeBody(importedBody),
            lastSyncedAt: new Date().toISOString(),
          });
          // Refresh open notepad if this lead is active.
          if (window.tinkerMessagesComposer && typeof window.tinkerMessagesComposer.applyImportedBody === "function") {
            window.tinkerMessagesComposer.applyImportedBody(lead.id, importedBody, updated);
          }
        } else if (decision.action === "conflict") {
          var conflictPath = core.conflictRelPath(file.relPath);
          var conflictText = core.serializeNote({
            personId: lead.id,
            companyId: lead.companyId || (co && co.id) || "",
            updatedAt: file.updatedAt || new Date().toISOString(),
            body: decision.conflictBody || file.body,
          });
          await writeNoteFile(conflictPath, conflictText);
          await exportPerson({
            id: lead.id,
            personName: lead.personName,
            companyName: companyName,
            companyId: lead.companyId || (co && co.id) || "",
            body: appBody,
            updatedAt: appUpdatedAt || new Date().toISOString(),
          });
          noticed = decision.notice || noticed;
        }
      }
      if (noticed) {
        state.notice = noticed;
        renderSettings();
        // Also a quiet notice on the inbox if present.
        showQuietNotice(noticed);
      }
    } catch (e) {
      /* keep quiet — folder may be locked or permission revoked */
    } finally {
      state.syncing = false;
    }
  }

  function showQuietNotice(text) {
    var existing = document.querySelector("[data-notes-folder-notice]");
    if (!existing) {
      existing = document.createElement("p");
      existing.setAttribute("data-notes-folder-notice", "1");
      existing.className = "notes-folder-notice";
      existing.style.cssText = "margin:8px 20px;font-size:13px;color:var(--color-muted,#666);";
      var host = document.querySelector("#messages-pane") || document.body;
      host.insertBefore(existing, host.firstChild);
    }
    existing.textContent = text;
    existing.hidden = false;
    setTimeout(function () { existing.hidden = true; }, 8000);
  }

  function scheduleWrite(person) {
    if (!person || !person.id || !hasFolder()) return;
    var id = person.id;
    if (writeTimers[id]) clearTimeout(writeTimers[id]);
    writeTimers[id] = setTimeout(function () {
      writeTimers[id] = null;
      exportPerson(person).catch(function () { /* ignore */ });
    }, WRITE_DEBOUNCE_MS);
  }

  // ── Settings UI ──────────────────────────────────────────────────────

  function renderSettings() {
    var row = document.querySelector("[data-notes-folder]");
    if (!row) return;
    var pathEl = row.querySelector("[data-notes-folder-path]");
    var pickBtn = row.querySelector("[data-notes-folder-pick]");
    var clearBtn = row.querySelector("[data-notes-folder-clear]");
    var unsupported = row.querySelector("[data-notes-folder-unsupported]");
    var status = row.querySelector("[data-notes-folder-status]");
    var actions = row.querySelector("[data-notes-folder-actions]");

    if (state.capability === "unsupported") {
      if (actions) actions.hidden = true;
      if (pathEl) pathEl.hidden = true;
      if (unsupported) {
        unsupported.hidden = false;
        unsupported.textContent = isAppleMobile()
          ? "Choosing a folder needs desktop Chrome, Edge, or the Mac app (a Google Drive Desktop folder works there). On iPhone, notes still sync through Tinker."
          : "Folder picker needs desktop Chrome, Edge, or the Mac app. Notes still sync through Tinker.";
      }
      return;
    }
    if (pathEl) pathEl.hidden = false;
    if (unsupported) unsupported.hidden = true;
    if (actions) actions.hidden = false;
    if (pathEl) {
      pathEl.textContent = hasFolder() ? (state.folderName || "Selected folder") : "No folder selected";
    }
    if (pickBtn) pickBtn.textContent = hasFolder() ? "Change" : "Choose folder";
    if (clearBtn) clearBtn.hidden = !hasFolder();
    if (status) {
      if (state.notice) {
        status.hidden = false;
        status.textContent = state.notice;
      } else if (state.exporting) {
        status.hidden = false;
        status.textContent = "Exporting notes…";
      } else {
        status.hidden = true;
        status.textContent = "";
      }
    }
  }

  function bindSettings() {
    var row = document.querySelector("[data-notes-folder]");
    if (!row || row.getAttribute("data-bound") === "1") return;
    row.setAttribute("data-bound", "1");
    var pickBtn = row.querySelector("[data-notes-folder-pick]");
    var clearBtn = row.querySelector("[data-notes-folder-clear]");
    if (pickBtn) {
      pickBtn.addEventListener("click", function () {
        if (state.capability === "unsupported") {
          state.notice = pickerErrorMessage({ name: "NotSupportedError" });
          renderSettings();
          return;
        }
        pickBtn.disabled = true;
        state.notice = "";
        // Call showDirectoryPicker in this turn (user gesture) - do not await
        // anything before pickFolder's picker call.
        pickFolder()
          .then(function (ok) {
            if (!ok) return;
            state.notice = "";
            renderSettings();
            return exportAllExisting().then(function () { return syncOnce(); });
          })
          .catch(function (err) {
            var msg = pickerErrorMessage(err);
            if (msg) state.notice = msg;
          })
          .finally(function () {
            pickBtn.disabled = false;
            renderSettings();
          });
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        clearBtn.disabled = true;
        clearFolder()
          .then(function () { renderSettings(); })
          .finally(function () { clearBtn.disabled = false; });
      });
    }
    renderSettings();
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (!document.hidden) syncOnce();
    }, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) syncOnce();
    });
    window.addEventListener("focus", function () { syncOnce(); });
  }

  function boot() {
    state.capability = detectCapability();
    loadMeta();
    bindSettings();
    restoreHandle().then(function () {
      renderSettings();
      if (hasFolder()) syncOnce();
    });
    startPolling();
  }

  window.tinkerNotesFolder = {
    scheduleWrite: scheduleWrite,
    syncNow: syncOnce,
    exportPerson: exportPerson,
    hasFolder: hasFolder,
    capability: function () { return state.capability; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
