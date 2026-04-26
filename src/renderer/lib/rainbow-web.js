/* Rainbow web mark — built from the shared style dictionary at
 * `src/renderer/tokens/rainbow-web.json`. Consumers (icon-init,
 * welcome-page header, etc.) call `buildRainbowWebSvg()` and get back
 * a self-contained SVG string. The dictionary is fetched once and
 * memoised. */

(function () {
  let tokensPromise = null;

  function loadTokens() {
    if (tokensPromise) return tokensPromise;
    tokensPromise = fetch("./tokens/rainbow-web.json", { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`tokens load failed: ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        tokensPromise = null;
        throw err;
      });
    return tokensPromise;
  }

  function octagonPoints(cx, cy, r, sides) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const angle = ((i * 360) / sides - 90) * (Math.PI / 180);
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return pts.join(" ");
  }

  function buildSvgFromTokens(t, opts = {}) {
    const [, , vbW, vbH] = t.viewBox.split(" ").map(Number);
    const cx = vbW / 2;
    const cy = vbH / 2;
    const sides = t.spokes.count;
    const background = opts.background ?? t.background;

    const spokes = Array.from({ length: sides })
      .map((_, i) => {
        const angle = ((i * 360) / sides - 90) * (Math.PI / 180);
        const x2 = (cx + t.spokes.length * Math.cos(angle)).toFixed(2);
        const y2 = (cy + t.spokes.length * Math.sin(angle)).toFixed(2);
        return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${t.spokes.color}" stroke-width="${t.spokes.strokeWidth}" stroke-linecap="round" opacity="${t.spokes.opacity}"/>`;
      })
      .join("");

    const rings = t.rings
      .map(
        (r) =>
          `<polygon points="${octagonPoints(cx, cy, r.radius, sides)}" fill="none" stroke="${r.color}" stroke-width="${t.ringStrokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`
      )
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${t.viewBox}" fill="none">
  <rect width="${vbW}" height="${vbH}" rx="${t.cornerRadius}" fill="${background}"/>
  ${spokes}
  ${rings}
  <circle cx="${cx}" cy="${cy}" r="${t.center.radius}" fill="${t.center.color}"/>
</svg>`;
  }

  async function buildRainbowWebSvg(opts) {
    const tokens = await loadTokens();
    return buildSvgFromTokens(tokens, opts || {});
  }

  window.beginnerLogo = window.beginnerLogo || {};
  window.beginnerLogo.tokens = loadTokens; // exposed for callers who want raw values
  window.beginnerLogo.buildRainbowWebSvg = buildRainbowWebSvg;
})();
