/**
 * tinker theme — mirrors src/renderer/design-tokens.css and the :root block
 * in src/renderer/styles.css. Warm cream paper, ink text, a pastel rainbow.
 * House rules that carry over from the web app:
 *   - Fraunces for display, Instrument Sans for reading.
 *   - Shadows live on buttons only; surfaces use borders and never lift.
 *   - Motion is quiet; state changes are near-instant.
 */

export const colors = {
  background: "#fffdf7",
  foreground: "#2d2a26",
  muted: "#6f6a65",
  card: "#fff9f0",
  surface: "#ffffff",
  surfaceAlt: "#fff9f0",
  border: "#ede8e0",
  hover: "#fff9f0",

  accent: "#a5b4fc",
  accentDim: "#eef2ff",
  accentStrong: "#6366f1",
  accentPress: "#4f46e5",

  selection: "rgba(123, 196, 122, 0.32)",
  errorBg: "#fdf0eb",
  errorBorder: "#f0d3c5",

  // Rainbow-web palette (logo + edge wedge)
  pink: "#f9a8d4",
  orange: "#fdba74",
  yellow: "#fde68a",
  leaf: "#7bc47a",
  mint: "#6ee7b7",
  sky: "#7dd3fc",
  purple: "#c8b6e2",
} as const;

// Ordered stops for the rainbow wedge gradient (matches --edge-fill).
export const rainbow = [
  colors.pink,
  colors.orange,
  colors.yellow,
  colors.leaf,
  colors.mint,
  colors.sky,
  colors.purple,
] as const;

export const fonts = {
  display: "Fraunces_600SemiBold",
  displayLight: "Fraunces_400Regular",
  sans: "InstrumentSans_400Regular",
  sansMedium: "InstrumentSans_500Medium",
  sansSemi: "InstrumentSans_600SemiBold",
} as const;

export const type = {
  displayLg: 38,
  display: 22,
  essay: 17,
  base: 15,
  body: 14,
  small: 13,
  micro: 11,
} as const;

export const leading = {
  tight: 1.1,
  snug: 1.3,
  body: 1.55,
  prose: 1.7,
} as const;

export const radius = {
  pill: 999,
  card: 12,
  button: 10,
  chip: 9,
  icon: 8,
} as const;

export const space = {
  1: 4,
  2: 6,
  3: 8,
  4: 12,
  5: 16,
  6: 24,
  7: 32,
  8: 48,
} as const;
