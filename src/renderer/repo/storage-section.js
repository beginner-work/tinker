/* /repo physical Location options (cloud roots + web Choose folder).
 *
 * Registers into the Location dropdown via
 * window.tinkerRepo.registerLocationSection({ key: "storage", getOptions, onSelect }).
 * Mac: one-click iCloud / Google Drive / other CloudStorage roots.
 * Desktop Chrome/Edge: Choose folder via File System Access API.
 * Mobile web: one quiet note that cloud folders sync from the Mac app.
 * Mac folder… and Custom location… stay in repo.js (desktop IPC).
 */
(function () {
  "use strict";

  var adapters = window.tinkerStorageAdapters;
  var fsAccess = window.tinkerFsAccessFolder;
  if (!adapters) return;

  var STORAGE_EVENT = "tinker-storage-root-changed";

  var state = {
    roots: [],
    selected: null, // { id, label, path, kind }
    handle: null,
    busy: false,
    loaded: false,
  };

  function readSelectedFromMeta() {
    if (!fsAccess) return null;
    var meta = fsAccess.readMeta();
    if (!meta) return null;
    if (meta.kind === "electron" && meta.path) {
      return {
        id: meta.id || "electron",
        label: meta.label || meta.folderName || "Tinker",
        path: meta.path,
        kind: "electron",
      };
    }
    if (meta.kind === "fs-access" && meta.folderName) {
      return {
        id: meta.id || "fs-access",
        label: meta.label || meta.folderName,
        path: "",
        kind: "fs-access",
      };
    }
    return null;
  }

  function persistElectronRoot(info) {
    if (!fsAccess) return;
    fsAccess.writeMeta({
      folderName: (info && info.name) || "Tinker",
      kind: "electron",
      id: (info && info.id) || "",
      label: (info && info.label) || ((info && info.name) || "Tinker"),
      path: (info && info.path) || "",
    });
  }

  function applySelected(info) {
    state.selected = info
      ? {
        id: info.id || "",
        label: info.label || info.name || "Tinker",
        path: info.path || "",
        kind: info.kind || (info.path ? "electron" : "fs-access"),
        name: info.name || info.label || "Tinker",
      }
      : null;
  }

  function emitRootChanged(info) {
    applySelected(info);
    try {
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: state.selected }));
    } catch (e) { /* ignore */ }
    refreshHost();
  }

  function refreshHost() {
    if (window.tinkerRepo && typeof window.tinkerRepo.refreshLocation === "function") {
      try { window.tinkerRepo.refreshLocation(); } catch (e) { /* ignore */ }
    }
  }

  function loadCloudRoots() {
    if (!adapters.hasCloudIpc()) {
      state.roots = [];
      state.loaded = true;
      return Promise.resolve([]);
    }
    return window.tinker.cloudStorageRoots().then(function (rows) {
      state.roots = Array.isArray(rows) ? rows : [];
      state.loaded = true;
      return state.roots;
    }).catch(function () {
      state.roots = [];
      state.loaded = true;
      return state.roots;
    });
  }

  function useCloudRoot(id) {
    if (!adapters.hasCloudIpc() || state.busy) return;
    state.busy = true;
    refreshHost();
    window.tinker.useCloudStorageRoot(id).then(function (picked) {
      state.busy = false;
      if (!picked || !picked.path) {
        refreshHost();
        return;
      }
      var info = {
        id: picked.id || id,
        label: picked.label || id,
        name: picked.name || "Tinker",
        path: picked.path,
        kind: "electron",
      };
      persistElectronRoot(info);
      emitRootChanged(info);
    }).catch(function () {
      state.busy = false;
      refreshHost();
    });
  }

  function chooseFsFolder() {
    if (!fsAccess || !fsAccess.isSupported() || state.busy) return;
    state.busy = true;
    refreshHost();
    fsAccess.pickDirectory().then(function (picked) {
      state.busy = false;
      if (!picked || !picked.handle) {
        refreshHost();
        return;
      }
      state.handle = picked.handle;
      emitRootChanged({
        id: "fs-access",
        label: picked.label || picked.name || "Tinker",
        name: picked.name || "Tinker",
        path: "",
        kind: "fs-access",
        handle: picked.handle,
      });
    }).catch(function (err) {
      state.busy = false;
      void err;
      refreshHost();
    });
  }

  function selectedDetail(root) {
    if (!state.selected) return "";
    if (state.selected.id === root.id) {
      return root.label + " / Tinker";
    }
    return "";
  }

  function getOptions() {
    // Mobile web (no desktop IPC, no FS Access): quiet Mac-app note only.
    if (adapters.isMobileWeb() && !adapters.hasCloudIpc()) {
      return [{
        id: "mobile-note",
        label: "Cloud folders sync from the Mac app.",
        detail: "",
        selected: false,
      }];
    }

    var options = [];

    if (adapters.hasCloudIpc()) {
      if (!state.loaded) {
        options.push({
          id: "cloud-loading",
          label: "Checking cloud folders…",
          detail: "",
          selected: false,
        });
      } else {
        state.roots.forEach(function (root) {
          var isSelected = !!(state.selected && state.selected.id === root.id);
          options.push({
            id: root.id,
            label: root.label,
            detail: isSelected ? (root.label + " / Tinker") : "",
            badge: root.installed ? "" : "not installed",
            selected: isSelected,
            installed: !!root.installed,
          });
        });
      }
    }

    if (!adapters.hasCloudIpc() && adapters.hasFsAccess()) {
      var fsSelected = !!(state.selected && state.selected.kind === "fs-access");
      options.push({
        id: "fs-access-choose",
        label: "Choose folder…",
        detail: fsSelected
          ? (state.selected.label || "Selected folder")
          : "Pick iCloud Drive or Google Drive through the OS picker",
        selected: fsSelected,
      });
    }

    if (!adapters.hasCloudIpc() && !adapters.hasFsAccess() && !adapters.isMobileWeb()) {
      options.push({
        id: "unsupported-note",
        label: "Cloud folders sync from the Mac app.",
        detail: "",
        selected: false,
      });
    }

    return options;
  }

  function onSelect(option) {
    if (!option || !option.id || state.busy) return;
    if (option.id === "mobile-note" || option.id === "unsupported-note" || option.id === "cloud-loading") {
      return;
    }
    if (option.badge === "not installed" || option.installed === false) return;
    if (option.id === "fs-access-choose") {
      chooseFsFolder();
      return;
    }
    useCloudRoot(option.id);
  }

  function register() {
    var host = window.tinkerRepo;
    if (!host || typeof host.registerLocationSection !== "function") return false;
    host.registerLocationSection({
      key: "storage",
      label: "",
      order: 100,
      getOptions: getOptions,
      onSelect: onSelect,
    });
    return true;
  }

  function boot() {
    state.selected = readSelectedFromMeta();
    if (!register()) {
      // Host script order: retry briefly if repo.js has not exported yet.
      var tries = 0;
      var timer = setInterval(function () {
        tries += 1;
        if (register() || tries > 40) clearInterval(timer);
      }, 25);
    }

    // Mac folder / Custom location picks from repo.js share this event.
    if (typeof window.addEventListener === "function") {
      window.addEventListener(STORAGE_EVENT, function (event) {
        var detail = event && event.detail;
        if (!detail) return;
        if (
          state.selected &&
          state.selected.id === detail.id &&
          state.selected.path === detail.path &&
          state.selected.kind === detail.kind
        ) {
          return;
        }
        applySelected(detail);
        if (detail.kind === "fs-access" && detail.handle) state.handle = detail.handle;
        refreshHost();
      });
    }

    var tasks = [];
    if (adapters.hasCloudIpc()) tasks.push(loadCloudRoots());
    else state.loaded = true;

    if (adapters.hasFsAccess() && fsAccess) {
      tasks.push(
        fsAccess.restoreDirectory().then(function (restored) {
          if (!restored || !restored.handle) return;
          state.handle = restored.handle;
          state.selected = {
            id: "fs-access",
            label: restored.label || restored.name || "Tinker",
            path: "",
            kind: "fs-access",
          };
        })
      );
    }

    Promise.all(tasks).then(function () {
      refreshHost();
    }).catch(function () {
      refreshHost();
    });
  }

  window.tinkerRepoStorage = {
    getSelected: function () { return state.selected; },
    getHandle: function () { return state.handle; },
    getAdapter: function () {
      if (state.selected && state.selected.kind === "electron" && state.selected.path) {
        return adapters.cloudDesktopAdapter(
          state.selected.id || "local-folder",
          state.selected.path,
          state.selected.label || "Tinker"
        );
      }
      if (state.selected && state.selected.kind === "fs-access" && state.handle) {
        return adapters.fsAccessAdapter(state.handle, state.selected.label || "Tinker");
      }
      return null;
    },
    refresh: function () {
      return loadCloudRoots().then(function () {
        refreshHost();
      });
    },
    STORAGE_EVENT: STORAGE_EVENT,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
