/* Practice files must not show instructional scaffolds in the editor. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const revision = require("../src/renderer/lib/exercise-revision.js");
const reconstruct = require("../src/renderer/lib/exercise-reconstruct.js");
const seedApi = JSON.parse(
  fs.readFileSync(
    path.join(root, "api/_lib/seeds/exercise-workspace-seed.json"),
    "utf8"
  )
);
const seedLib = JSON.parse(
  fs.readFileSync(
    path.join(root, "src/renderer/lib/exercise-workspace-seed.json"),
    "utf8"
  )
);
const uiSrc = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);
const beforeHtml = fs.readFileSync(
  path.join(root, "src/renderer/repo/harness/exercise-scaffold-before.html"),
  "utf8"
);
const afterHtml = fs.readFileSync(
  path.join(root, "src/renderer/repo/harness/exercise-scaffold-after.html"),
  "utf8"
);

function practiceContents(seed) {
  const out = [];
  function walk(nodes) {
    for (const n of nodes || []) {
      const p = String(n.path || n.name || "");
      if (n.type === "file" && !p.startsWith("solutions/")) {
        if (/api\.md$|openapi\.ya?ml$/i.test(p)) {
          out.push({ path: p, content: String(n.content || "") });
        }
      }
      walk(n.children);
    }
  }
  const ex = seed.exercises && seed.exercises["api-design"];
  walk(ex && ex.nodes);
  return out;
}

test("stripInstructionalScaffold clears Tyler's HTML comment scaffold", () => {
  const raw =
    "<!-- Document the payments API contract from a caller's perspective. The headings below map to: ask = what they can request, send = request body, return = success shape, wrong = errors. -->\n\n## ask\n\n## send\n\n## return\n\n## wrong\n";
  assert.equal(revision.stripInstructionalScaffold(raw).trim(), "");
  assert.equal(revision.looksLikeInstructionalScaffold(raw), true);
  const polished =
    "# PaymentIntent\n\n## GET /payment_intents/{id}\n\n### 200\n\nid: string\n";
  assert.equal(revision.stripInstructionalScaffold(polished).trim(), polished.trim());
  assert.equal(revision.looksLikeInstructionalScaffold(polished), false);
});

test("seed practice starters have no instructional scaffolds", () => {
  for (const seed of [seedApi, seedLib]) {
    for (const row of practiceContents(seed)) {
      assert.doesNotMatch(row.content, /<!--/);
      assert.doesNotMatch(row.content, /Type your OpenAPI|Re-type your|Do not paste from/i);
      assert.doesNotMatch(row.content, /headings below map/i);
      assert.equal(
        revision.stripInstructionalScaffold(row.content).trim(),
        String(row.content || "").trim()
      );
    }
  }
});

test("reconstruct rejects scaffold startingPracticeFile", () => {
  assert.throws(() =>
    reconstruct.validatePayload(
      {
        sourceEssayId: "e1",
        goalId: "g1",
        goalTitle: "Payments",
        nextPrompt: "Add the 404.",
        level: 20,
        practicePath: "api.md",
        fileName: "api.md",
        startingPracticeFile:
          "<!-- Document the payments API contract from a caller's perspective. -->\n",
        zpd: { unaided: "a", justBeyond: "b" },
      },
      [{ id: "e1", title: "t", body: "Named GET /payment_intents/{id}." }]
    )
  );
});

test("editor UI strips scaffolds; harnesses show before/after", () => {
  assert.match(uiSrc, /stripInstructionalScaffold/);
  assert.match(beforeHtml, /Document the payments API contract/);
  assert.match(beforeHtml, /headings below map/);
  assert.match(beforeHtml, /&lt;!--/);
  assert.match(afterHtml, /GET \/payment_intents\/\{id\}/);
  assert.doesNotMatch(afterHtml, /<!--/);
  assert.doesNotMatch(afterHtml, /headings below map/);
});
