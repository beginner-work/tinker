#!/usr/bin/env node
/**
 * Pack api/_lib/seeds/exercises/<id>/ trees into both checked-in
 * exercise-workspace-seed.json files. Preserves api-design from the
 * existing API seed; replaces or adds packed module ids.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "api/_lib/seeds/exercises");
const apiSeedPath = path.join(
  root,
  "api/_lib/seeds/exercise-workspace-seed.json"
);
const libSeedPath = path.join(
  root,
  "src/renderer/lib/exercise-workspace-seed.json"
);

const PACK_IDS = [
  "postgres",
  "optimizely",
  "vercel-ai-mcp",
  "prometheus-grafana",
  "stripe",
  "redis",
];

function walk(dir, base = "") {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === "node_modules" || name === ".git" || name === ".DS_Store") {
      continue;
    }
    const abs = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      out.push({ path: rel, type: "folder", content: null });
      out.push(...walk(abs, rel));
    } else if (st.isFile()) {
      out.push({
        path: rel,
        type: "file",
        content: fs.readFileSync(abs, "utf8"),
      });
    }
  }
  return out;
}

function packOne(id) {
  const dir = path.join(sourceRoot, id);
  if (!fs.existsSync(dir)) {
    throw new Error("Missing exercise source: " + dir);
  }
  return { id, nodes: walk(dir) };
}

function main() {
  const existing = JSON.parse(fs.readFileSync(apiSeedPath, "utf8"));
  const exercises = {
    "api-design": existing.exercises["api-design"],
  };
  for (const id of PACK_IDS) {
    exercises[id] = packOne(id);
  }
  const next = {
    repo: existing.repo || "tlindow/lindowlabs",
    branch: existing.branch || "main",
    exercises,
  };
  const text = JSON.stringify(next, null, 2) + "\n";
  fs.writeFileSync(apiSeedPath, text);
  fs.writeFileSync(libSeedPath, text);
  const sizes = Object.fromEntries(
    Object.keys(exercises).map((id) => [
      id,
      exercises[id].nodes.filter((n) => n.type === "file").length,
    ])
  );
  console.log("Packed exercises:", sizes);
}

main();
