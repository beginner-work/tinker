/* Generic reading workbook threads (any book).
 *
 * One TinkerUserData row per user, kind "reading_threads". Each thread has
 * an ordered section list, a current section, merge-safe notepad notes
 * (same ### Q / ### __done__ contract as leads), and one pre-read question
 * for the current section. Not DDD-specific.
 */

"use strict";

const crypto = require("crypto");
const {
  mergeLeadNotes,
  ensureDoneMarker,
  notesHaveDoneMarker,
  MAX_NOTES,
} = require("./notes-merge.js");
const { generatePreReadQuestion, fallbackQuestion } = require("./reading-preread.js");

const KIND = "reading_threads";
const UNAVAILABLE = "Reading threads are unavailable right now.";
const MAX_TITLE = 200;
const MAX_AUTHOR = 200;
const MAX_SECTION_TITLE = 300;
const MAX_SECTIONS = 80;
const MAX_THREADS = 40;

function db() {
  return require("./db.js");
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw fail(401, "Sign in to tinker first.");
  }
  return userId.trim();
}

function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
}

function newThreadId() {
  return "read_" + crypto.randomBytes(8).toString("hex");
}

function newSectionId() {
  return "sec_" + crypto.randomBytes(6).toString("hex");
}

function trimTitle(value, label, max, required) {
  const text = String(value == null ? "" : value).trim();
  if (!text) {
    if (required) throw fail(400, label + " is required.");
    return "";
  }
  if (text.length > max) throw fail(400, label + " is too long.");
  return text;
}

function normalizeSectionInput(sections) {
  if (!Array.isArray(sections) || !sections.length) {
    throw fail(400, "sections must be a non-empty ordered list of titles.");
  }
  if (sections.length > MAX_SECTIONS) {
    throw fail(400, "sections is limited to " + MAX_SECTIONS + ".");
  }
  return sections.map((item, index) => {
    const title = typeof item === "string"
      ? trimTitle(item, "sections[" + index + "]", MAX_SECTION_TITLE, true)
      : trimTitle(item && item.title, "sections[" + index + "].title", MAX_SECTION_TITLE, true);
    return {
      id: newSectionId(),
      title,
      status: index === 0 ? "current" : "pending",
      preReadQuestion: "",
      completedAt: null,
    };
  });
}

function presentSection(section) {
  return {
    id: section.id,
    title: section.title,
    status: section.status,
    preReadQuestion: section.preReadQuestion || "",
    completedAt: section.completedAt || null,
  };
}

function presentThread(thread) {
  const sections = Array.isArray(thread.sections) ? thread.sections : [];
  const idx = Math.max(0, Math.min(Number(thread.currentSectionIndex) || 0, Math.max(sections.length - 1, 0)));
  const current = sections[idx] || null;
  return {
    id: thread.id,
    title: thread.title,
    author: thread.author || "",
    sections: sections.map(presentSection),
    currentSectionIndex: idx,
    currentSection: current ? presentSection(current) : null,
    notes: thread.notes || "",
    done: !!thread.done || notesHaveDoneMarker(thread.notes),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

async function readBlob(userId) {
  const prisma = db();
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: KIND } },
  });
  const data = row && row.data && typeof row.data === "object" ? row.data : {};
  const threads = Array.isArray(data.threads) ? data.threads : [];
  return { threads, updatedAt: row ? row.updatedAt : null };
}

async function writeBlob(userId, threads) {
  const prisma = db();
  const data = { threads };
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: KIND } },
    create: { userId, kind: KIND, data },
    update: { data },
  });
}

function findThread(threads, threadId) {
  const id = String(threadId || "").trim();
  if (!id) throw fail(400, "threadId is required.");
  const thread = threads.find((row) => row && row.id === id);
  if (!thread) throw fail(404, "Reading thread not found.");
  return thread;
}

async function listThreads({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    const { threads } = await readBlob(uid);
    return threads.map(presentThread);
  } catch (err) {
    throw storeDown(err);
  }
}

async function getThread({ userId, threadId } = {}) {
  try {
    const uid = requireUserId(userId);
    const { threads } = await readBlob(uid);
    return presentThread(findThread(threads, threadId));
  } catch (err) {
    throw storeDown(err);
  }
}

async function createThread({ userId, title, author, sections } = {}) {
  try {
    const uid = requireUserId(userId);
    const bookTitle = trimTitle(title, "title", MAX_TITLE, true);
    const bookAuthor = trimTitle(author, "author", MAX_AUTHOR, false);
    const normalized = normalizeSectionInput(sections);
    const first = normalized[0];
    first.preReadQuestion = await generatePreReadQuestion({
      bookTitle,
      author: bookAuthor,
      sectionTitle: first.title,
      priorSections: [],
      asked: [],
    });
    const now = new Date().toISOString();
    const thread = {
      id: newThreadId(),
      title: bookTitle,
      author: bookAuthor,
      sections: normalized,
      currentSectionIndex: 0,
      notes: "",
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    const { threads } = await readBlob(uid);
    threads.push(thread);
    while (threads.length > MAX_THREADS) threads.shift();
    await writeBlob(uid, threads);
    return presentThread(thread);
  } catch (err) {
    throw storeDown(err);
  }
}

async function updateNotes({ userId, threadId, notes } = {}) {
  try {
    const uid = requireUserId(userId);
    const { threads } = await readBlob(uid);
    const thread = findThread(threads, threadId);
    thread.notes = mergeLeadNotes(thread.notes, notes);
    if (notesHaveDoneMarker(thread.notes)) thread.done = true;
    thread.updatedAt = new Date().toISOString();
    await writeBlob(uid, threads);
    return presentThread(thread);
  } catch (err) {
    throw storeDown(err);
  }
}

/**
 * Mark the current section done and surface the next section's pre-read
 * question. When the last section finishes, append ### __done__.
 */
async function advanceSection({ userId, threadId, notes } = {}) {
  try {
    const uid = requireUserId(userId);
    const { threads } = await readBlob(uid);
    const thread = findThread(threads, threadId);
    if (thread.done || notesHaveDoneMarker(thread.notes)) {
      thread.notes = ensureDoneMarker(thread.notes);
      thread.done = true;
      thread.updatedAt = new Date().toISOString();
      await writeBlob(uid, threads);
      return presentThread(thread);
    }
    if (notes !== undefined) {
      thread.notes = mergeLeadNotes(thread.notes, notes);
    }
    const sections = Array.isArray(thread.sections) ? thread.sections : [];
    let idx = Math.max(0, Number(thread.currentSectionIndex) || 0);
    if (idx >= sections.length) idx = Math.max(0, sections.length - 1);
    const current = sections[idx];
    if (current) {
      current.status = "done";
      current.completedAt = new Date().toISOString();
    }
    const nextIdx = idx + 1;
    if (nextIdx >= sections.length) {
      thread.currentSectionIndex = idx;
      thread.notes = ensureDoneMarker(thread.notes);
      thread.done = true;
      thread.updatedAt = new Date().toISOString();
      await writeBlob(uid, threads);
      return presentThread(thread);
    }
    const next = sections[nextIdx];
    next.status = "current";
    const prior = sections.slice(0, nextIdx).map((s) => s.title);
    const asked = [];
    if (current && current.preReadQuestion) asked.push(current.preReadQuestion);
    next.preReadQuestion = await generatePreReadQuestion({
      bookTitle: thread.title,
      author: thread.author,
      sectionTitle: next.title,
      priorSections: prior,
      asked,
    }) || fallbackQuestion(thread.title, next.title);
    thread.currentSectionIndex = nextIdx;
    thread.updatedAt = new Date().toISOString();
    await writeBlob(uid, threads);
    return presentThread(thread);
  } catch (err) {
    throw storeDown(err);
  }
}

module.exports = {
  KIND,
  UNAVAILABLE,
  MAX_TITLE,
  MAX_SECTIONS,
  MAX_NOTES,
  presentThread,
  listThreads,
  getThread,
  createThread,
  updateNotes,
  advanceSection,
};
