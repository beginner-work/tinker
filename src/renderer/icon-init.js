/* Renders the globe mark to a PNG and hands it to the main process
 * so the OS dock / taskbar shows the tinker brand icon instead of
 * the default Electron logo. The mark is built from the shared
 * style dictionary in `tokens/rainbow-web.json`, so any palette /
 * geometry change there flows here automatically.
 *
 * Lives in the renderer because Electron's nativeImage doesn't read
 * SVG natively, but the renderer's <canvas> does.
 *
 * macOS: skip setIcon entirely. The packaged .icns already carries the
 * system app-icon mask; a runtime PNG override is what made the Dock
 * tile look square while the app was active. */

(async () => {
  if (!window.tinker || typeof window.tinker.setIcon !== "function") return;

  try {
    if (typeof window.tinker.platform === "function") {
      const platform = await window.tinker.platform();
      if (platform === "darwin") return;
    }
  } catch (err) {
    // If platform lookup fails, still try to set a window icon below.
  }

  if (!window.tinkerLogo || typeof window.tinkerLogo.buildRainbowWebSvg !== "function") {
    console.warn("[tinker] globe helper not loaded");
    return;
  }

  let svg;
  try {
    svg = await window.tinkerLogo.buildRainbowWebSvg();
  } catch (err) {
    console.warn("[tinker] icon init failed:", err);
    return;
  }

  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    // Windows / Linux taskbar icons expect ~10% padding around
    // the artwork — without it the mark looks oversized next to
    // neighbouring app icons. Inset the SVG inside a transparent
    // canvas instead of touching the source artwork.
    const size = 1024;
    const padding = Math.round(size * 0.1);
    const inner = size - padding * 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, padding, padding, inner, inner);
    const dataUrl = canvas.toDataURL("image/png");
    await window.tinker.setIcon(dataUrl);
  } catch (err) {
    console.warn("[tinker] icon init failed:", err);
  } finally {
    URL.revokeObjectURL(url);
  }
})();
