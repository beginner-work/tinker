/* Server-side Marp renderer for the "your daily beginner" publish flow.
 *
 * The canonical pitch lives in pitch-deck.md at the repo root. That
 * file owns the Marp frontmatter — fonts, colours, slide CSS — and
 * defines the eleven-beat body. When a founder publishes a pitch from
 * tinker, we keep the frontmatter (styling) and refresh the body so
 * each beat carries the founder's own verbatim phrases.
 *
 * Output target is a *post* — still rendered as Marp slides, but each
 * beat reads like a section of a blog rather than a fundraising pull-
 * quote. That means plain paragraphs under each H1, no `> *…*` italic
 * blockquotes, and a cover slide that opens with the pitch title and a
 * dateline instead of a fundraising lockup.
 *
 * Exports `renderDeck({ title, slides, generatedAt })`:
 *   - title:       one capitalized word (the pitch's display title).
 *   - slides:      { [deckHeading]: [string, ...] } — verbatim phrases
 *                  the client resolved from the founder's writings.
 *                  Empty arrays / missing headings → the beat is
 *                  skipped (no empty slide).
 *   - generatedAt: ms epoch. Renders as a YYYY-MM-DD dateline on the
 *                  cover. Optional; defaults to Date.now().
 *
 * Returns: { markdown, beatCount } where markdown is the full Marp
 * document (frontmatter + cover + body slides + closer) and beatCount
 * is how many beats actually rendered.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { DECK_HEADINGS } = require("./pitches-clusterer.js");

// pitch-deck.md lives at the repo root. The frontmatter is the YAML
// block between the first two `---` lines on lines 1 and 278; we cache
// it the first time renderDeck is called so subsequent publishes don't
// touch the filesystem.
let cachedFrontmatter = null;

function loadFrontmatter() {
  if (cachedFrontmatter) return cachedFrontmatter;
  const deckPath = path.join(__dirname, "..", "..", "pitch-deck.md");
  const raw = fs.readFileSync(deckPath, "utf8");
  // The frontmatter is the first `---\n…\n---` chunk. Marp's parser is
  // strict about the YAML living between the very first `---` on line 1
  // and the next `---` on its own line, so the same regex picks it out.
  const m = raw.match(/^---\n([\s\S]*?\n)---\n/);
  if (!m) {
    throw new Error("pitch-deck.md is missing its Marp frontmatter");
  }
  cachedFrontmatter = `---\n${m[1]}---\n`;
  return cachedFrontmatter;
}

// The canonical badge svg lives inline on every beat slide of
// pitch-deck.md — it's the small "beginner" mark that anchors the
// corner. We keep it as a one-off constant rather than re-parsing the
// markdown each time, because the swap-the-body promise means the
// server controls this chrome.
const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>`;

function badgeBlock() {
  return [
    `<div class="beginner-badge">`,
    BADGE_SVG,
    `<span class="wm">beginner</span>`,
    `</div>`,
    ``,
  ].join("\n");
}

function lockupBlock() {
  return [
    `<div class="lockup">`,
    BADGE_SVG,
    `<span class="wm">beginner</span>`,
    `</div>`,
    ``,
  ].join("\n");
}

function isoDate(ms) {
  const d = new Date(typeof ms === "number" ? ms : Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function sanitizePhrase(s) {
  if (typeof s !== "string") return "";
  // Trim and collapse interior runs of whitespace so a multi-line
  // verbatim slice from a draft reads cleanly as a single paragraph.
  // Markdown special characters in the phrase are left alone — Marp
  // renders them as the founder wrote them.
  return s.replace(/\s+/g, " ").trim();
}

function renderCover({ title, generatedAt }) {
  // Cover slide reads like a blog header: title, "a daily beginner"
  // subtitle, dateline. No fundraising frame.
  return [
    `<!-- _class: cover -->`,
    ``,
    lockupBlock(),
    `# ${title}`,
    ``,
    `<p class="tagline">a daily beginner</p>`,
    ``,
    `<div class="meta">`,
    ``,
    `${isoDate(generatedAt)}`,
    ``,
    `</div>`,
  ].join("\n");
}

function renderBeat(heading, phrases) {
  // Body slides are post-format: plain paragraphs under the H1, no
  // pull-quote blockquotes. The badge sits in the corner the way the
  // canonical deck does so the visual identity carries over.
  const lines = [badgeBlock(), `# ${heading}`, ``];
  for (const raw of phrases) {
    const phrase = sanitizePhrase(raw);
    if (!phrase) continue;
    lines.push(phrase);
    lines.push(``);
  }
  return lines.join("\n").replace(/\n+$/, "");
}

function renderCloser({ title }) {
  return [
    `<!-- _class: cover -->`,
    ``,
    lockupBlock(),
    `# ${title}`,
    ``,
    `<p class="tagline">a daily beginner</p>`,
  ].join("\n");
}

function renderDeck({ title, slides, generatedAt }) {
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("renderDeck: title is required");
  }
  if (!slides || typeof slides !== "object") {
    throw new Error("renderDeck: slides must be an object");
  }

  const cleanTitle = title.trim();
  const parts = [loadFrontmatter()];

  parts.push(renderCover({ title: cleanTitle, generatedAt }));

  let beatCount = 0;
  for (const heading of DECK_HEADINGS) {
    const rawList = Array.isArray(slides[heading]) ? slides[heading] : [];
    const phrases = rawList.map(sanitizePhrase).filter(Boolean);
    if (phrases.length === 0) continue;
    parts.push("---");
    parts.push("");
    parts.push(renderBeat(heading, phrases));
    beatCount += 1;
  }

  parts.push("---");
  parts.push("");
  parts.push(renderCloser({ title: cleanTitle }));

  return { markdown: parts.join("\n\n") + "\n", beatCount };
}

module.exports = {
  renderDeck,
  DECK_HEADINGS,
  // exported for tests
  _internal: { sanitizePhrase, loadFrontmatter, isoDate },
};
