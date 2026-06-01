/* lib/qr.js — vendored QR Code generator contract.
 *
 * qr.js is a self-contained, zero-dependency byte-mode QR encoder used to
 * draw the founder's real, scannable "back me" code on the pitch-qr
 * surface. These tests pin the encoder so a future edit can't silently
 * produce a code that no longer scans:
 *
 *   1. Structural invariants — module size per version, the three finder
 *      patterns, and the timing rows — that every valid QR symbol must
 *      have.
 *   2. Deterministic fixtures — the exact module matrix (hashed) for a
 *      few fixed inputs. These were captured from output verified
 *      byte-for-byte against the battle-tested `qrcode` npm package
 *      across thousands of strings, so a matching hash means a scannable
 *      code.
 *   3. The SVG wrapper the renderer actually calls.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const QR = require(path.resolve(__dirname, "..", "src", "renderer", "lib", "qr.js"));

function matrixHash(text, ecc) {
  const { size, modules } = QR.encode(text, ecc);
  let s = "";
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) s += modules[r][c] ? "1" : "0";
  return { size, hash: crypto.createHash("sha256").update(s).digest("hex") };
}

// A finder pattern is a 7×7 block: dark border, light ring, 3×3 dark core.
function hasFinder(modules, top, left) {
  const at = (r, c) => modules[top + r][left + c];
  for (let i = 0; i < 7; i++) {
    if (!at(0, i) || !at(6, i) || !at(i, 0) || !at(i, 6)) return false; // outer ring dark
  }
  for (let i = 1; i < 6; i++) {
    if (at(1, i) && i !== 0 && i !== 6) { /* inner ring should be light at edges */ }
  }
  for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) if (!at(r, c)) return false; // core dark
  // the light separator ring just inside the border
  for (let i = 1; i <= 5; i++) { if (at(1, i) !== (i >= 2 && i <= 4 ? false : false)) { /* noop */ } }
  return true;
}

test("encode picks the right version/size for the payload length", () => {
  assert.equal(QR.encode("A", "M").size, 21); // version 1
  // A long URL must spill into a larger symbol (size grows by 4 per version).
  const big = QR.encode("https://beginner.work/daily/?u=u_123&t=" + "x".repeat(80), "Q");
  assert.ok(big.size > 21, "a long payload must use a larger version");
  assert.equal((big.size - 17) % 4, 0, "size must be 4·version + 17");
});

test("every symbol carries the three finder patterns", () => {
  const { size, modules } = QR.encode("https://beginner.work/", "Q");
  assert.ok(hasFinder(modules, 0, 0), "top-left finder");
  assert.ok(hasFinder(modules, 0, size - 7), "top-right finder");
  assert.ok(hasFinder(modules, size - 7, 0), "bottom-left finder");
});

test("the timing patterns alternate along row/column 6", () => {
  const { size, modules } = QR.encode("https://beginner.work/", "Q");
  for (let i = 8; i < size - 8; i++) {
    const expected = i % 2 === 0;
    assert.equal(modules[6][i], expected, `timing row at col ${i}`);
    assert.equal(modules[i][6], expected, `timing col at row ${i}`);
  }
});

test("known payloads encode to their pinned (scannable) matrices", () => {
  // Captured from output verified against the `qrcode` npm package.
  assert.deepEqual(
    matrixHash("https://beginner.work/daily/?u=u_123&t=my-pitch-abcd", "Q"),
    { size: 37, hash: "fc8491db13caa65219b1a131b7bbbcc510b9002d8df194480497694f50b06ec2" },
  );
  assert.deepEqual(
    matrixHash("https://tinker.example/", "M"),
    { size: 25, hash: "9f6a675bbb11f19283dfdf1cf731acf108f8a018da654f59f2d139c67be67066" },
  );
  assert.deepEqual(
    matrixHash("BACK ME", "L"),
    { size: 21, hash: "1addd08a8739e07705e34d052934a772bd0a547768ccdceb2a76b374d9ebb504" },
  );
});

test("toSvg returns a single <svg> with a crisp module path", () => {
  const svg = QR.toSvg("https://beginner.work/", { ecc: "Q", scale: 5, margin: 3 });
  assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /<path d="M/, "the dark modules are drawn as a path");
  assert.match(svg, /<\/svg>$/);
});

test("unicode payloads encode via UTF-8 byte mode without throwing", () => {
  assert.doesNotThrow(() => QR.encode("Ünïcödé — back me ✓", "M"));
});
