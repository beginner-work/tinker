#!/usr/bin/env node
/* Download EdNet KT1 + KT3 (and optionally KT4 / contents) into a local cache.
 * Does not commit data. Mirrors: USTC EdNet index + riiid/ednet Google Drive.
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
/** Official Riiid Google Drive id for KT3 (USTC mirror historically truncated). */
const GDRIVE_KT3_ID = "1TVyGIWU1Mn3UCjjeD6bcZ57YspByUV7-";

const ARTIFACTS = {
  kt1: { file: "EdNet-KT1.zip", url: `${USTC}/EdNet-KT1.zip` },
  kt3: {
    file: "EdNet-KT3.zip",
    url: `${USTC}/EdNet-KT3.zip`,
    // Expected ~763MB; USTC listing is ~543MB without EOCD.
    minBytes: 700_000_000,
    gdriveId: GDRIVE_KT3_ID,
  },
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

function zipLooksValid(dest, minBytes) {
  if (!fs.existsSync(dest)) return false;
  const size = fs.statSync(dest).size;
  if (size < 1000) return false;
  if (typeof minBytes === "number" && size < minBytes) return false;
  // EOCD signature near the end of a valid zip.
  const fd = fs.openSync(dest, "r");
  try {
    const buf = Buffer.alloc(Math.min(128, size));
    fs.readSync(fd, buf, 0, buf.length, size - buf.length);
    return buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  } finally {
    fs.closeSync(fd);
  }
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

function downloadGdrive(fileId, dest) {
  console.error(`[ednet] Google Drive fallback id=${fileId}`);
  console.error(`[ednet] → ${dest}`);
  const result = spawnSync(
    "python3",
    ["-m", "gdown", fileId, "-O", dest],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(`[ednet] gdown failed (exit ${result.status}). pip install gdown`);
    return false;
  }
  return fs.existsSync(dest) && fs.statSync(dest).size > 1000;
}

function ensureArtifact(art, zipPath) {
  if (zipLooksValid(zipPath, art.minBytes)) {
    console.error(`[ednet] valid zip present: ${zipPath}`);
    return true;
  }
  if (fs.existsSync(zipPath)) {
    console.error(
      `[ednet] removing invalid/truncated zip (${fs.statSync(zipPath).size} bytes): ${zipPath}`,
    );
    fs.unlinkSync(zipPath);
  }
  let ok = download(art.url, zipPath);
  if (!zipLooksValid(zipPath, art.minBytes)) {
    if (ok && fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    ok = false;
  }
  if (!ok && art.gdriveId) {
    ok = downloadGdrive(art.gdriveId, zipPath) && zipLooksValid(zipPath, art.minBytes);
  }
  return ok;
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
    const ok = ensureArtifact(art, zipPath);
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
      "[ednet] Alternate sources: https://github.com/riiid/ednet (bit.ly → Google Drive) or Kaggle.",
    );
    process.exitCode = 2;
    return;
  }
  console.error("[ednet] ready.");
}

if (require.main === module) main();

module.exports = {
  cacheDir,
  ARTIFACTS,
  download,
  unzip,
  zipLooksValid,
  ensureArtifact,
  GDRIVE_KT3_ID,
};
