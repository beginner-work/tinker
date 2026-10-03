/* Browser File System Access helpers for /repo storage roots.
 * showDirectoryPicker + IndexedDB handle persistence + nested Markdown IO.
 * Pure enough to load in Node tests (guards window/indexedDB).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerFsAccessFolder = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var IDB_NAME = "tinker-repo-storage";
  var IDB_STORE = "handles";
  var IDB_KEY = "root";
  var META_KEY = "tinker.repo.storageRoot.v1";

  function isAppleMobile() {
    if (typeof navigator === "undefined") return false;
    var ua = String(navigator.userAgent || "");
    if (/iPhone|iPod|iPad/i.test(ua)) return true;
    if (
      navigator.platform === "MacIntel" &&
      typeof navigator.maxTouchPoints === "number" &&
      navigator.maxTouchPoints > 1
    ) {
      return true;
    }
    return false;
  }

  function isSupported() {
    if (typeof window === "undefined") return false;
    if (isAppleMobile()) return false;
    if (window.isSecureContext === false) return false;
    return typeof window.showDirectoryPicker === "function";
  }

  function readMeta() {
    try {
      var raw = window.localStorage.getItem(META_KEY);
      if (!raw) return { folderName: "", kind: "" };
      var parsed = JSON.parse(raw);
      return {
        folderName: String((parsed && parsed.folderName) || ""),
        kind: String((parsed && parsed.kind) || ""),
        id: String((parsed && parsed.id) || ""),
        label: String((parsed && parsed.label) || ""),
        path: String((parsed && parsed.path) || ""),
      };
    } catch (e) {
      return { folderName: "", kind: "" };
    }
  }

  function writeMeta(meta) {
    try {
      if (!meta || (!meta.folderName && !meta.path && !meta.id)) {
        window.localStorage.removeItem(META_KEY);
        return;
      }
      window.localStorage.setItem(META_KEY, JSON.stringify({
        folderName: meta.folderName || "",
        kind: meta.kind || "",
        id: meta.id || "",
        label: meta.label || "",
        path: meta.path || "",
      }));
    } catch (e) { /* ignore */ }
  }

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
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

  async function ensurePermission(handle, mode) {
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

  async function ensureTinkerChild(rootHandle) {
    if (!rootHandle) return null;
    if (rootHandle.name === "Tinker") return rootHandle;
    return rootHandle.getDirectoryHandle("Tinker", { create: true });
  }

  async function pickDirectory() {
    if (!isSupported()) {
      throw Object.assign(new Error("Folder picker is not available here."), {
        name: "NotSupportedError",
      });
    }
    var handle = await window.showDirectoryPicker({ mode: "readwrite" });
    var tinker = await ensureTinkerChild(handle);
    await idbPutHandle(tinker);
    writeMeta({
      folderName: (tinker && tinker.name) || "Tinker",
      kind: "fs-access",
      id: "fs-access",
      label: handle.name ? handle.name + " / Tinker" : "Tinker",
      path: "",
    });
    return {
      handle: tinker,
      name: (tinker && tinker.name) || "Tinker",
      label: handle.name ? handle.name + " / Tinker" : "Tinker",
      parentName: handle.name || "",
    };
  }

  async function restoreDirectory() {
    if (!isSupported()) return null;
    try {
      var handle = await idbGetHandle();
      if (!handle) return null;
      var ok = await ensurePermission(handle, "readwrite");
      if (!ok) return null;
      var meta = readMeta();
      return {
        handle: handle,
        name: handle.name || meta.folderName || "Tinker",
        label: meta.label || handle.name || "Tinker",
      };
    } catch (e) {
      return null;
    }
  }

  async function clearDirectory() {
    try { await idbClearHandle(); } catch (e) { /* ignore */ }
    var meta = readMeta();
    if (meta.kind === "fs-access") writeMeta(null);
  }

  async function walkMarkdown(dirHandle, prefix) {
    var out = [];
    if (!dirHandle || !dirHandle.values) return out;
    for await (var entry of dirHandle.values()) {
      var rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.kind === "directory") {
        var nested = await walkMarkdown(entry, rel);
        out = out.concat(nested);
      } else if (entry.kind === "file" && /\.md$/i.test(entry.name)) {
        var file = await entry.getFile();
        var text = await file.text();
        out.push({
          relPath: rel.replace(/\\/g, "/"),
          text: text,
          mtimeMs: file.lastModified || 0,
        });
      }
    }
    return out;
  }

  async function writeRel(dirHandle, relPath, text) {
    var parts = String(relPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
    var name = parts.pop();
    if (!name) throw new Error("relPath required");
    var cursor = dirHandle;
    for (var i = 0; i < parts.length; i += 1) {
      cursor = await cursor.getDirectoryHandle(parts[i], { create: true });
    }
    var fileHandle = await cursor.getFileHandle(name, { create: true });
    var writable = await fileHandle.createWritable();
    await writable.write(String(text == null ? "" : text));
    await writable.close();
    return true;
  }

  async function removeRel(dirHandle, relPath) {
    var parts = String(relPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
    var name = parts.pop();
    if (!name) return false;
    var cursor = dirHandle;
    for (var i = 0; i < parts.length; i += 1) {
      cursor = await cursor.getDirectoryHandle(parts[i], { create: false });
    }
    await cursor.removeEntry(name);
    return true;
  }

  async function moveRel(dirHandle, fromRel, toRel) {
    if (fromRel === toRel) return true;
    var files = await walkMarkdown(dirHandle, "");
    var match = files.find(function (f) { return f.relPath === fromRel; });
    if (!match) return false;
    await writeRel(dirHandle, toRel, match.text);
    await removeRel(dirHandle, fromRel);
    return true;
  }

  return {
    META_KEY: META_KEY,
    isSupported: isSupported,
    isAppleMobile: isAppleMobile,
    readMeta: readMeta,
    writeMeta: writeMeta,
    pickDirectory: pickDirectory,
    restoreDirectory: restoreDirectory,
    clearDirectory: clearDirectory,
    ensurePermission: ensurePermission,
    walkMarkdown: walkMarkdown,
    writeRel: writeRel,
    removeRel: removeRel,
    moveRel: moveRel,
  };
});
