/* Renders the rainbow globe mark to a PNG and hands it to the main
 * process so the OS dock / taskbar shows the desktop-app brand
 * icon instead of the default Electron logo. The mark is built
 * from the shared style dictionary in `tokens/rainbow-globe.json`
 * (twin of beginner-work/beginner ui/src/tokens/rainbow-globe.json),
 * so any palette / geometry change there flows here automatically.
 *
 * Lives in the renderer because Electron's nativeImage doesn't read
 * SVG natively, but the renderer's <canvas> does. */

(async () => {
  if (!window.beginner || typeof window.beginner.setIcon !== "function") return;
  if (!window.beginnerLogo || typeof window.beginnerLogo.buildRainbowGlobeSvg !== "function") {
    console.warn("[beginner] rainbow-globe helper not loaded");
    return;
  }

  let svg;
  try {
    svg = await window.beginnerLogo.buildRainbowGlobeSvg();
  } catch (err) {
    console.warn("[beginner] icon init failed:", err);
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

    // macOS dock / Windows taskbar icons expect ~10% padding around
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
    await window.beginner.setIcon(dataUrl);
  } catch (err) {
    console.warn("[beginner] icon init failed:", err);
  } finally {
    URL.revokeObjectURL(url);
  }
})();
