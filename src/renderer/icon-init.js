/* Renders the beginner seed mark to a PNG and hands it to the
 * main process so the OS dock / taskbar shows the brand icon
 * instead of the default Electron logo. Runs once at startup.
 *
 * Lives in the renderer because Electron's nativeImage doesn't
 * read SVG natively, but the renderer's <canvas> does. */

(async () => {
  if (!window.beginner || typeof window.beginner.setIcon !== "function") return;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
    <rect width="180" height="180" rx="40" fill="#2d5a3d"/>
    <path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/>
    <path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z"
          stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/>
    <path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/>
    <path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/>
  </svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, size, size);
    const dataUrl = canvas.toDataURL("image/png");
    await window.beginner.setIcon(dataUrl);
  } catch (err) {
    // Non-fatal — falls back to the default Electron icon.
    console.warn("[beginner] icon init failed:", err);
  } finally {
    URL.revokeObjectURL(url);
  }
})();
