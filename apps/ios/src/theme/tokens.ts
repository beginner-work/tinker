/** Visual tokens mirrored from live lindowlabs.dev talk/essay UI @390px. */
export const colors = {
  bg: "#fffdf7",
  bg0: "#fffdf7",
  bg1: "#fffdf7",
  ink: "#2d2a26",
  inkSoft: "#4a4742",
  muted: "#6f6a65",
  line: "#ede8e0",
  lineSoft: "#f3eee5",
  forest: "#2d5a3d",
  accent: "#2d5a3d",
  accentSoft: "#e8f0ea",
  panel: "#fffdf7",
  cream: "#f5f3ef",
  parchment: "#f7f0e3",
  error: "#8a2f2f",
  wordPast: "rgba(45, 42, 38, 0.42)",
  wordCurrent: "#2d2a26",
  wordCurrentBg: "rgba(125, 211, 252, 0.28)",
  wordAhead: "#2d2a26",
  barBg: "rgba(255, 253, 247, 0.96)",
  barBorder: "rgba(45, 42, 38, 0.14)",
  btnBg: "rgba(255, 255, 255, 0.72)",
  logoPink: "#f9a8d4",
  logoOrange: "#fdba74",
  logoYellow: "#fde68a",
  logoLeaf: "#7bc47a",
  logoMint: "#6ee7b7",
  logoSky: "#7dd3fc",
  logoPurple: "#c8b6e2",
} as const;

export const fonts = {
  display: "Fraunces_600SemiBold",
  displaySoft: "Fraunces_500Medium",
  body: "InstrumentSans_400Regular",
  bodyMedium: "InstrumentSans_500Medium",
  bodySemi: "InstrumentSans_600SemiBold",
  /** Essay body uses Fraunces like ll-talk-essay__p (~17.64px). */
  essay: "Fraunces_500Medium",
  essaySemi: "Fraunces_600SemiBold",
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

/** Never use Tyler's personal ElevenLabs voice. */
export const BANNED_VOICE_ID = "JlYdFGRHWwlz51Zh5K2n";
