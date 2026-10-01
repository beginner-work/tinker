/* Lead notes merge + once-only proposed subject + markLeadDone. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-leads-notes-merge";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com";

let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const now = new Date(Date.UTC(2026, 8, 30, 12, 0, ++seq));
      const row = Object.assign({ id: "row_" + seq, createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      if (where.id) return rows.find((row) => row.id === where.id) || null;
      return null;
    },
    async findMany({ where = {} } = {}) {
      return rows.filter((row) => Object.entries(where).every(([key, value]) => {
        if (value && typeof value === "object" && Array.isArray(value.in)) return value.in.includes(row[key]);
        return row[key] === value;
      }));
    },
    async update({ where, data }) {
      const row = rows.find((item) => item.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
  };
}
for (const name of ["lead", "leadDraft", "leadEvent", "tinkerUserData", "targetCompany"]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  lead: tables.lead,
  leadDraft: tables.leadDraft,
  leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData,
  targetCompany: tables.targetCompany,
};
function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async () => ({ session: { user_id: "user-a" }, user: { user_id: "user-a", emails: [{ email: "hunter@example.com" }] } }),
});
stubAt(path.join(libDir, "db.js"), database);
delete require.cache[require.resolve("../api/_lib/leads-store.js")];
const store = require("../api/_lib/leads-store.js");

const DONE_NOTES = [
  "### What do you want Hamid Dadkhah at Ramp to understand about you?",
  "Take a chance",
  "",
  "### When you brought that missed 99.9% target back?",
  "I’m a natural leader.",
  "",
  "### What about ownership?",
  "Reliability requires systems.",
  "",
  "### __done__",
  "",
].join("\n");

const QA_ONLY = DONE_NOTES.replace(/\n### __done__\n?/, "\n");

test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  store.resetTableCache();
});

test("mergeLeadNotes keeps ### __done__ when incoming omits it", () => {
  assert.equal(store.notesHaveDoneMarker(DONE_NOTES), true);
  assert.equal(store.notesHaveDoneMarker(QA_ONLY), false);
  const merged = store.mergeLeadNotes(DONE_NOTES, QA_ONLY);
  assert.equal(store.notesHaveDoneMarker(merged), true);
  assert.match(merged, /Take a chance/);
});

test("mergeLeadNotes refuses empty wipe of existing notepad", () => {
  const merged = store.mergeLeadNotes(DONE_NOTES, "");
  assert.equal(merged, DONE_NOTES);
});

test("email/nextStep update leaves notes untouched", async () => {
  const lead = await store.createLead({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    personName: "Hamid Dadkhah",
    company: "Ramp",
    source: "other",
    notes: DONE_NOTES,
  });
  const saved = await store.updateLead({
    id: lead.id,
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "bot", label: "bot:claire" },
    patch: { email: "hdadkhah@ramp.com", nextStep: "Send the intro email" },
  });
  assert.equal(saved.email, "hdadkhah@ramp.com");
  assert.equal(saved.nextStep, "Send the intro email");
  assert.equal(store.notesHaveDoneMarker(saved.notes), true);
  assert.match(saved.notes, /Take a chance/);
  assert.match(saved.notes, /Reliability requires systems/);
});

test("notes patch without done marker keeps marker from existing", async () => {
  const lead = await store.createLead({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    personName: "Hamid Dadkhah",
    company: "Ramp",
    source: "other",
    notes: DONE_NOTES,
  });
  const saved = await store.updateLead({
    id: lead.id,
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    patch: { notes: QA_ONLY },
  });
  assert.equal(store.notesHaveDoneMarker(saved.notes), true);
  assert.match(saved.notes, /Take a chance/);
});

test("markLeadDone appends marker without replacing Q&A", async () => {
  const lead = await store.createLead({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    personName: "Hamid Dadkhah",
    company: "Ramp",
    source: "other",
    notes: QA_ONLY,
  });
  const saved = await store.markLeadDone({
    id: lead.id,
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "bot", label: "bot:restore" },
  });
  assert.equal(store.notesHaveDoneMarker(saved.notes), true);
  assert.match(saved.notes, /Take a chance/);
  assert.match(saved.notes, /Reliability requires systems/);
  const again = await store.markLeadDone({
    id: lead.id,
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "bot", label: "bot:restore" },
  });
  assert.equal((again.notes.match(/__done__/g) || []).length, 1);
});

test("setProposedSubject writes body and marks origin tinker_answer", async () => {
  const lead = await store.createLead({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    personName: "Rahul Dani",
    company: "Ramp",
    source: "other",
  });
  const first = await store.setProposedSubject({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    subject: "I believe in your ability to build software",
    body: "I believe in your ability to build software",
  });
  assert.equal(first.draft.subject, "I believe in your ability to build software");
  assert.equal(first.draft.body, "I believe in your ability to build software");
  assert.equal(first.draft.origin, store.ORIGIN_TINKER_ANSWER);
  const second = await store.setProposedSubject({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    subject: "Regenerated subject that must not stick",
    body: "different body",
  });
  assert.equal(second.unchanged, true);
  assert.equal(second.draft.subject, "I believe in your ability to build software");
  const forced = await store.setProposedSubject({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    subject: "Owner repair subject",
    body: "Owner repair body",
    force: true,
  });
  assert.equal(forced.draft.subject, "Owner repair subject");
  assert.equal(forced.draft.body, "Owner repair body");
  assert.equal(forced.draft.origin, store.ORIGIN_TINKER_ANSWER);
});

test("hand-edited draft survives regeneration (unknown origin is left alone)", async () => {
  const lead = await store.createLead({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    personName: "Faria Chaudhry",
    company: "Alloy",
    source: "other",
  });
  // Clair/hand compose: origin stays empty (unknown = hand-edited).
  const hand = await store.createDraft({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "bot", label: "bot:mcp" },
    leadId: lead.id,
    channel: "gmail_outreach",
    subject: "Clair hand-written subject for Faria",
    body: "Clair wrote this body by hand.",
  });
  assert.equal(hand.draft.origin, "");
  const regen = await store.setProposedSubject({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    subject: "I believe in your ability to build software",
    body: "I believe in your ability to build software",
    force: true,
  });
  assert.equal(regen.unchanged, true);
  assert.equal(regen.skipped, "hand_edited");
  assert.equal(regen.draft.subject, "Clair hand-written subject for Faria");
  assert.equal(regen.draft.body, "Clair wrote this body by hand.");
  assert.equal(regen.draft.origin, "");
  assert.equal(tables.leadDraft.rows.length, 1);
});

test("saveOutreachDraft clears tinker origin so later regen cannot overwrite Clair", async () => {
  const lead = await store.createLead({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    personName: "Tina Li",
    company: "Ramp",
    source: "other",
  });
  await store.setProposedSubject({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    subject: "Auto subject",
    body: "Auto body",
  });
  const saved = await store.saveOutreachDraft({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "bot", label: "bot:mcp" },
    personId: lead.id,
    channel: "email",
    to: "tina@example.com",
    subject: "Clair subject for Tina",
    body: "Clair body for Tina",
  });
  assert.equal(saved.draft.origin, "");
  assert.equal(saved.draft.subject, "Clair subject for Tina");
  const regen = await store.setProposedSubject({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    subject: "Should not replace Clair",
    body: "Should not replace Clair body",
    force: true,
  });
  assert.equal(regen.skipped, "hand_edited");
  assert.equal(regen.draft.subject, "Clair subject for Tina");
  assert.equal(regen.draft.body, "Clair body for Tina");
});

test("composer sets done before async subject resolve; MCP wires mark_lead_done", () => {
  const root = path.join(__dirname, "..");
  const composer = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
  const mcp = fs.readFileSync(path.join(root, "api/mcp.js"), "utf8");
  const leadsApi = fs.readFileSync(path.join(root, "api/leads.js"), "utf8");
  const notesFolder = fs.readFileSync(path.join(root, "src/renderer/notes-folder.js"), "utf8");
  assert.match(composer, /state\.done = true/);
  assert.match(composer, /if \(state\.done\) return;/);
  // Race fix: capture leadId + transcript before awaits so contact switches
  // cannot drop Faria's draft onto Tina.
  assert.match(composer, /doneLeadId|snapshotTranscript/);
  assert.match(composer, /persistProposedDraft\(leadId/);
  assert.match(composer, /hand_edited|tinker_answer/);
  // Drafts only on This is everything - no open-thread backfill for missing drafts.
  assert.match(composer, /Do not backfill a draft on open/);
  assert.equal(/!openDraft && hasAnswer/.test(composer), false);
  assert.equal(/Done with answers but no draft/.test(composer), false);
  assert.match(composer, /writeAnswerOnlyDraft\(\{\s*leadId:\s*doneLeadId/);
  assert.match(mcp, /mark_lead_done/);
  assert.match(mcp, /markLeadDoneCall/);
  assert.match(mcp, /Person upserts never write company notes/);
  assert.equal(/if \(hasOwn\(args, "notes"\)\) out\.notes = args\.notes;/.test(
    mcp.slice(mcp.indexOf("function companyArgsFromLeadUpsert"), mcp.indexOf("function companyArgsFromUpsert"))
  ), false);
  assert.match(leadsApi, /mark-done/);
  assert.match(notesFolder, /__done__/);
});
