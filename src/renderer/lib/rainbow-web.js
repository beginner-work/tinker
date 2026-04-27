/* Multi-colored globe mark — built from the shared style dictionary
 * at `src/renderer/tokens/rainbow-web.json`. Consumers (icon-init,
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

  function buildSvgFromTokens(t, opts = {}) {
    const [, , vbW, vbH] = t.viewBox.split(" ").map(Number);
    const { cx, cy, radius: r, color: ringColor } = t.globe;
    const sw = t.strokeWidth;
    const background = opts.background ?? t.background;

    const latitudes = t.latitudes
      .map((lat) => {
        const y = (cy + lat.offset).toFixed(2);
        const half = Math.sqrt(r * r - lat.offset * lat.offset);
        const x1 = (cx - half).toFixed(2);
        const x2 = (cx + half).toFixed(2);
        return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${lat.color}" stroke-width="${sw}" stroke-linecap="round"/>`;
      })
      .join("");

    const longitudes = t.longitudes
      .map((lon) => {
        if (lon.rx === 0) {
          return `<line x1="${cx}" y1="${(cy - r).toFixed(2)}" x2="${cx}" y2="${(cy + r).toFixed(2)}" stroke="${lon.color}" stroke-width="${sw}" stroke-linecap="round"/>`;
        }
        return `<ellipse cx="${cx}" cy="${cy}" rx="${lon.rx}" ry="${r}" fill="none" stroke="${lon.color}" stroke-width="${sw}"/>`;
      })
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${t.viewBox}" fill="none">
  <rect width="${vbW}" height="${vbH}" rx="${t.cornerRadius}" fill="${background}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ringColor}" stroke-width="${sw}"/>
  ${latitudes}
  ${longitudes}
</svg>`;
  }

  async function buildRainbowWebSvg(opts) {
    const tokens = await loadTokens();
    return buildSvgFromTokens(tokens, opts || {});
  }

  window.tinkerLogo = window.tinkerLogo || {};
  window.tinkerLogo.tokens = loadTokens;
  window.tinkerLogo.buildRainbowWebSvg = buildRainbowWebSvg;
})();
