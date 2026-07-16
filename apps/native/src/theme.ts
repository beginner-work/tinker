/**
 * Dark-mode-first tokens derived from tinker's design-tokens.css.
 * Welcoming and grounded — generous padding, muted palette, no bounce.
 */

export const theme = {
  colors: {
    background: "#141210",
    surface: "#1c1916",
    surfaceRaised: "#242019",
    border: "#3a342c",
    ink: "#f5f3ef",
    inkMuted: "#a39e96",
    inkSoft: "#6f6a65",
    forest: "#7bc47a",
    rose: "#f9a8d4",
    peach: "#fdba74",
    amber: "#fde68a",
    sky: "#7dd3fc",
    violet: "#c8b6e2",
    mint: "#6ee7b7",
    accent: "#7bc47a",
    accentPress: "#5aad58",
  },
  fonts: {
    display: "Georgia",
    sans: "System",
  },
  space: {
    1: 4,
    2: 6,
    3: 8,
    4: 12,
    5: 16,
    6: 24,
    7: 32,
    8: 48,
  },
  radius: {
    card: 12,
    button: 10,
    chip: 9,
    pill: 999,
  },
  text: {
    displayLg: 34,
    display: 22,
    essay: 17,
    base: 15,
    body: 14,
    small: 13,
    micro: 11,
  },
} as const;
