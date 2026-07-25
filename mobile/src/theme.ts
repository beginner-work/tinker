/* tinker design tokens — keep in sync with src/renderer. */

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
  logoPink: "#f9a8d4",
  logoOrange: "#fdba74",
  logoYellow: "#fde68a",
  logoLeaf: "#7bc47a",
  logoMint: "#6ee7b7",
  logoSky: "#7dd3fc",
  logoPurple: "#c8b6e2",
} as const;

export const rainbow = [
  "#f9a8d4",
  "#fdba74",
  "#fde68a",
  "#7bc47a",
  "#6ee7b7",
  "#7dd3fc",
  "#c8b6e2",
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

export const radius = {
  pill: 999,
  card: 12,
  button: 10,
  chip: 9,
  icon: 8,
} as const;

export const radii = radius;

export const fonts = {
  display: "Fraunces_500Medium",
  displayBold: "Fraunces_500Medium",
  sans: "InstrumentSans_400Regular",
  sansMedium: "InstrumentSans_500Medium",
  sansSemiBold: "InstrumentSans_600SemiBold",
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

export const spacing = (n: number) => n * 4;

/** Eleven starter-pitch headings — keep order identical to web. */
export const DECK_HEADINGS = [
  "The Problem",
  "A Persona",
  "Why Now?",
  "The Team",
  "The Product",
  "How We Make Money",
  "Go to Market",
  "The Moat",
  "The Vision",
  "Competition",
  "The Ask",
] as const;
