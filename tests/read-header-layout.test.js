/* CSS-contract regression guard for the mobile read-view header.
 *
 * This is a structural test, not a behavioural one — node:test can't lay
 * out CSS, so instead it parses the shipped stylesheets and asserts the
 * geometry invariant that keeps the floating title bar from colliding
 * with the top-right controls.
 *
 * The bug it guards against (reported repeatedly — "title overlapping
 * with the three dots"): on mobile the read view has TWO top-right
 * controls — the essay kebab (.read__menu) and the founder avatar
 * (.profile-corner). When a profile is loaded, <html> gets .has-avatar
 * and the kebab slides LEFT (to clear the avatar), pushing its interior
 * edge further into the viewport. The shared floating-title rule reserves
 * a fixed 72px on the right, sized for a single icon. If the kebab's
 * interior edge sits further in than the title's reserved padding, the
 * title's ellipsis renders *under* the kebab.
 *
 * The invariant: when .has-avatar is set, .read__title's right padding
 * must be >= the slid kebab's interior edge (kebab `right` offset +
 * trigger width). A diff that slides the kebab further left, widens the
 * trigger, or drops the .has-avatar title override now fails CI instead
 * of shipping the overlap again.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "src", "renderer");
const mobileCss = fs.readFileSync(path.join(RENDERER, "mobile-drawer.css"), "utf8");
const stylesCss = fs.readFileSync(path.join(RENDERER, "styles.css"), "utf8");

// Pull the first px constant out of a declaration, ignoring env()/calc()
// wrappers (env(safe-area-inset-*) contributes 0 on a non-notched
// viewport, which is the worst case for clearance).
function pxOf(haystack, selector, prop) {
  // Match `selector { ... prop: <value>; ... }` for the given selector.
  const rule = new RegExp(
    escapeRe(selector) + "\\s*\\{([^}]*)\\}",
    "m"
  ).exec(haystack);
  assert.ok(rule, `expected a "${selector}" rule to exist`);
  const decl = new RegExp(prop + "\\s*:\\s*([^;]+);").exec(rule[1]);
  assert.ok(decl, `expected "${selector}" to set ${prop}`);
  // Drop env(safe-area-inset-*, 0px) wrappers first — the safe-area inset
  // is 0 on a non-notched viewport (the worst case for clearance), and its
  // literal "0px" default would otherwise be picked up as the constant.
  const value = decl[1].replace(/env\([^)]*\)/g, "");
  const px = /(\d+)px/.exec(value);
  assert.ok(px, `expected "${selector}" ${prop} to carry a px constant`);
  return Number(px[1]);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("read title bar reserves enough right clearance for the slid kebab", () => {
  // The kebab slides left by this offset when the avatar is present.
  const kebabRight = pxOf(stylesCss, ".has-avatar .read__menu", "right");
  // The kebab's tap target width.
  const triggerWidth = pxOf(stylesCss, ".read__menu-trigger", "width");
  // The clearance the read title bar reserves on the right with an avatar.
  const titlePadRight = pxOf(mobileCss, ".has-avatar .read__title", "padding-right");

  const kebabInteriorEdge = kebabRight + triggerWidth;
  assert.ok(
    titlePadRight >= kebabInteriorEdge,
    `read title right clearance (${titlePadRight}px) must be >= the slid ` +
      `kebab's interior edge (${kebabRight} + ${triggerWidth} = ` +
      `${kebabInteriorEdge}px) so the title can't render under the •••`
  );
});

test("the .has-avatar read-title override still lives in the mobile media query", () => {
  // Guard against the override being moved out of the @media (max-width:
  // 540px) block, where the floating title bar only exists.
  const mediaIdx = mobileCss.indexOf("@media (max-width: 540px)");
  assert.ok(mediaIdx !== -1, "expected the mobile media query block");
  const overrideIdx = mobileCss.indexOf(".has-avatar .read__title");
  assert.ok(
    overrideIdx > mediaIdx,
    ".has-avatar .read__title override must sit inside the mobile media query"
  );
});
