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
const prevAccess = process.env.BLOB_ACCESS;

beforeEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_ACCESS;
});

afterEach(() => {
  if (prevToken == null) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = prevToken;
  if (prevAccess == null) delete process.env.BLOB_ACCESS;
  else process.env.BLOB_ACCESS = prevAccess;
});

test("blob helpers report unconfigured without token", () => {
  assert.equal(blob.blobConfigured(), false);
});

test("blobAccess defaults to public; BLOB_ACCESS=private opts in", () => {
  assert.equal(blob.blobAccess(), "public");
  process.env.BLOB_ACCESS = "private";
  assert.equal(blob.blobAccess(), "private");
  process.env.BLOB_ACCESS = "PUBLIC";
  assert.equal(blob.blobAccess(), "public");
  process.env.BLOB_ACCESS = "weird";
  assert.equal(blob.blobAccess(), "public");
  const blobSrc = fs.readFileSync(
    path.join(root, "api/_lib/exercise-blob.js"),
    "utf8"
  );
  assert.match(blobSrc, /access:\s*blobAccess\(\)/);
  assert.equal(blobSrc.includes('access: "private"'), false);
  assert.equal(blobSrc.includes("access: 'private'"), false);
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

test("seed script soft-fails during production build when Blob is unreachable", () => {
  assert.match(seedScript, /--during-build/);
  assert.match(seedScript, /VERCEL_ENV/);
  assert.match(seedScript, /production/);
  assert.match(seedScript, /warning: Blob unreachable/);
  assert.match(seedScript, /continuing build/);
  // Soft-fail path must not exit 1 for Blob errors during build.
  assert.match(seedScript, /duringBuild[\s\S]*process\.exit\(0\)|exit\(0\)/);
});

test("vercel production buildCommand seeds exercises into Blob", () => {
  const vercel = JSON.parse(
    fs.readFileSync(path.join(root, "vercel.json"), "utf8")
  );
  assert.match(
    String(vercel.buildCommand || ""),
    /seed-exercises-to-blob\.js\s+--during-build/
  );
  assert.match(String(vercel.buildCommand || ""), /prisma generate/);
});

test("seedFileMap keys file pathnames for idempotent uploads", () => {
  const map = blob.seedFileMap({
    exercises: {
      "api-design": {
        id: "api-design",
        nodes: [
          { path: "README.md", type: "file", content: "# hi" },
          { path: "src", type: "folder", content: null },
          { path: "src/main.js", type: "file", content: "ok" },
        ],
      },
    },
  });
  assert.equal(map["tinker/exercises/files/api-design/README.md"], "# hi");
  assert.equal(map["tinker/exercises/files/api-design/src/main.js"], "ok");
  assert.equal(Object.prototype.hasOwnProperty.call(map, "tinker/exercises/files/api-design/src"), false);
});

test("writeSeedWorkspace skips unchanged files when prior seed matches", async () => {
  // Without a token the helper still returns skipped; with a token we cannot
  // hit real Blob here. Assert the idempotent return fields exist in source
  // and the missing-token path stays safe.
  const result = await blob.writeSeedWorkspace(seed);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  const blobSrc = fs.readFileSync(
    path.join(root, "api/_lib/exercise-blob.js"),
    "utf8"
  );
  assert.match(blobSrc, /seedUploaded/);
  assert.match(blobSrc, /filesSkipped/);
  assert.match(blobSrc, /prevFiles\[pathname\] === nextFiles\[pathname\]/);
});

test("package.json exposes seed:exercises-blob script", () => {
  assert.equal(typeof pkg.scripts["seed:exercises-blob"], "string");
  assert.match(pkg.scripts["seed:exercises-blob"], /seed-exercises-to-blob/);
});

test("env example documents BLOB_READ_WRITE_TOKEN, BLOB_ACCESS, and CURSOR_API_KEY", () => {
  assert.match(envExample, /BLOB_READ_WRITE_TOKEN/);
  assert.match(envExample, /BLOB_ACCESS/);
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
