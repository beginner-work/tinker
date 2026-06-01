/* Post-payment QR redirect contract.
 *
 * When a founder finishes the pre-seed checkout on beginner, Stripe's
 * success_url sends them back to their tinker with ?unlocked=1. tinker
 * then lands them on the pitch-qr surface: their real, scannable "back
 * me" QR code plus a preview of what folks see when they scan it.
 *
 * The renderer is browser-shaped (its DOM sandbox is a no-op that can't
 * observe events), so — like pitch-unlock.test.js — these are
 * source-level contracts that pin the moving parts across renderer.js,
 * pitch-qr.js, and sidebar-tree.js so a future edit can't silently break
 * the redirect or the surface.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = (...p) => fs.readFileSync(path.resolve(__dirname, "..", "src", "renderer", ...p), "utf8");
const RENDERER = SRC("renderer.js");
const PITCH_QR = SRC("pitch-qr.js");
const SIDEBAR = SRC("sidebar-tree.js");
const INDEX = SRC("index.html");

// ── The surface is wired into the app shell ───────────────────────────

test("index.html declares the pitch-qr section and loads qr.js before pitch-qr.js", () => {
  assert.match(INDEX, /id="pitch-qr"/, "the #pitch-qr section must exist");
  const qrIdx = INDEX.indexOf('src="./lib/qr.js"');
  const surfaceIdx = INDEX.indexOf('src="./pitch-qr.js"');
  assert.ok(qrIdx > -1 && surfaceIdx > -1, "both scripts must be loaded");
  assert.ok(qrIdx < surfaceIdx, "qr.js must load before pitch-qr.js (it depends on window.tinkerQR)");
});

// ── renderer.js: the ?unlocked=1 return is handled ────────────────────

test("renderer detects the ?unlocked=1 return from checkout", () => {
  assert.match(RENDERER, /unlocked.*===\s*["']1["']/s, "must read the unlocked=1 param");
  assert.match(RENDERER, /handleUnlockReturn/, "must route the unlock return on boot");
  assert.match(
    RENDERER,
    /if \(!handleUnlockReturn\(\)\) showFeed\(\)/,
    "boot must show the QR surface on unlock, else the feed",
  );
});

test("renderer remembers the unlocked state and strips the param", () => {
  assert.match(RENDERER, /setItem\(\s*["']tinker_pitch_unlocked["']\s*,\s*["']1["']\s*\)/);
  assert.match(RENDERER, /searchParams\.delete\(\s*["']unlocked["']\s*\)/, "must strip ?unlocked so a refresh doesn't re-trigger");
});

test("renderer exposes showPitchQr and hides the surface with the others", () => {
  assert.match(RENDERER, /function showPitchQr\(\)/);
  assert.match(RENDERER, /window\.tinkerShowPitchQr\s*=/);
  // It must be hidden in the sibling switchers (e.g. showFeed) so two
  // surfaces are never visible at once.
  assert.match(RENDERER, /pitchQrView\.hidden = true/);
});

// ── pitch-qr.js: the QR + the scan preview ────────────────────────────

test("pitch-qr renders a real QR via window.tinkerQR", () => {
  assert.match(PITCH_QR, /window\.tinkerQR/, "must use the vendored QR generator");
  assert.match(PITCH_QR, /toSvg\(/, "must draw the code as SVG");
});

test("pitch-qr previews what a backer sees and offers share/copy", () => {
  assert.match(PITCH_QR, /Scan to/i, "must show the scan-to-back line on the preview card");
  assert.match(PITCH_QR, /navigator\.share/, "must offer native share");
  assert.match(PITCH_QR, /clipboard\.writeText/, "must offer copy-link as a fallback");
});

test("pitch-qr prefers the founder's published reader link, falling back to the app URL", () => {
  assert.match(PITCH_QR, /tinker_back_url/, "must read the stored published-pitch link");
  assert.match(PITCH_QR, /location\.origin/, "must fall back to the app start URL");
});

// ── sidebar-tree.js: round-trip + post-unlock behaviour ───────────────

test("the Pitch button hands beginner a return origin so checkout can route back", () => {
  assert.match(
    SIDEBAR,
    /set\(\s*["']return["']\s*,\s*origin\s*\)/,
    "unlockUrl must carry ?return=<tinker-origin>",
  );
});

test("once unlocked, the Pitch button opens the QR in-app instead of linking out", () => {
  assert.match(SIDEBAR, /isPitchUnlocked\(\)/, "must check the unlocked flag");
  assert.match(SIDEBAR, /window\.tinkerShowPitchQr\(\)/, "unlocked → open the QR surface in-app");
  // And the locked path is preserved: still opens the external /unlock page.
  assert.match(SIDEBAR, /https:\/\/beginner\.work\/unlock/);
});
