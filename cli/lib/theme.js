"use strict";

/**
 * Terminal styles matched to Tinker's web writing UI
 * (src/renderer/styles.css — writing-question, writing-input, accent, muted).
 *
 * Levels: 0 plain · 1 basic 16 · 2 256-color · 3 truecolor (24-bit).
 * Honors NO_COLOR, FORCE_COLOR, and non-TTY streams.
 */

const TOKENS = {
  /** Reserved (web --color-ink). Bold UI copy uses accent, not ink. */
  ink: { hex: "#1a1a1a", r: 26, g: 26, b: 26, ansi16: 30, ansi256: 234 },
  /** .writing-input body — --color-foreground */
  foreground: { hex: "#2d2a26", r: 45, g: 42, b: 38, ansi16: 30, ansi256: 235 },
  /** hints / secondary — --color-muted */
  muted: { hex: "#6f6a65", r: 111, g: 106, b: 101, ansi16: 90, ansi256: 243 },
  /** Bold questions / success / brand — --color-accent-strong */
  accent: { hex: "#6366f1", r: 99, g: 102, b: 241, ansi16: 35, ansi256: 99 },
  /** errors — --color-danger */
  danger: { hex: "#b42318", r: 180, g: 35, b: 24, ansi16: 31, ansi256: 160 },
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

/** GNU readline / Node: wrap non-printing sequences so cursor math stays correct. */
function rlHide(ansi) {
  if (!ansi) return "";
  return `\x01${ansi}\x02`;
}

function parseForceColor(raw) {
  if (raw == null || raw === "") return null;
  if (raw === "true" || raw === "TRUE") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 3) return 3;
  return n | 0;
}

/**
 * @param {NodeJS.WriteStream | { isTTY?: boolean }} [stream]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {0|1|2|3}
 */
function colorLevel(stream = process.stdout, env = process.env) {
  const forced = parseForceColor(env.FORCE_COLOR);
  if (env.NO_COLOR != null && env.NO_COLOR !== "") {
    // FORCE_COLOR wins when set to a positive level (common CLI convention).
    if (forced != null && forced > 0) return /** @type {0|1|2|3} */ (forced);
    return 0;
  }
  if (forced != null) return /** @type {0|1|2|3} */ (forced);

  if (!stream || !stream.isTTY) return 0;

  const term = String(env.TERM || "");
  if (term === "dumb") return 0;

  const colorterm = String(env.COLORTERM || "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return 3;

  if (/-direct$/i.test(term) || /truecolor/i.test(term)) return 3;
  if (/^xterm-256|^screen-256|^tmux-256|^rxvt-256|256color/i.test(term)) return 2;
  if (env.TERM_PROGRAM === "iTerm.app" || env.TERM_PROGRAM === "Apple_Terminal") {
    return 3;
  }
  if (env.TERM_PROGRAM === "vscode" || env.TERM_PROGRAM === "cursor") {
    return 3;
  }
  // Cursor / VS Code integrated terminals usually advertise xterm-256color;
  // prefer truecolor when COLORTERM is unset but CI isn't forcing plain.
  if (/^xterm|^screen|^tmux|^vt100|^ansi/i.test(term)) return 2;
  return 1;
}

function fgSeq(token, level) {
  if (level <= 0) return "";
  if (level >= 3) return `\x1b[38;2;${token.r};${token.g};${token.b}m`;
  if (level >= 2) return `\x1b[38;5;${token.ansi256}m`;
  return `\x1b[${token.ansi16}m`;
}

/**
 * @param {object} [opts]
 * @param {NodeJS.WriteStream} [opts.stream]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {0|1|2|3} [opts.level] force a level (tests)
 */
function createTheme(opts = {}) {
  const stream = opts.stream || process.stdout;
  const env = opts.env || process.env;
  const level = opts.level != null ? opts.level : colorLevel(stream, env);
  const enabled = level > 0;

  function paint(token, text, { bold = false, dim = false } = {}) {
    const s = String(text == null ? "" : text);
    if (!enabled || !s) return s;
    // Bold copy is always Tinker accent purple (questions, success, headings).
    const fg = bold ? TOKENS.accent : token;
    let open = fgSeq(fg, level);
    if (bold) open += BOLD;
    if (dim) open += DIM;
    return open + s + RESET;
  }

  function open(token, { bold = false, dim = false } = {}) {
    if (!enabled) return "";
    const fg = bold ? TOKENS.accent : token;
    let seq = fgSeq(fg, level);
    if (bold) seq += BOLD;
    if (dim) seq += DIM;
    return seq;
  }

  return {
    level,
    enabled,
    tokens: TOKENS,
    reset: enabled ? RESET : "",
    /** Question line — accent purple + bold. */
    question(text) {
      return paint(TOKENS.accent, text, { bold: true });
    },
    /** Typed / body copy — foreground. */
    body(text) {
      return paint(TOKENS.foreground, text);
    },
    /** Dim hints and secondary lines. */
    muted(text) {
      return paint(TOKENS.muted, text);
    },
    /** Accent purple — success ("Saved to Notion."). */
    success(text) {
      return paint(TOKENS.accent, text, { bold: true });
    },
    /** Alias for success / brand accent. */
    accent(text) {
      return paint(TOKENS.accent, text, { bold: true });
    },
    /** Errors — danger red. */
    error(text) {
      return paint(TOKENS.danger, text);
    },
    /**
     * Compact `>` prompt for readline. Non-printing ANSI wrapped in
     * \\x01..\\x02 so the cursor column stays correct.
     */
    prompt(text = "> ") {
      if (!enabled) return String(text);
      const openMuted = fgSeq(TOKENS.muted, level);
      const openBody = fgSeq(TOKENS.foreground, level);
      // Prompt glyph muted; then switch to body so typed answers match the web.
      return rlHide(openMuted) + String(text) + rlHide(RESET + openBody);
    },
    /** Open body color (no reset) — for multi-line continuation. */
    bodyOpen() {
      return open(TOKENS.foreground);
    },
    /** Wrap a prompt string for readline width safety. */
    rlPrompt(styled) {
      if (!enabled) return String(styled);
      // If caller already used prompt(), leave as-is; otherwise hide whole SGR.
      return String(styled);
    },
    paint,
  };
}

/** Theme bound to a stream (recomputed each call so env overrides work in tests). */
function getTheme(opts) {
  return createTheme(opts || {});
}

module.exports = {
  TOKENS,
  RESET,
  colorLevel,
  createTheme,
  getTheme,
  rlHide,
};
