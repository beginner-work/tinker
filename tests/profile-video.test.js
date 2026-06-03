/* Structural contract for the "A word from the founder" clip that lives
 * INSIDE the top-right profile pop-down menu.
 *
 * The design (deliberate, and easy to regress): the clip is embedded in the
 * profile popover — not a floating bubble. Clicking the poster plays it
 * fullscreen, and from fullscreen the viewer reaches picture-in-picture
 * through the browser/OS NATIVE controls. There is no custom PiP button and
 * no requestPictureInPicture() call in our own code; the assertions below
 * fail CI if someone re-introduces one.
 *
 * node:test can't lay out or play media, so this parses the shipped markup,
 * script, and stylesheet and asserts the wiring is present and correct.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "src", "renderer");
const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
const js = fs.readFileSync(path.join(RENDERER, "profile.js"), "utf8");
const css = fs.readFileSync(path.join(RENDERER, "profile.css"), "utf8");

// Slice out the popover so we assert the clip's *placement*, not mere presence
// somewhere in the document.
function popoverMarkup() {
  const start = html.indexOf('id="profile-popover"');
  assert.notStrictEqual(start, -1, "#profile-popover should exist");
  const closeFrom = html.indexOf("profile-open-beginner", start);
  const end = html.indexOf("</div>", closeFrom);
  assert.ok(end > start, "popover should close after its actions");
  return html.slice(start, end);
}

test("the founder clip is embedded inside the profile pop-down menu", () => {
  const pop = popoverMarkup();
  assert.match(pop, /id="profile-video"/, "video figure lives in the popover");
  assert.match(pop, /<video[^>]*class="profile-video__media"/, "has a <video> element");
  assert.match(pop, /poster="\.\/founder-intro-poster\.svg"/, "uses the poster placeholder");
  assert.match(pop, /founder-intro\.webm/, "offers a webm source");
  assert.match(pop, /founder-intro\.mp4/, "offers an mp4 source");
  assert.match(pop, /id="profile-video-play"/, "has a play control");
});

test("the poster placeholder ships so the thumbnail never breaks", () => {
  assert.ok(
    fs.existsSync(path.join(RENDERER, "founder-intro-poster.svg")),
    "founder-intro-poster.svg should be present"
  );
});

test("clicking the clip opens fullscreen (the path to native PiP)", () => {
  assert.match(js, /profile-video-play/, "wires the play control");
  assert.match(js, /requestFullscreen/, "requests element fullscreen");
  assert.match(js, /webkitEnterFullscreen/, "supports iOS fullscreen");
  assert.match(js, /\.controls\s*=\s*true/, "turns on native controls, which expose PiP");
});

test("picture-in-picture comes from native controls — no custom button or call", () => {
  assert.doesNotMatch(
    js,
    /requestPictureInPicture|exitPictureInPicture/,
    "PiP must come from the browser/OS native controls, not our own code"
  );
  assert.doesNotMatch(
    html,
    /disablepictureinpicture/i,
    "the <video> must not disable picture-in-picture"
  );
});

test("the embedded clip is styled", () => {
  assert.match(css, /\.profile-video\b/, "profile.css styles the embedded clip");
  assert.match(css, /\.profile-video--soon\b/, "has a graceful 'coming soon' state");
});
