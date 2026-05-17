/* Tests for the pure helpers in scripts/post-preview-update.js —
 * the section renderer and the body merger that decides where the
 * preview block lives inside an existing PR description.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  renderSection,
  mergeIntoBody,
  SENTINEL_START,
  SENTINEL_END,
} = require("../scripts/post-preview-update.js");

function sampleSummary(overrides = {}) {
  return {
    previewUrl: "https://tinker-preview.example.com",
    sessionId: "sess_123",
    inspectorUrl: "https://www.browserbase.com/sessions/sess_123",
    generatedAt: "2026-05-17T10:00:00.000Z",
    commit: "abc1234",
    flows: [
      {
        name: "sign-in",
        description: "Phone sign-in screen",
        status: "ok",
        screenshot: "screenshots/sign-in.png",
        events: [],
      },
    ],
    ...overrides,
  };
}

test("mergeIntoBody appends a fresh section to an empty body", () => {
  const out = mergeIntoBody("", "FRESH");
  assert.match(out, /FRESH/);
});

test("mergeIntoBody appends below user-written content on first run", () => {
  const out = mergeIntoBody(
    "User notes about the PR.",
    `${SENTINEL_START}\nfresh\n${SENTINEL_END}`,
  );
  assert.match(out, /^User notes about the PR\./);
  assert.match(out, /fresh/);
});

test("mergeIntoBody replaces the previous section in place", () => {
  const oldBody =
    `User notes.\n\n${SENTINEL_START}\nOLD\n${SENTINEL_END}\n\nMore notes.`;
  const next = `${SENTINEL_START}\nNEW\n${SENTINEL_END}`;
  const out = mergeIntoBody(oldBody, next);
  assert.doesNotMatch(out, /OLD/);
  assert.match(out, /NEW/);
  assert.match(out, /User notes/);
  assert.match(out, /More notes/);
});

test("renderSection embeds the screenshot via raw.githubusercontent URL", () => {
  const summary = sampleSummary();
  const published = [{ flow: "sign-in", file: "pr-7/sign-in.png" }];
  const section = renderSection({
    summary,
    published,
    repo: "beginner-work/tinker",
    branch: "previews",
  });
  assert.match(
    section,
    /https:\/\/raw\.githubusercontent\.com\/beginner-work\/tinker\/previews\/pr-7\/sign-in\.png/,
  );
  assert.match(section, /ts=2026-05-17T10/); // cache-bust included
  assert.match(section, /<details>/);
  assert.match(section, /sign-in/);
});

test("renderSection surfaces failures up top", () => {
  const summary = sampleSummary({
    flows: [
      {
        name: "welcome",
        description: "Welcome",
        status: "failed",
        error: "selector .sidebar__brand not found",
        screenshot: "screenshots/welcome-failure.png",
        events: [],
      },
    ],
  });
  const section = renderSection({
    summary,
    published: [{ flow: "welcome", file: "pr-7/welcome-failure.png" }],
    repo: "beginner-work/tinker",
    branch: "previews",
  });
  assert.match(section, /1 flow\(s\) failed/);
  assert.match(section, /selector \.sidebar__brand not found/);
});

test("renderSection notes skipped flows separately", () => {
  const summary = sampleSummary({
    flows: [
      {
        name: "welcome",
        description: "Welcome",
        status: "skipped",
        skipReason: "TINKER_TEST_SESSION_TOKEN not set",
        events: [],
      },
    ],
  });
  const section = renderSection({
    summary,
    published: [],
    repo: "beginner-work/tinker",
    branch: "previews",
  });
  assert.match(section, /Skipped/);
  assert.match(section, /TINKER_TEST_SESSION_TOKEN not set/);
});

test("renderSection includes console errors when present", () => {
  const summary = sampleSummary({
    flows: [
      {
        name: "sign-in",
        description: "Phone sign-in",
        status: "ok",
        screenshot: "screenshots/sign-in.png",
        events: [
          { kind: "console", level: "error", text: "Stytch fetch 401" },
          {
            kind: "requestfailed",
            level: "warning",
            text: "GET /api/foo failed",
          },
        ],
      },
    ],
  });
  const section = renderSection({
    summary,
    published: [{ flow: "sign-in", file: "pr-7/sign-in.png" }],
    repo: "beginner-work/tinker",
    branch: "previews",
  });
  assert.match(section, /Stytch fetch 401/);
  assert.match(section, /GET \/api\/foo failed/);
});
