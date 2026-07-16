/**
 * Visible-string allowlist for View 1.
 * Every on-screen string must be (a) a verbatim founder quote / pitch line, or
 * (b) a fixed string from this allowlist. See build-prompts/product-oriented-dev-feed.md.
 */

export const STR = {
  brand: "tinker",
  yourWords: "Your words",
  progress: "Progress",
  coverage: "Coverage",
  connect: "Connect",
  feed: "Feed",
  dark: "Dark",
  continueLabel: "Continue",
  justNow: "Just now",
  today: "Today",
  noSourceInFeed: "No source in the feed — only progress.",
  emptyFeed: "When people you care about share progress, it shows up here.",
  // Verbatim from pitch-deck.md
  pitchTagline: "Everyone is a founder.",
  pitchProblem:
    "Engineers stay building and human making becomes a relic of the past…",
  pitchSolution:
    "An app that helps engineers discover their pitch over time, on the go.",
} as const;
