/* Tiny storage adapter interface for /repo.
 *
 * Adapters share { id, label, available(), list(), write(), move(), remove() }:
 *   - local-folder / icloud / google-drive-desktop / cloud-* (Electron IPC)
 *   - fs-access (Chrome/Edge File System Access API)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("./storage-path-core.js") : null,
      typeof require === "function" ? require("./fs-access-folder.js") : null
    );
  } else {
    root.tinkerStorageAdapters = factory(
      root.tinkerStoragePathCore || null,
      root.tinkerFsAccessFolder || null
    );
  }
})(typeof self !== "undefined" ? self : this, function (pathCore, fsAccess) {
  "use strict";

  function hasCloudIpc() {
    return !!(
      typeof window !== "undefined" &&
      window.tinker &&
      typeof window.tinker.cloudStorageRoots === "function" &&
      typeof window.tinker.useCloudStorageRoot === "function"
    );
  }

  function hasNotesIpc() {
    return !!(
      typeof window !== "undefined" &&
      window.tinker &&
      typeof window.tinker.pickNotesFolder === "function" &&
      typeof window.tinker.writeNotesFile === "function"
    );
  }

  function hasFsAccess() {
    return !!(fsAccess && typeof fsAccess.isSupported === "function" && fsAccess.isSupported());
  }

  function isDesktopShell() {
    return !!(
      typeof window !== "undefined" &&
      window.tinker &&
      (window.tinker.isDesktopApp || window.tinker.supportsWebview)
    );
  }

  function isMobileWeb() {
    if (typeof window === "undefined") return false;
    if (isDesktopShell()) return false;
    if (fsAccess && typeof fsAccess.isAppleMobile === "function" && fsAccess.isAppleMobile()) {
      return true;
    }
    if (typeof navigator === "undefined") return false;
    return /Android|Mobile/i.test(String(navigator.userAgent || ""));
  }

  function localFolderAdapter(rootDir, opts) {
    var root = String(rootDir || "");
    var options = opts || {};
    return {
      id: options.id || "local-folder",
      label: options.label || "Mac folder",
      rootDir: root,
      kind: "electron",
      available: function () {
        return hasNotesIpc() && !!root;
      },
      list: function () {
        if (!hasNotesIpc()) return Promise.resolve([]);
        return window.tinker.listNotesFiles(root);
      },
      write: function (relPath, text) {
        return window.tinker.writeNotesFile(root, relPath, text);
      },
      move: function (from, to) {
        return window.tinker.moveNotesFile(root, from, to);
      },
      remove: function (relPath) {
        return window.tinker.removeNotesFile(root, relPath);
      },
    };
  }

  function cloudDesktopAdapter(kind, rootDir, label) {
    return localFolderAdapter(rootDir, {
      id: kind,
      label: label || kind,
    });
  }

  function fsAccessAdapter(handle, label) {
    var dir = handle || null;
    return {
      id: "fs-access",
      label: label || "Chosen folder",
      kind: "fs-access",
      handle: dir,
      available: function () {
        return hasFsAccess() && !!dir;
      },
      list: function () {
        if (!dir || !fsAccess) return Promise.resolve([]);
        return fsAccess.walkMarkdown(dir, "");
      },
      write: function (relPath, text) {
        if (!dir || !fsAccess) return Promise.resolve(false);
        return fsAccess.writeRel(dir, relPath, text);
      },
      move: function (from, to) {
        if (!dir || !fsAccess) return Promise.resolve(false);
        return fsAccess.moveRel(dir, from, to);
      },
      remove: function (relPath) {
        if (!dir || !fsAccess) return Promise.resolve(false);
        return fsAccess.removeRel(dir, relPath);
      },
    };
  }

  return {
    pathCore: pathCore,
    fsAccess: fsAccess,
    hasCloudIpc: hasCloudIpc,
    hasNotesIpc: hasNotesIpc,
    hasFsAccess: hasFsAccess,
    isDesktopShell: isDesktopShell,
    isMobileWeb: isMobileWeb,
    localFolderAdapter: localFolderAdapter,
    cloudDesktopAdapter: cloudDesktopAdapter,
    fsAccessAdapter: fsAccessAdapter,
  };
});
