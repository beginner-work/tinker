const { contextBridge, ipcRenderer } = require("electron");

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
});
