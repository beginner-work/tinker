/* Wallet contract (wallet.js + its wiring).
 *
 * When someone backs beginner, the /investor-relations reveal mints them a
 * "beginner card" and offers to deposit it here. The card rides across in the
 * URL fragment (#deposit_card=base64url(json)) — the same on-device channel as
 * the Back-me pass — and wallet.js decodes it, stores it locally, and shows the
 * wallet. The profile menu's "Wallet" reopens it any time.
 *
 * Source-level contract tests (the renderer sandbox has only a no-op DOM),
 * matching open-beginner.test.js / back-me.test.js. The pure base64url codec is
 * exercised directly against a fixture beginner encodes the same way.
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
    "stores cards under the tinker.wallet.v1 localStorage key",
  );
  // The deposit must be stripped after import so a refresh doesn't replay it.
  assert.match(SRC, /history\.replaceState/, "scrubs the fragment after importing");
});

test("deposited card data is treated as untrusted text, never markup", () => {
  // The payload comes from anyone who can craft a #deposit_card= URL, so card
  // fields must be set via textContent, never innerHTML.
  assert.match(SRC, /textContent/, "renders card fields as text");
  assert.doesNotMatch(
    SRC,
    /\.innerHTML\s*=\s*(?:card|obj|entry)\b/,
    "must not assign card data through innerHTML",
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
// beginner's investor-onboarding.js does:
//   btoa(unescape(encodeURIComponent(JSON.stringify(card))))
//   .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")
// wallet.js must decode exactly that, including unicode, without padding.
function encodeCardLikeBeginner(card) {
  const b64 = Buffer.from(JSON.stringify(card), "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("a beginner-encoded card is fragment-safe and decodes back unchanged", () => {
  const card = {
    v: 1,
    name: "José Café 🌱",
    amount: "$5,000",
    tier: "Founding Backer",
    no: "0420 1337 2026",
    issued: "Jun 18, 2026",
  };
  const enc = encodeCardLikeBeginner(card);
  assert.match(enc, /^[A-Za-z0-9_-]+$/, "no +, /, or = to be mangled in a URL fragment");

  // Decode the same way wallet.js does (base64url → utf8 → JSON).
  let b64 = enc.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const back = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  assert.deepEqual(back, card, "round-trips unchanged, unicode included");
});
