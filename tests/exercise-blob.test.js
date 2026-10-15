/* Exercise Blob SoT: sanitize, retire Formation, fallback without token. */
"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const blob = require("../api/_lib/exercise-blob.js");
const storeSrc = fs.readFileSync(
  path.join(root, "api/_lib/exercise-workspace-store.js"),
  "utf8"
);
const seedScript = fs.readFileSync(
  path.join(root, "scripts/seed-exercises-to-blob.js"),
  "utf8"
);
const seed = JSON.parse(
  fs.readFileSync(
    path.join(root, "api/_lib/seeds/exercise-workspace-seed.json"),
    "utf8"
  )
);
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const pkg = require("../package.json");

const prevToken = process.env.BLOB_READ_WRITE_TOKEN;

beforeEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

afterEach(() => {
  if (prevToken == null) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = prevToken;
});

test("blob helpers report unconfigured without token", () => {
  assert.equal(blob.blobConfigured(), false);
});

test("sanitizeSeed strips Formation and retired ids", () => {
  const dirty = {
    exercises: {
      "api-design": { id: "api-design", nodes: [] },
      "formation-persistent-storage": { id: "formation-persistent-storage", nodes: [] },
      "stripe-payment-intent": { id: "stripe-payment-intent", nodes: [] },
    },
    exerciseOrder: [
      "formation-persistent-storage",
      "api-design",
      "stripe-payment-intent",
    ],
  };
  const clean = blob.sanitizeSeed(dirty);
  assert.deepEqual(Object.keys(clean.exercises).sort(), ["api-design"]);
  assert.deepEqual(clean.exerciseOrder, ["api-design"]);
  assert.equal(/formation/i.test(JSON.stringify(clean)), false);
});

test("isRetiredExerciseId bans Formation by name", () => {
  assert.equal(blob.isRetiredExerciseId("formation-persistent-storage"), true);
  assert.equal(blob.isRetiredExerciseId("Formation-Lab"), true);
  assert.equal(blob.isRetiredExerciseId("api-design"), false);
});

test("writeSeedWorkspace skips when token missing", async () => {
  const result = await blob.writeSeedWorkspace(seed);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "missing_token");
});

test("readSeedWorkspace returns null without token", async () => {
  assert.equal(await blob.readSeedWorkspace(), null);
});

test("store prefers Blob then falls back to local seed", () => {
  assert.match(storeSrc, /exercise-blob/);
  assert.match(storeSrc, /BLOB_READ_WRITE_TOKEN|blobConfigured|readSeedWorkspace/);
  assert.match(storeSrc, /loadLocalSeedJson|exercise-workspace-seed\.json/);
  assert.match(storeSrc, /syncExerciseToBlob/);
  assert.match(storeSrc, /reviseFromEssay/);
});

test("This is everything path syncs exercise into Blob when changed", () => {
  assert.match(storeSrc, /result\.changed/);
  assert.match(storeSrc, /syncExerciseToBlob\(next,\s*args\.exerciseId\)/);
  assert.match(storeSrc, /writeFile/);
});

test("seed script refuses Formation and documents token", () => {
  assert.match(seedScript, /BLOB_READ_WRITE_TOKEN/);
  assert.match(seedScript, /formation/i);
  assert.match(seedScript, /writeSeedWorkspace/);
  assert.match(seedScript, /sanitizeSeed/);
});

test("package.json exposes seed:exercises-blob script", () => {
  assert.equal(typeof pkg.scripts["seed:exercises-blob"], "string");
  assert.match(pkg.scripts["seed:exercises-blob"], /seed-exercises-to-blob/);
});

test("env example documents BLOB_READ_WRITE_TOKEN and CURSOR_API_KEY", () => {
  assert.match(envExample, /BLOB_READ_WRITE_TOKEN/);
  assert.match(envExample, /CURSOR_API_KEY/);
});

test("workspaceNodesToSeedPaths rebuilds relative paths", () => {
  const nodes = [
    { id: "f1", name: "src", type: "folder", parentId: null },
    { id: "a1", name: "README.md", type: "file", parentId: null, content: "# hi" },
    { id: "a2", name: "main.js", type: "file", parentId: "f1", content: "ok" },
  ];
  const paths = blob.workspaceNodesToSeedPaths(nodes);
  const byPath = Object.fromEntries(paths.map((p) => [p.path, p]));
  assert.equal(byPath["README.md"].content, "# hi");
  assert.equal(byPath["src"].type, "folder");
  assert.equal(byPath["src/main.js"].content, "ok");
});

test("checked-in seed never mentions Formation", () => {
  assert.equal(/formation/i.test(JSON.stringify(seed)), false);
  assert.deepEqual(Object.keys(seed.exercises || {}), ["api-design"]);
});
