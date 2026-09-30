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

test("setProposedSubject does not overwrite an existing subject", async () => {
  const lead = await store.createLead({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    personName: "Faria Chaudhry",
    company: "Alloy",
    source: "other",
  });
  const first = await store.setProposedSubject({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    subject: "Original subject for Faria",
  });
  assert.equal(first.draft.subject, "Original subject for Faria");
  const second = await store.setProposedSubject({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    subject: "Regenerated subject that must not stick",
  });
  assert.equal(second.unchanged, true);
  assert.equal(second.draft.subject, "Original subject for Faria");
  const forced = await store.setProposedSubject({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    subject: "Owner repair subject",
    force: true,
  });
  assert.equal(forced.draft.subject, "Owner repair subject");
  const event = tables.leadEvent.rows.find((row) => row.action === "draft_edited");
  assert.ok(event, "expected draft_edited event");
  assert.equal(event.detail.previousSubject, "Original subject for Faria");
  assert.equal(event.detail.nextSubject, "Owner repair subject");
});

test("composer sets done before async subject resolve; MCP wires mark_lead_done", () => {
  const root = path.join(__dirname, "..");
  const composer = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
  const mcp = fs.readFileSync(path.join(root, "api/mcp.js"), "utf8");
  const leadsApi = fs.readFileSync(path.join(root, "api/leads.js"), "utf8");
  const notesFolder = fs.readFileSync(path.join(root, "src/renderer/notes-folder.js"), "utf8");
  assert.match(composer, /state\.done = true/);
  assert.match(composer, /if \(state\.done\) return;/);
  assert.match(composer, /if \(state\.proposedSubject\)/);
  assert.match(mcp, /mark_lead_done/);
  assert.match(mcp, /markLeadDoneCall/);
  assert.match(mcp, /Person upserts never write company notes/);
  assert.equal(/if \(hasOwn\(args, "notes"\)\) out\.notes = args\.notes;/.test(
    mcp.slice(mcp.indexOf("function companyArgsFromLeadUpsert"), mcp.indexOf("function companyArgsFromUpsert"))
  ), false);
  assert.match(leadsApi, /mark-done/);
  assert.match(notesFolder, /__done__/);
});
