const { contextBridge, ipcRenderer } = require("electron");

// Mark the document as the desktop shell as early as possible so CSS can
// gate traffic-light padding and drag regions without affecting browsers.
// Remote navigations (https://tinker.beginner.work) can briefly lack a
// documentElement at preload eval time — retry across several hooks so
// the attribute is set before / as the first paint settles.
function markDesktopDocument() {
  try {
    const root = document.documentElement;
    if (!root) return false;
    if (root.getAttribute("data-tinker-desktop") === "1") {
      root.classList.add("tinker-desktop");
      return true;
    }
    root.setAttribute("data-tinker-desktop", "1");
    root.classList.add("tinker-desktop");
    return true;
  } catch {
    return false;
  }
}

function armDesktopMark() {
  if (markDesktopDocument()) return;

  let tries = 0;
  const tick = () => {
    if (markDesktopDocument() || ++tries > 40) {
      clearInterval(interval);
      return;
    }
  };
  const interval = setInterval(tick, 16);

  try {
    const obs = new MutationObserver(() => {
      if (markDesktopDocument()) {
        obs.disconnect();
        clearInterval(interval);
      }
    });
    obs.observe(document, { childList: true, subtree: true });
  } catch {
    // document may be unavailable for a tick on some navigations
  }

  try {
    document.addEventListener("DOMContentLoaded", () => {
      markDesktopDocument();
    });
  } catch {
    /* ignore */
  }

  try {
    window.addEventListener("DOMContentLoaded", () => {
      markDesktopDocument();
    });
  } catch {
    /* ignore */
  }
}

armDesktopMark();

// Desktop bridge for the production web app loaded in BrowserWindow.
// platform-mobile.js merges these into window.tinker (keeps callClaude
// from the web shim) so notes-folder sync and dock icon still work.
contextBridge.exposeInMainWorld("tinker", {
  version: () => ipcRenderer.invoke("app:version"),
  platform: () => ipcRenderer.invoke("app:platform"),
  setIcon: (dataUrl) => ipcRenderer.invoke("app:setIcon", dataUrl),
  // Closes the focused window — backs the post-publish "Close app" button.
  close: () => ipcRenderer.invoke("app:close"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  // Marks this runtime as the Electron shell so PWA install / SW registration
  // stay out of the way. Not a browser webview host — there is no quiet-
  // browser webview chrome anymore.
  supportsWebview: true,
  isDesktopApp: true,
  // Notes folder: native directory access for Markdown notepad files.
  pickNotesFolder: () => ipcRenderer.invoke("notesFolder:pick"),
  clearNotesFolder: () => Promise.resolve(true),
  listNotesFiles: (rootDir) => ipcRenderer.invoke("notesFolder:list", rootDir),
  writeNotesFile: (rootDir, relPath, text) =>
    ipcRenderer.invoke("notesFolder:write", rootDir, relPath, text),
  moveNotesFile: (rootDir, fromRel, toRel) =>
    ipcRenderer.invoke("notesFolder:move", rootDir, fromRel, toRel),
  removeNotesFile: (rootDir, relPath) =>
    ipcRenderer.invoke("notesFolder:remove", rootDir, relPath),
  // Cloud roots (iCloud / Google Drive for desktop). Missing on older builds.
  cloudStorageRoots: () => ipcRenderer.invoke("storage:cloudRoots"),
  useCloudStorageRoot: (id) => ipcRenderer.invoke("storage:useCloudRoot", id),
  // Typed path for Files → Saved in → Custom location… Missing on older builds.
  useCustomStoragePath: (rawPath) => ipcRenderer.invoke("storage:useCustomPath", rawPath),
  // Exercises: local clone of tlindow/lindowlabs + Open in IDE.
  // Missing on older builds; renderer falls back to GitHub.
  getExerciseLabSettings: () => ipcRenderer.invoke("exercises:getSettings"),
  setExerciseLabSettings: (patch) => ipcRenderer.invoke("exercises:setSettings", patch),
  pickExerciseLabPath: () => ipcRenderer.invoke("exercises:pickClonePath"),
  openExerciseModule: (moduleId, opts) =>
    ipcRenderer.invoke("exercises:openModule", moduleId, opts || {}),
});
