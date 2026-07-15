/* tinker design tokens, ported from src/renderer/styles.css +
 * design-tokens.css. Keep in sync with the web renderer — this file is
 * the single place native styles read colors/type/radii from.
 *
 * House rules carried over:
 *   - shadows on buttons only; cards/panels/inputs use borders and never lift
 *   - motion: none — state changes are instant by design
 */

export const colors = {
  background: "#fffdf7",
  foreground: "#2d2a26",
  muted: "#6f6a65",
  card: "#fff9f0",
  border: "#ede8e0",
  accent: "#a5b4fc",
  accentDim: "#eef2ff",
  accentStrong: "#6366f1",
  accentPress: "#4f46e5",
  surface: "#ffffff",
  surfaceAlt: "#fff9f0",
  forest: "#2d5a3d",
  leaf: "#7bc47a",
  sprout: "#5aad58",
  ink: "#1a1a1a",
  errorBg: "#fdf0eb",
  errorBorder: "#f0d3c5",

  // Pastel rainbow — beginner brand expressive palette
  rose: "#f9a8d4",
  peach: "#fdba74",
  amber: "#fde68a",
  mint: "#6ee7b7",
  sky: "#7dd3fc",
  indigo: "#a5b4fc",
  violet: "#c4b5fd",
} as const;

/* The rainbow-web logo run, in hypotenuse order (matches --edge-fill). */
export const rainbow = [
  "#f9a8d4", // pink
  "#fdba74", // orange
  "#fde68a", // yellow
  "#7bc47a", // leaf
  "#6ee7b7", // mint
  "#7dd3fc", // sky
  "#c8b6e2", // purple
] as const;

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

/* Font family names as registered by expo-font in app/_layout.tsx.
 * Display is Fraunces; reading face is Instrument Sans. */
export const fonts = {
  display: "Fraunces_600SemiBold",
  displayLight: "Fraunces_400Regular",
  sans: "InstrumentSans_400Regular",
  sansMedium: "InstrumentSans_500Medium",
  sansSemiBold: "InstrumentSans_600SemiBold",
} as const;

export const spacing = (n: number) => n * 4;
