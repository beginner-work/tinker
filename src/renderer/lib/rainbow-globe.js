/* Rainbow globe mark — built from the shared style dictionary at
 * `src/renderer/tokens/rainbow-globe.json`. Consumers (icon-init,
 * welcome-page header, etc.) call `buildRainbowGlobeSvg()` and get
 * back a self-contained SVG string. The dictionary is fetched once
 * and memoised. */

(function () {
  let tokensPromise = null;

  function loadTokens() {
    if (tokensPromise) return tokensPromise;
    tokensPromise = fetch("./tokens/rainbow-globe.json", { cache: "force-cache" })
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
    const cx = vbW / 2;
    const cy = vbH / 2;
    const background = opts.background ?? t.background;
    const sw = t.strokeWidth;

    const lines = t.lines
      .map(
        (l) =>
          `<ellipse cx="${cx}" cy="${cy}" rx="${l.rx}" ry="${l.ry}" fill="none" stroke="${l.color}" stroke-width="${sw}" stroke-linecap="round"/>`
      )
      .join("\n    ");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${t.viewBox}" fill="none">
  <rect width="${vbW}" height="${vbH}" rx="${t.cornerRadius}" fill="${background}"/>
  <g transform="rotate(${t.rotation} ${cx} ${cy})">
    ${lines}
    <circle cx="${cx}" cy="${cy}" r="${t.center.radius}" fill="${t.center.color}"/>
  </g>
</svg>`;
  }

  async function buildRainbowGlobeSvg(opts) {
    const tokens = await loadTokens();
    return buildSvgFromTokens(tokens, opts || {});
  }

  window.beginnerLogo = window.beginnerLogo || {};
  window.beginnerLogo.tokens = loadTokens; // exposed for callers who want raw values
  window.beginnerLogo.buildRainbowGlobeSvg = buildRainbowGlobeSvg;
})();
