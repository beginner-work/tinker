const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tinkerDock", {
  close: () => ipcRenderer.send("dock:close"),
  openBrowser: () => ipcRenderer.send("dock:openBrowser"),
  onTitle: (cb) => {
    ipcRenderer.on("dock:title", (_e, title) => {
      try { cb(title); } catch { /* ignore */ }
    });
  },
});
