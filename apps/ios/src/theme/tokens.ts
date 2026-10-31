/** Visual tokens mirrored from the Tinker reading widget + house design system. */
export const colors = {
  bg0: "#f3efe6",
  bg1: "#e7f0ea",
  ink: "#1c241f",
  muted: "#5a6a61",
  accent: "#1f6b4a",
  accentSoft: "#d7ebe1",
  line: "rgba(28, 36, 31, 0.12)",
  panel: "rgba(255, 252, 246, 0.92)",
  cream: "#fffdf8",
  error: "#8a2f2f",
  wordPast: "rgba(28, 36, 31, 0.38)",
  wordCurrentBg: "rgba(31, 107, 74, 0.18)",
  wordCurrent: "#1f6b4a",
  wordAhead: "#1c241f",
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
