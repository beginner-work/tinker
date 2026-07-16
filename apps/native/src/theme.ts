/**
 * Tokens derived from tinker's design-tokens.css.
 * Layout follows GitHub mobile Explore; type faces stay Fraunces + Instrument Sans.
 * Light is the Explore-matching default; dark remains an option.
 */

export type ColorMode = "light" | "dark";

const light = {
  background: "#f2f1ef",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  border: "#e5e1d8",
  hairline: "#ede8e0",
  ink: "#2d2a26",
  inkMuted: "#6f6a65",
  inkSoft: "#a39e96",
  forest: "#2d5a3d",
  forestSoft: "#7bc47a",
  accent: "#2d5a3d",
  accentPress: "#244a32",
  accentMuted: "rgba(45, 90, 61, 0.12)",
  iconCoverage: "#c8b6e2",
  iconConnect: "#f9a8d4",
  iconProgress: "#fdba74",
  badge: "#eef2ff",
  badgeInk: "#4f46e5",
  navBg: "rgba(255, 253, 247, 0.92)",
  navShadow: "rgba(45, 42, 38, 0.12)",
  avatarBg: "#7bc47a",
  avatarInk: "#fffdf7",
} as const;

const dark = {
  background: "#141210",
  surface: "#1c1916",
  surfaceRaised: "#242019",
  border: "#3a342c",
  hairline: "#2a2622",
  ink: "#f5f3ef",
  inkMuted: "#a39e96",
  inkSoft: "#6f6a65",
  forest: "#7bc47a",
  forestSoft: "#7bc47a",
  accent: "#7bc47a",
  accentPress: "#5aad58",
  accentMuted: "rgba(123, 196, 122, 0.16)",
  iconCoverage: "#c8b6e2",
  iconConnect: "#f9a8d4",
  iconProgress: "#fdba74",
  badge: "#2a2440",
  badgeInk: "#c4b5fd",
  navBg: "rgba(28, 25, 22, 0.94)",
  navShadow: "rgba(0, 0, 0, 0.35)",
  avatarBg: "#2d5a3d",
  avatarInk: "#f5f3ef",
} as const;

export const fonts = {
  /** Fraunces — tinker display */
  display: "Fraunces_700Bold",
  displaySemi: "Fraunces_600SemiBold",
  /** Instrument Sans — tinker reading face */
  sans: "InstrumentSans_400Regular",
  sansMed: "InstrumentSans_500Medium",
  sansSemi: "InstrumentSans_600SemiBold",
  sansBold: "InstrumentSans_700Bold",
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

export const radius = {
  card: 14,
  button: 10,
  chip: 9,
  icon: 10,
  pill: 999,
  nav: 28,
} as const;

export const text = {
  displayLg: 34,
  title: 28,
  display: 22,
  section: 17,
  essay: 16,
  base: 15,
  body: 14,
  small: 13,
  micro: 11,
} as const;

export function colorsFor(mode: ColorMode) {
  return mode === "dark" ? dark : light;
}

export const theme = {
  fonts,
  space,
  radius,
  text,
  colors: light,
} as const;
