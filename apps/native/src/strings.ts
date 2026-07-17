/**
 * Visible-string allowlist for View 1–2.
 * Every on-screen string must be (a) a verbatim founder quote / pitch line, or
 * (b) a fixed string from this allowlist. See build-prompts/product-oriented-dev-feed.md.
 */

export const STR = {
  brand: "tinker",
  yourWords: "Your words",
  explore: "Explore",
  discover: "Discover",
  activity: "Activity",
  progress: "Progress",
  coverage: "Coverage",
  connect: "Connect",
  feed: "Feed",
  home: "Home",
  dark: "Dark",
  light: "Light",
  continueLabel: "Continue",
  search: "Search",
  back: "Back",
  justNow: "Just now",
  today: "Today",
  days3: "3d",
  days6: "6d",
  aligned: "Aligned",
  noSourceInFeed: "No source in the feed — only progress.",
  emptyFeed: "When people you care about share progress, it shows up here.",
  contributedTo: "contributed to",
  // View 2 — Connect
  pitch: "Pitch",
  repository: "Repository",
  pickPitch: "Pick a pitch",
  pullFromMcp: "Pull from MCP",
  connected: "Connected",
  notConnected: "Not connected",
  installTool: "Install tool",
  sourceOfTruth: "Source of truth",
  saveConnection: "Save connection",
  clearConnection: "Clear connection",
  noPitchesYet: "No pitches yet",
  noReposYet: "No repositories yet",
  connectExplain:
    "Connect a pitch to a repository. The MCP hub is the source of truth.",
  mcpHubLive: "MCP hub",
  mcpHubLocal: "Local seeds — set MCP URL to pull live",
  manifestPulled: "Manifest pulled",
  // View 3 — Coverage (Peep-style side by side)
  unaligned: "Unaligned",
  sideBySide: "Side by side",
  pitchIdeas: "Pitch ideas",
  sourceMap: "Source map",
  connectPitchFirst: "Connect a pitch first",
  covered: "Covered",
  gap: "Gap",
  // Verbatim from pitch-deck.md
  pitchTagline: "Everyone is a founder.",
  pitchProblem:
    "Engineers stay building and human making becomes a relic of the past…",
  pitchSolution:
    "An app that helps engineers discover their pitch over time, on the go.",
} as const;
