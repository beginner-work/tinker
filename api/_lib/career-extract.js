/* Turn an uploaded resume into proposed facts.
 *
 * PDF or markdown becomes text in memory. The model lists facts. Each
 * excerpt has to appear in the upload. The file itself is not stored.
 * Nothing returned here is verified.
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const { extractPdfText } = require("./pdf-text.js");
const { FACT_KINDS } = require("../../src/renderer/career/catalog.js");
const { newFactId } = require("./career.js");

const EXTRACT_MODEL = "claude-opus-4-8";
const EXTRACT_MARKER = "CAREER_FACT_EXTRACT";
const MAX_DOCS = 6;
const MAX_TEXT = 80000;

const EXTRACT_SYSTEM = [
  EXTRACT_MARKER,
  "Extract small checkable career facts from the document.",
  "Return JSON only: {\"facts\":[{\"kind\":\"employer|title|dates|team_size|location|metric|degree|contact|story|other\",\"value\":\"...\",\"excerpt\":\"...\",\"baseline\":null,\"mechanism\":null}]}",
  "excerpt must be copied exactly from the document, long enough to find again.",
  "value is the checkable fact in a short phrase. Do not invent numbers, dates, titles, or employers.",
  "For a metric, baseline and mechanism are null unless the document states them in the excerpt.",
  "Do not mark anything verified. Do not include phone numbers, email addresses, or street addresses.",
].join(" ");

function collapse(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function looksLikeContact(value) {
  const text = String(value || "");
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) return true;
  if (/\b\d{3}[-.)\s]\d{3}[-.\s]\d{4}\b/.test(text)) return true;
  return false;
}

function excerptIn(documentText, excerpt) {
  const doc = collapse(documentText);
  const needle = collapse(excerpt);
  if (needle.length < 12) return false;
  return doc.includes(needle);
}

function textFromDocument(doc) {
  if (!doc || typeof doc !== "object") {
    throw Object.assign(new Error("Each file needs a name and text or a PDF."), { status: 400 });
  }
  const name = typeof doc.name === "string" && doc.name.trim() ? doc.name.trim().slice(0, 200) : "upload";
  const kind = doc.kind === "pdf" || /\.pdf$/i.test(name) ? "pdf" : "markdown";
  let text = "";
  if (kind === "pdf") {
    if (typeof doc.pdf_base64 !== "string" || !doc.pdf_base64.trim()) {
      throw Object.assign(new Error("A PDF upload needs its bytes."), { status: 400 });
    }
    let bytes;
    try {
      bytes = Buffer.from(doc.pdf_base64, "base64");
    } catch {
      throw Object.assign(new Error("Could not read that PDF."), { status: 400 });
    }
    text = extractPdfText(bytes);
  } else {
    if (typeof doc.text !== "string" || !doc.text.trim()) {
      throw Object.assign(new Error("A markdown upload needs text."), { status: 400 });
    }
    text = doc.text;
  }
  if (text.length > MAX_TEXT) {
    throw Object.assign(new Error("That file is too long to extract in one pass."), { status: 400 });
  }
  return { name, text };
}

function parseFacts(raw, documents) {
  const text = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Could not read proposed facts."), { status: 502 });
  }
  const list = parsed && Array.isArray(parsed.facts) ? parsed.facts : [];
  const byName = new Map(documents.map((doc) => [doc.name, doc.text]));
  const joined = documents.map((doc) => doc.text).join("\n");
  const facts = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (!FACT_KINDS.includes(item.kind)) continue;
    if (typeof item.value !== "string" || !item.value.trim()) continue;
    if (typeof item.excerpt !== "string") continue;
    if (looksLikeContact(item.value) || looksLikeContact(item.excerpt)) continue;
    let document = documents[0] ? documents[0].name : "upload";
    let sourceText = joined;
    if (typeof item.document === "string" && byName.has(item.document)) {
      document = item.document;
      sourceText = byName.get(item.document);
    } else {
      const owner = documents.find((doc) => excerptIn(doc.text, item.excerpt));
      if (owner) {
        document = owner.name;
        sourceText = owner.text;
      }
    }
    if (!excerptIn(sourceText, item.excerpt)) continue;
    const fact = {
      id: newFactId(),
      kind: item.kind,
      value: item.value.trim().slice(0, 500),
      source: {
        document,
        excerpt: collapse(item.excerpt).slice(0, 500),
      },
      status: "proposed",
      updated_at: new Date().toISOString(),
    };
    if (item.kind === "metric") {
      fact.baseline = typeof item.baseline === "string" && item.baseline.trim()
        ? item.baseline.trim().slice(0, 300)
        : null;
      fact.mechanism = typeof item.mechanism === "string" && item.mechanism.trim()
        ? item.mechanism.trim().slice(0, 300)
        : null;
    }
    facts.push(fact);
    if (facts.length >= 40) break;
  }
  return facts;
}

async function extractProposed(documents, callModel) {
  if (!Array.isArray(documents) || !documents.length) {
    throw Object.assign(new Error("Upload a resume first."), { status: 400 });
  }
  if (documents.length > MAX_DOCS) {
    throw Object.assign(new Error("Upload at most 6 files at a time."), { status: 400 });
  }
  const prepared = documents.map(textFromDocument);
  const caller = callModel || (async (system, content) => {
    const result = await callAnthropic({
      system,
      model: EXTRACT_MODEL,
      maxTokens: 4096,
      messages: [{ role: "user", content }],
    });
    return result.text;
  });
  const content = prepared.map((doc) => "Document: " + doc.name + "\n" + doc.text).join("\n\n");
  let raw;
  try {
    raw = await caller(EXTRACT_SYSTEM, content);
  } catch (err) {
    if (err && err.status === 400) throw err;
    throw Object.assign(new Error("Could not extract facts."), { status: 502 });
  }
  return parseFacts(raw, prepared);
}

module.exports = {
  EXTRACT_MARKER,
  excerptIn,
  looksLikeContact,
  textFromDocument,
  parseFacts,
  extractProposed,
};
