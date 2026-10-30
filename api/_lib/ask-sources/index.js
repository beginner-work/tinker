/* Per-source grounding corpora for POST /api/ask.
 *
 * Each source lives under api/_lib/ask-sources/<sourceId>/ with:
 *   source.json  — id, label, voiceId, linkedinUrl, …
 *   prompt.md    — system instructions (without the corpus body)
 *   corpus/*     — plain-text / markdown documents Tinker stores
 *
 * Sources are loaded from disk at require-time (Vercel bundles the
 * folder with the function). Unknown sourceIds return null.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
// Stock ElevenLabs premade (Savvy - Warm, Grounded & Natural). Never use a
// personal/cloned voice id here — especially not Tyler's.
const DEFAULT_VOICE_ID = "ogwqBH5bbF03DSbNiRNN";

function listSourceDirs() {
  let entries = [];
  try {
    entries = fs.readdirSync(ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
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

function loadSource(sourceId) {
  const id = String(sourceId || "").trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return null;
  }
  const dir = path.join(ROOT, id);
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
    label: meta.label || "Tyler's agent",
    site: meta.site || "",
    linkedinUrl: meta.linkedinUrl || "https://www.linkedin.com/in/tlindow",
    voiceId: meta.voiceId || DEFAULT_VOICE_ID,
    talkTitle: meta.talkTitle || "",
    prompt,
    docs,
    corpusText,
    systemPrompt: `${prompt}\n\n---\nCORPUS\n---\n\n${corpusText}`,
  };
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
};
