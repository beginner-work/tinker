#!/usr/bin/env node
/* Download EdNet KT1 + KT3 (and optionally KT4 / contents) into a local cache.
 * Does not commit data. Mirrors: USTC EdNet index + riiid/ednet bit.ly targets.
 *
 * Usage:
 *   node evals/ednet-zpd/download.js
 *   node evals/ednet-zpd/download.js --kt4
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, ".cache");
const USTC = "http://base.ustc.edu.cn/data/EdNet";

const ARTIFACTS = {
  kt1: { file: "EdNet-KT1.zip", url: `${USTC}/EdNet-KT1.zip` },
  kt3: { file: "EdNet-KT3.zip", url: `${USTC}/EdNet-KT3.zip` },
  kt4: { file: "EdNet-KT4.zip", url: `${USTC}/EdNet-KT4.zip` },
  contents: { file: "EdNet-Contents.zip", url: `${USTC}/EdNet-Contents.zip` },
};

function cacheDir() {
  return process.env.EDNET_CACHE_DIR
    ? path.resolve(process.env.EDNET_CACHE_DIR)
    : ROOT;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    console.error(`[ednet] already present: ${dest}`);
    return true;
  }
  console.error(`[ednet] downloading ${url}`);
  console.error(`[ednet] → ${dest}`);
  const tmp = `${dest}.partial`;
  const result = spawnSync(
    "curl",
    ["-fL", "--retry", "3", "--retry-delay", "4", "-o", tmp, url],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    console.error(`[ednet] download failed for ${url} (exit ${result.status})`);
    return false;
  }
  fs.renameSync(tmp, dest);
  return true;
}

function unzip(zipPath, outDir) {
  ensureDir(outDir);
  const marker = path.join(outDir, ".extracted");
  if (fs.existsSync(marker)) {
    console.error(`[ednet] already extracted: ${outDir}`);
    return true;
  }
  console.error(`[ednet] extracting ${zipPath}`);
  const result = spawnSync("unzip", ["-q", "-o", zipPath, "-d", outDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`[ednet] unzip failed (${result.status})`);
    return false;
  }
  fs.writeFileSync(marker, new Date().toISOString());
  return true;
}

function main() {
  const wantKt4 = process.argv.includes("--kt4");
  const dir = cacheDir();
  ensureDir(dir);
  const wanted = ["contents", "kt1", "kt3"];
  if (wantKt4) wanted.push("kt4");

  const report = { cacheDir: dir, ok: true, artifacts: {} };
  for (const key of wanted) {
    const art = ARTIFACTS[key];
    const zipPath = path.join(dir, art.file);
    const ok = download(art.url, zipPath);
    report.artifacts[key] = { zip: zipPath, downloaded: ok };
    if (!ok) {
      report.ok = false;
      continue;
    }
    const extractTo = path.join(dir, key);
    const extracted = unzip(zipPath, extractTo);
    report.artifacts[key].extracted = extracted;
    report.artifacts[key].dir = extractTo;
    if (!extracted) report.ok = false;
  }

  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2));
  console.error(`[ednet] wrote ${manifestPath}`);
  if (!report.ok) {
    console.error(
      "[ednet] one or more downloads failed. Check network / USTC mirror access.",
    );
    console.error(
      "[ednet] Alternate sources: https://github.com/riiid/ednet (bit.ly links) or Kaggle KT3-4 feathers.",
    );
    process.exitCode = 2;
    return;
  }
  console.error("[ednet] ready.");
}

if (require.main === module) main();

module.exports = { cacheDir, ARTIFACTS, download, unzip };
