/* Exercise workspace: seed merge, move/rename/create/delete, no overwrite. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const core = require("../src/renderer/lib/exercise-workspace-core.js");
const seed = JSON.parse(
  fs.readFileSync(
    path.join(root, "api/_lib/seeds/exercise-workspace-seed.json"),
    "utf8"
  )
);
const manifest = require("../src/renderer/exercises/manifest.js");
const storeSrc = fs.readFileSync(
  path.join(root, "api/_lib/exercise-workspace-store.js"),
  "utf8"
);
const apiSrc = fs.readFileSync(
  path.join(root, "api/exercise-workspace.js"),
  "utf8"
);
const uiSrc = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);
const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");

function seeded() {
  return core.buildSeedWorkspace(seed, manifest.modules);
}

test("seed builds api-design tree from lindowlabs snapshot", () => {
  const ws = seeded();
  assert.deepEqual(Object.keys(ws.exercises).sort(), ["api-design"]);
  assert.ok(ws.exercises["api-design"]);
  assert.ok(ws.exercises["api-design"].nodes.length > 0);
  assert.ok(ws.exerciseOrder.includes("api-design"));
  assert.equal(ws.exercises["stripe-payment-intent"], undefined);
  assert.equal(ws.exercises["formation-persistent-storage"], undefined);
  const names = ws.exercises["api-design"].nodes.map((n) => n.name);
  assert.ok(names.includes("README.md"));
  assert.ok(names.includes("steps.json"));
  assert.equal(names.includes("extras"), false);
});

test("create, rename, move, and delete nodes", () => {
  const ws = seeded();
  const exId = "api-design";
  const created = core.createNode(ws, {
    exerciseId: exId,
    type: "folder",
    name: "scratch",
    parentId: null,
  });
  const folderId = created.node.id;
  assert.equal(created.node.type, "folder");

  const file = core.createNode(ws, {
    exerciseId: exId,
    type: "file",
    name: "notes.ts",
    parentId: folderId,
    content: "export {}\n",
  });
  assert.equal(file.node.parentId, folderId);
  assert.equal(file.node.content, "export {}\n");

  core.renameNode(ws, {
    exerciseId: exId,
    nodeId: file.node.id,
    name: "renamed.ts",
  });
  assert.equal(core.nodeById(ws.exercises[exId].nodes, file.node.id).name, "renamed.ts");

  assert.throws(
    () => core.deleteNode(ws, { exerciseId: exId, nodeId: folderId, confirm: false }),
    (err) => err && err.status === 409 && err.code === "folder_not_empty"
  );

  const moved = core.moveNode(ws, {
    exerciseId: exId,
    nodeId: file.node.id,
    parentId: null,
  });
  assert.equal(moved.node.parentId, null);

  // Folder is empty after file moved out.
  const del = core.deleteNode(ws, {
    exerciseId: exId,
    nodeId: folderId,
    confirm: false,
  });
  assert.equal(del.deletedId, folderId);
  assert.equal(core.nodeById(ws.exercises[exId].nodes, folderId), null);

  core.deleteNode(ws, {
    exerciseId: exId,
    nodeId: file.node.id,
    confirm: true,
  });
  assert.equal(core.nodeById(ws.exercises[exId].nodes, file.node.id), null);
});

test("seed/sync keeps saved structure and only adds new exercises", () => {
  const ws = seeded();
  const exId = "api-design";
  const beforeCount = ws.exercises[exId].nodes.length;
  const firstFile = ws.exercises[exId].nodes.find((n) => n.type === "file");
  assert.ok(firstFile);
  core.renameNode(ws, {
    exerciseId: exId,
    nodeId: firstFile.id,
    name: "owner-renamed.md",
  });
  core.createNode(ws, {
    exerciseId: exId,
    type: "folder",
    name: "owner-folder",
    parentId: null,
  });

  const seedAgain = seeded();
  // Simulate a brand-new upstream exercise appearing in seed.
  seedAgain.exercises["brand-new-lab"] = {
    id: "brand-new-lab",
    name: "Brand New Lab",
    nodes: [
      { id: "file_new", name: "README.md", type: "file", parentId: null, content: "# hi\n" },
    ],
  };
  seedAgain.exerciseOrder.push("brand-new-lab");

  const merged = core.mergeSeedIntoSaved(ws, seedAgain);
  const renamed = merged.exercises[exId].nodes.find((n) => n.id === firstFile.id);
  assert.equal(renamed.name, "owner-renamed.md");
  assert.ok(merged.exercises[exId].nodes.some((n) => n.name === "owner-folder"));
  assert.ok(merged.exercises[exId].nodes.length >= beforeCount);
  assert.ok(merged.exercises["brand-new-lab"]);
  assert.equal(merged.exercises["brand-new-lab"].nodes[0].name, "README.md");
  // Existing exercise node count should not snap back to pure seed size.
  assert.notEqual(
    merged.exercises[exId].nodes.length,
    seedAgain.exercises[exId].nodes.length
  );
});

test("reorder_exercises changes order without touching trees", () => {
  const ws = seeded();
  const snapshot = JSON.stringify(ws.exercises["api-design"].nodes);
  const reversed = ws.exerciseOrder.slice().reverse();
  core.reorderExercises(ws, { order: reversed });
  assert.deepEqual(ws.exerciseOrder, reversed);
  assert.equal(JSON.stringify(ws.exercises["api-design"].nodes), snapshot);
});

test("pruneRetiredCurriculum drops Formation, stripe, deleted labs, and api-design extras", () => {
  const ws = seeded();
  const ownerReadme = ws.exercises["api-design"].nodes.find((n) => n.name === "README.md");
  assert.ok(ownerReadme);
  core.renameNode(ws, {
    exerciseId: "api-design",
    nodeId: ownerReadme.id,
    name: "owner-readme.md",
  });
  const ownerNotes = core.createNode(ws, {
    exerciseId: "api-design",
    type: "file",
    name: "my-notes.md",
    parentId: null,
    content: "keep me\n",
  });

  const extras = core.createNode(ws, {
    exerciseId: "api-design",
    type: "folder",
    name: "extras",
    parentId: null,
  });
  core.createNode(ws, {
    exerciseId: "api-design",
    type: "file",
    name: "server.ts",
    parentId: extras.node.id,
    content: "// Fastify leftover\n",
  });

  ws.exercises["formation-persistent-storage"] = {
    id: "formation-persistent-storage",
    name: "Formation: Persistent Storage",
    nodes: [],
  };
  ws.exercises["stripe-payment-intent"] = {
    id: "stripe-payment-intent",
    name: "Stripe PaymentIntent (test mode)",
    nodes: [
      { id: "file_spi", name: "README.md", type: "file", parentId: null, content: "# gone\n" },
    ],
  };
  ws.exercises["bounded-contexts"] = {
    id: "bounded-contexts",
    name: "Bounded contexts",
    nodes: [],
  };
  ws.exerciseOrder = [
    "formation-persistent-storage",
    "stripe-payment-intent",
    "api-design",
    "bounded-contexts",
  ];

  const beforeApiNodes = ws.exercises["api-design"].nodes.length;
  const first = core.pruneRetiredCurriculum(ws, {
    keepIds: ["api-design"],
  });
  assert.equal(first.changed, true);
  assert.deepEqual(first.removedExerciseIds.sort(), [
    "bounded-contexts",
    "formation-persistent-storage",
    "stripe-payment-intent",
  ]);
  assert.deepEqual(first.removedRootFolders, ["api-design/extras"]);
  assert.deepEqual(Object.keys(first.workspace.exercises), ["api-design"]);
  assert.deepEqual(first.workspace.exerciseOrder, ["api-design"]);

  const kept = first.workspace.exercises["api-design"].nodes;
  assert.ok(kept.some((n) => n.id === ownerReadme.id && n.name === "owner-readme.md"));
  assert.ok(kept.some((n) => n.id === ownerNotes.node.id && n.content === "keep me\n"));
  assert.equal(kept.some((n) => n.name === "extras"), false);
  assert.equal(kept.some((n) => n.name === "server.ts"), false);
  assert.ok(kept.length < beforeApiNodes);

  const again = core.pruneRetiredCurriculum(first.workspace, {
    keepIds: ["api-design"],
  });
  assert.equal(again.changed, false);
  assert.deepEqual(again.removedExerciseIds, []);
  assert.deepEqual(again.removedRootFolders, []);
  assert.equal(
    JSON.stringify(again.workspace.exercises["api-design"].nodes),
    JSON.stringify(first.workspace.exercises["api-design"].nodes)
  );
});

test("merge then prune matches list/sync cleanup for legacy sidebars", () => {
  const legacy = {
    exerciseOrder: ["formation-persistent-storage", "stripe-payment-intent", "api-design"],
    exercises: {
      "formation-persistent-storage": {
        id: "formation-persistent-storage",
        name: "Formation: Persistent Storage",
        nodes: [],
      },
      "stripe-payment-intent": {
        id: "stripe-payment-intent",
        name: "Stripe PaymentIntent (test mode)",
        nodes: [
          { id: "spi_1", name: "README.md", type: "file", parentId: null, content: "x\n" },
        ],
      },
      "api-design": {
        id: "api-design",
        name: "Old Fastify name",
        nodes: [
          { id: "readme_1", name: "README.md", type: "file", parentId: null, content: "# mine\n" },
          { id: "dir_ex", name: "extras", type: "folder", parentId: null },
          { id: "file_ex", name: "app.ts", type: "file", parentId: "dir_ex", content: "export {}\n" },
        ],
      },
    },
  };
  const seedWs = seeded();
  const merged = core.mergeSeedIntoSaved(legacy, seedWs);
  assert.ok(merged.exercises["formation-persistent-storage"]);
  const pruned = core.pruneRetiredCurriculum(merged, {
    keepIds: seedWs.exerciseOrder.slice(),
  });
  assert.equal(pruned.changed, true);
  assert.deepEqual(Object.keys(pruned.workspace.exercises), ["api-design"]);
  assert.equal(pruned.workspace.exercises["api-design"].name, seedWs.exercises["api-design"].name);
  assert.ok(
    pruned.workspace.exercises["api-design"].nodes.some(
      (n) => n.id === "readme_1" && n.content === "# mine\n"
    )
  );
  assert.equal(
    pruned.workspace.exercises["api-design"].nodes.some((n) => n.name === "extras"),
    false
  );
});

test("API/store wiring persists via TinkerUserData and never mentions GitHub write", () => {
  assert.match(storeSrc, /exercise_workspace/);
  assert.match(storeSrc, /mergeSeedIntoSaved/);
  assert.match(storeSrc, /pruneRetiredCurriculum/);
  assert.match(storeSrc, /keepIds/);
  assert.match(storeSrc, /tinkerUserData/);
  assert.match(storeSrc, /reviseFromEssay/);
  assert.doesNotMatch(storeSrc, /git push|octokit|createOrUpdateFileContents/i);
  assert.match(apiSrc, /create_node/);
  assert.match(apiSrc, /move_node/);
  assert.match(apiSrc, /delete_node/);
  assert.match(apiSrc, /reorder_exercises/);
  assert.match(apiSrc, /revise_from_essay/);
  assert.match(vercel, /\/api\/exercise-workspace/);
});

test("repo IDE explorer wires exercise trees and drops the Output panel", () => {
  assert.match(html, /id="repo-explorer"/);
  assert.match(html, /id="repo-ex-new-file"/);
  assert.match(html, /id="repo-ex-new-folder"/);
  assert.match(html, /id="repo-code"/);
  assert.match(html, /exercise-workspace-ui\.js/);
  assert.match(html, /exercise-workspace-core\.js/);
  assert.match(html, /id="repo-panel"/);
  assert.doesNotMatch(html, /No in-app runner/);
  assert.doesNotMatch(html, /\u2014/);
  assert.match(uiSrc, /move_node/);
  assert.match(uiSrc, /create_node/);
  assert.match(uiSrc, /delete_node/);
  assert.match(uiSrc, /pruneRetiredCurriculum/);
  assert.match(uiSrc, /draggable/);
  assert.match(uiSrc, /Sign in to (save|Tinker|Learning)/);
  assert.doesNotMatch(uiSrc, /\u2014/);
});
