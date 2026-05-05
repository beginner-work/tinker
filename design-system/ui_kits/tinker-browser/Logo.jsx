/* Logo.jsx — the rainbow-web mark, built directly from the JSON
 * dictionary at assets/rainbow-web.json. Don't edit colours here —
 * change the dictionary and regenerate.
 */
const TOKENS = {
  viewBox: "0 0 200 200",
  background: "#F5F3EF",
  cornerRadius: 44,
  strokeWidth: 9,
  globe: { cx: 100, cy: 100, radius: 76, color: "#C8B6E2" },
  latitudes: [
    { offset: -38, color: "#F9A8D4" },
    { offset:   0, color: "#FDBA74" },
    { offset:  38, color: "#FDE68A" },
  ],
  longitudes: [
    { rx: 52, color: "#7BC47A" },
    { rx: 26, color: "#7DD3FC" },
    { rx:  0, color: "#6EE7B7" },
  ],
};

function Logo({ size = 22, plate = true, mono = false }) {
  const t = TOKENS;
  const { cx, cy, radius: r, color: ringColor } = t.globe;
  const stroke = (c) => (mono ? "#1a1a1a" : c);
  return (
    <svg width={size} height={size} viewBox={t.viewBox} fill="none" aria-hidden="true">
      {plate && <rect width="200" height="200" rx={t.cornerRadius} fill={mono ? "transparent" : t.background} />}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke(ringColor)} strokeWidth={t.strokeWidth} />
      {t.latitudes.map((lat, i) => {
        const y = cy + lat.offset;
        const half = Math.sqrt(r * r - lat.offset * lat.offset);
        return <line key={`lat-${i}`} x1={cx - half} y1={y} x2={cx + half} y2={y} stroke={stroke(lat.color)} strokeWidth={t.strokeWidth} strokeLinecap="round" />;
      })}
      {t.longitudes.map((lon, i) =>
        lon.rx === 0 ? (
          <line key={`lon-${i}`} x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke={stroke(lon.color)} strokeWidth={t.strokeWidth} strokeLinecap="round" />
        ) : (
          <ellipse key={`lon-${i}`} cx={cx} cy={cy} rx={lon.rx} ry={r} fill="none" stroke={stroke(lon.color)} strokeWidth={t.strokeWidth} />
        )
      )}
    </svg>
  );
}

window.Logo = Logo;
