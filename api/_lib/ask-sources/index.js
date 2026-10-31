/* Per-source grounding corpora for POST /api/ask.
 *
 * Each source lives under api/_lib/ask-sources/<sourceId>/ with:
 *   source.json  — id, label, voiceId, linkedinUrl, …
 *   prompt.md    — system instructions (without the corpus body)
 *   corpus/*     — plain-text / markdown documents Tinker stores
 *
 * Lookup order:
 *   1. $TINKER_PRIVATE_DIR/api/_lib/ask-sources/<sourceId>/
 *   2. this directory (public stubs / demos only)
 *
 * Private Lindow Labs corpora are not redistributed in the public repo.
 * Unknown sourceIds return null.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { privateRoot } = require("../private-dir.js");

const ROOT = __dirname;
// Stock ElevenLabs premade (Savvy - Warm, Grounded & Natural). Never use a
// personal/cloned voice id here — especially not Tyler's.
const DEFAULT_VOICE_ID = "ogwqBH5bbF03DSbNiRNN";

function listSourceDirs() {
  const names = new Set();
  const roots = [];
  const priv = privateRoot();
  if (priv) roots.push(path.join(priv, "api", "_lib", "ask-sources"));
  roots.push(ROOT);
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".")) names.add(e.name);
    }
  }
  return [...names].sort();
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function loadCorpusDir(corpusDir) {
  let files = [];
  try {
    files = fs.readdirSync(corpusDir).filter((n) => !n.startsWith("."));
  } catch {
    return [];
  }
  files.sort();
  const docs = [];
  for (const name of files) {
    const full = path.join(corpusDir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const text = readText(full).trim();
    if (!text) continue;
    docs.push({ name, text });
  }
  return docs;
}

function formatCorpus(docs) {
  return docs
    .map((d) => `### ${d.name}\n\n${d.text}`)
    .join("\n\n---\n\n");
}

function candidateDirs(sourceId) {
  const dirs = [];
  const priv = privateRoot();
  if (priv) {
    dirs.push(path.join(priv, "api", "_lib", "ask-sources", sourceId));
  }
  dirs.push(path.join(ROOT, sourceId));
  return dirs;
}

function loadSourceFromDir(id, dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;

  let meta = {};
  try {
    meta = JSON.parse(readText(path.join(dir, "source.json")) || "{}");
  } catch {
    meta = {};
  }
  const prompt = readText(path.join(dir, "prompt.md")).trim();
  const docs = loadCorpusDir(path.join(dir, "corpus"));
  if (!prompt || !docs.length) return null;

  const corpusText = formatCorpus(docs);
  return {
    id: meta.id || id,
    label: meta.label || "Demo agent",
    site: meta.site || "",
    linkedinUrl: meta.linkedinUrl || "https://www.linkedin.com/in/tlindow",
    voiceId: meta.voiceId || DEFAULT_VOICE_ID,
    talkTitle: meta.talkTitle || "",
    prompt,
    docs,
    corpusText,
    systemPrompt: `${prompt}\n\n---\nCORPUS\n---\n\n${corpusText}`,
    loadedFrom: dir,
  };
}

function loadSource(sourceId) {
  const id = String(sourceId || "").trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return null;
  }
  for (const dir of candidateDirs(id)) {
    const loaded = loadSourceFromDir(id, dir);
    if (loaded) return loaded;
  }
  return null;
}

function listSources() {
  return listSourceDirs()
    .map((id) => loadSource(id))
    .filter(Boolean);
}

module.exports = {
  DEFAULT_VOICE_ID,
  loadSource,
  listSources,
  formatCorpus,
  loadCorpusDir,
  candidateDirs,
};
