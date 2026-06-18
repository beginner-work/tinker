/* Wallet contract (wallet.js + its wiring).
 *
 * When someone backs beginner, the /investor-relations reveal mints them a
 * "beginner card" and offers to deposit it here. The card rides across in the
 * URL fragment (#deposit_card=base64url(json)) — the same on-device channel as
 * the Back-me pass — and wallet.js stores it locally (tinker is the wallet's
 * source of truth). The beginner-card visual lives in the beginner repo, so the
 * wallet is shown by embedding beginner's /wallet page in an iframe (the
 * reciprocal of back-me.js), with the cards passed in the fragment.
 *
 * Source-level contract tests (the renderer sandbox has only a no-op DOM),
 * matching open-beginner.test.js / back-me.test.js.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.resolve(__dirname, "..", "src", "renderer");
const read = (p) => fs.readFileSync(path.join(SRC_DIR, p), "utf8");

const SRC = read("wallet.js");
const INDEX_HTML = read("index.html");
const PROFILE_SRC = read("profile.js");

test("wallet.js exposes the read API on window", () => {
  assert.match(
    SRC,
    /window\.tinkerWallet\s*=\s*\{[\s\S]*?list[\s\S]*?open[\s\S]*?close[\s\S]*?\}/,
    "must expose window.tinkerWallet with list/open/close",
  );
});

test("the wallet receives a deposit from the URL fragment and persists it locally", () => {
  assert.match(SRC, /"deposit_card"/, "reads the #deposit_card fragment param");
  assert.match(
    SRC,
    /"tinker\.wallet\.v1"/,
    "stores cards under the tinker.wallet.v1 localStorage key (tinker owns the wallet)",
  );
  // The deposit must be stripped after import so a refresh doesn't replay it.
  assert.match(SRC, /history\.replaceState/, "scrubs the fragment after importing");
});

test("deposited card data is treated as untrusted, coerced to bounded strings", () => {
  // The payload comes from anyone who can craft a #deposit_card= URL.
  assert.match(SRC, /\.slice\(/, "clamps field lengths when decoding");
});

test("the wallet is shown by embedding beginner's /wallet page in an iframe", () => {
  assert.match(
    SRC,
    /https:\/\/www\.beginner\.work\/wallet/,
    "targets the canonical www.beginner.work/wallet page",
  );
  assert.match(SRC, /createElement\("iframe"\)/, "embeds the page as an in-app iframe");
  assert.match(
    SRC,
    /"#cards="\s*\+/,
    "passes the wallet's cards to the page in the fragment (never sent to a server)",
  );
  // The bare apex 308-redirects to www; framing it would break the iframe.
  assert.doesNotMatch(
    SRC,
    /["']https:\/\/beginner\.work\//,
    "must not frame the bare apex (it redirects to www)",
  );
  assert.doesNotMatch(
    SRC,
    /beginner-git-[\w-]*\.vercel\.app/,
    "must not point at a beginner branch-preview alias",
  );
});

test("index.html loads wallet.js and offers the Wallet action in the profile menu", () => {
  assert.match(INDEX_HTML, /<script src="\.\/wallet\.js"/, "the wallet module is loaded");
  assert.match(INDEX_HTML, /id="profile-wallet"/, "the profile popover has a 'Wallet' action");
});

test("the profile menu opens the wallet through the shared opener", () => {
  assert.match(
    PROFILE_SRC,
    /window\.tinkerWallet\.open\(\)/,
    "the profile menu action opens the wallet via the shared opener",
  );
});

// ── The base64url codec round-trips with what beginner encodes ──────────────
// beginner's investor-onboarding.js encodes a card as:
//   btoa(unescape(encodeURIComponent(JSON.stringify(card))))
//   .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")
// wallet.js must decode exactly that (and re-encode the list the same way for
// the iframe), including unicode, without padding.
function encodeBase64Url(value) {
  const b64 = Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("a beginner-encoded card is fragment-safe and decodes back unchanged", () => {
  const card = {
    name: "José Café 🌱",
    amount: "$5,000",
    tier: "Founding Backer",
    no: "0420 1337 2026",
  };
  const enc = encodeBase64Url(card);
  assert.match(enc, /^[A-Za-z0-9_-]+$/, "no +, /, or = to be mangled in a URL fragment");

  let b64 = enc.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const back = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  assert.deepEqual(back, card, "round-trips unchanged, unicode included");
});
