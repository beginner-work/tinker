"use strict";

// Only the first-party top-level window may request local plan-backed inference.
// No runtime paths, credentials, shell commands, or arbitrary CLI args cross IPC.
function registerCodexExerciseIpc({ ipcMain, isTinkerUrl, service, dialog, clipboard, BrowserWindow }) {
  const active = new Map();
  function trusted(event) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
        !isTinkerUrl(event.senderFrame.url)) {
      throw new Error("Codex is only available in the Tinker desktop window.");
    }
  }
  ipcMain.handle("exercises:codexStatus", async (event) => {
    trusted(event);
    return service.checkStatus();
  });
  ipcMain.handle("exercises:codexSetup", async (event) => {
    trusted(event);
    const status = await service.checkStatus();
    const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
      type: "info",
      title: "Codex exercise feedback",
      message: status.authenticated ? "Codex is signed in with ChatGPT." : "Sign in to Codex with your ChatGPT plan",
      detail: "Install or update the official Codex CLI first (npm install -g @openai/codex), then restart Tinker. Run this command in " +
        (status.setupShell === "powershell" ? "PowerShell" : "Terminal") +
        " and complete sign-in in your browser. Tinker uses a separate Codex sign-in folder. Your plan's Codex usage limits apply. Return to the exercise and choose Retry.\n\n" + status.setupCommand,
      buttons: ["Copy sign-in command", "Close"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) clipboard.writeText(status.setupCommand);
    return { authenticated: status.authenticated };
  });
  ipcMain.handle("exercises:codexCancel", (event) => {
    trusted(event);
    const job = active.get(event.sender.id);
    if (job) job.abort();
    return !!job;
  });
  ipcMain.handle("exercises:codexRevise", async (event, input) => {
    trusted(event);
    const sender = event.sender;
    if (active.has(sender.id)) throw new Error("An exercise revision is already running. Cancel it or wait for it to finish.");
    const controller = new AbortController();
    active.set(sender.id, controller);
    const cancel = () => controller.abort();
    const navigating = (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) cancel();
    };
    sender.once("destroyed", cancel);
    sender.on("did-start-navigation", navigating);
    try {
      return await service.revise(input, { signal: controller.signal });
    } finally {
      active.delete(sender.id);
      sender.removeListener("destroyed", cancel);
      sender.removeListener("did-start-navigation", navigating);
    }
  });
}

module.exports = { registerCodexExerciseIpc };
