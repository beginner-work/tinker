/* LL-72: notes folder path mapping, Markdown round-trip, conflicts, rename, approval. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const core = require("../src/renderer/lib/notes-folder-core.js");
const settingsHtml = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
const notesJs = fs.readFileSync(path.join(root, "src/renderer/notes-folder.js"), "utf8");
const composerJs = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");

test("sanitizePathSegment strips unsafe characters and empties", () => {
  assert.equal(core.sanitizePathSegment("Acme / Labs"), "Acme - Labs");
  assert.equal(core.sanitizePathSegment('a:b*c?d"e<f>g|h'), "a-b-c-d-e-f-g-h");
  assert.equal(core.sanitizePathSegment("  "), "Unknown");
  assert.equal(core.sanitizePathSegment("../etc"), "..-etc");
  assert.equal(core.sanitizePathSegment("..."), "Unknown");
  assert.equal(core.sanitizePathSegment("a".repeat(120)).length, 80);
});

test("noteRelPath maps company and person to Markdown path", () => {
  assert.equal(core.noteRelPath("Stripe", "Jane Doe"), "Stripe/Jane Doe.md");
  assert.equal(core.noteRelPath("", ""), "Unknown/Unknown.md");
  assert.equal(core.noteRelPath("A/B", "C\\D"), "A-B/C-D.md");
});

test("serialize and parseNote round-trip keeps exact body and ids", () => {
  const body = "Hello Jane,\n\nI build quiet software.\n";
  const text = core.serializeNote({
    personId: "lead_1",
    companyId: "co_9",
    updatedAt: "2026-09-29T20:00:00.000Z",
    body,
  });
  assert.match(text, /^---\n/);
  assert.match(text, /person_id: lead_1/);
  assert.match(text, /company_id: co_9/);
  assert.match(text, /updated_at: 2026-09-29T20:00:00.000Z/);
  const parsed = core.parseNote(text);
  assert.equal(parsed.personId, "lead_1");
  assert.equal(parsed.companyId, "co_9");
  assert.equal(parsed.updatedAt, "2026-09-29T20:00:00.000Z");
  assert.equal(parsed.body, body);
  // CRLF input normalizes on serialize; body equality for approval uses normalizeBody.
  const again = core.parseNote(core.serializeNote({
    personId: "lead_1",
    companyId: "co_9",
    updatedAt: "2026-09-29T20:00:00.000Z",
    body: "line1\r\nline2",
  }));
  assert.equal(again.body, "line1\nline2");
});

test("resolveSync imports file-only edits and exports app-only edits", () => {
  assert.deepEqual(
    core.resolveSync({ appBody: "a", fileBody: "a", lastSyncedBody: "a" }),
    { action: "noop", body: "a", notice: "" }
  );
  assert.equal(
    core.resolveSync({ appBody: "app", fileBody: "old", lastSyncedBody: "old" }).action,
    "export"
  );
  assert.equal(
    core.resolveSync({ appBody: "old", fileBody: "file", lastSyncedBody: "old" }).action,
    "import"
  );
  assert.equal(
    core.resolveSync({ appBody: "old", fileBody: "file", lastSyncedBody: "old" }).body,
    "file"
  );
});

test("resolveSync conflict keeps app text and surfaces file as conflictBody", () => {
  const decision = core.resolveSync({
    appBody: "from tinker",
    fileBody: "from drive",
    lastSyncedBody: "shared",
  });
  assert.equal(decision.action, "conflict");
  assert.equal(decision.body, "from tinker");
  assert.equal(decision.conflictBody, "from drive");
  assert.match(decision.notice, /conflict copy/i);
  assert.match(core.conflictRelPath("Stripe/Jane Doe.md", new Date("2026-09-29T12:34:56Z")),
    /^Stripe\/Jane Doe\.conflict-20260929-123456\.md$/);
});

test("resolveRename detects person or company move", () => {
  const same = core.resolveRename("Acme", "Pat", "Acme/Pat.md");
  assert.equal(same.moved, false);
  const renamed = core.resolveRename("Acme", "Patricia", "Acme/Pat.md");
  assert.equal(renamed.moved, true);
  assert.equal(renamed.from, "Acme/Pat.md");
  assert.equal(renamed.to, "Acme/Patricia.md");
  const movedCo = core.resolveRename("NewCo", "Pat", "Acme/Pat.md");
  assert.equal(movedCo.moved, true);
  assert.equal(movedCo.to, "NewCo/Pat.md");
});

test("findFileForPerson prefers non-conflict path and preferred relPath", () => {
  const files = [
    { relPath: "Acme/Pat.conflict-1.md", personId: "p1", body: "x" },
    { relPath: "Acme/Pat.md", personId: "p1", body: "y" },
    { relPath: "Other/Pat.md", personId: "p2", body: "z" },
  ];
  assert.equal(core.findFileForPerson(files, "p1").relPath, "Acme/Pat.md");
  assert.equal(core.findFileForPerson(files, "p1", "Acme/Pat.conflict-1.md").relPath, "Acme/Pat.conflict-1.md");
  assert.equal(core.findFileForPerson(files, "missing"), null);
});

test("approvalRevokedByImport is true only when approved text changes", () => {
  assert.equal(core.approvalRevokedByImport("approved_to_send", "same", "same"), false);
  assert.equal(core.approvalRevokedByImport("approved_to_send", "old", "new"), true);
  assert.equal(core.approvalRevokedByImport("approved", "old", "new"), true);
  assert.equal(core.approvalRevokedByImport("draft", "old", "new"), false);
  assert.equal(core.approvalRevokedByImport("sent_by_owner", "old", "new"), false);
});

test("notes folder syncs Lead.notes; draft approval stays on LeadDraft edits", async () => {
  process.env.STYTCH_PROJECT_ID = "project-test-notes-folder";
  process.env.STYTCH_SECRET = "secret-test-not-real";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  process.env.LEADS_OWNER_ALLOWLIST = "";

  let seq = 0;
  const tables = {};
  function model() {
    const rows = [];
    return {
      rows,
      async create({ data }) {
        const now = new Date(Date.UTC(2026, 8, 29, 21, 0, ++seq));
        const row = Object.assign({ id: "row_" + seq, createdAt: now, updatedAt: now }, data);
        rows.push(row);
        return row;
      },
      async findUnique({ where }) {
        if (where.id) return rows.find((row) => row.id === where.id) || null;
        const pair = where.userId_kind;
        if (pair) return rows.find((row) => row.userId === pair.userId && row.kind === pair.kind) || null;
        return null;
      },
      async findMany({ where = {} } = {}) {
        return rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
      },
      async update({ where, data }) {
        const row = rows.find((item) => item.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      async upsert({ where, create, update }) {
        const pair = where.userId_kind;
        const row = rows.find((item) => item.userId === pair.userId && item.kind === pair.kind);
        if (!row) return this.create({ data: create });
        Object.assign(row, update, { updatedAt: new Date() });
        return row;
      },
    };
  }
  for (const name of [
    "lead", "leadDraft", "leadEvent", "tinkerUserData", "targetCompany", "outreachTouch", "outreachSession",
  ]) tables[name] = model();
  const database = {
    $executeRawUnsafe: async () => 0,
    $transaction: async (fn) => fn(database),
    lead: tables.lead, leadDraft: tables.leadDraft, leadEvent: tables.leadEvent,
    tinkerUserData: tables.tinkerUserData, targetCompany: tables.targetCompany,
    outreachTouch: tables.outreachTouch, outreachSession: tables.outreachSession,
  };
  function stubAt(absPath, exports) {
    const mod = new Module(absPath);
    mod.filename = absPath; mod.loaded = true; mod.exports = exports;
    require.cache[absPath] = mod;
  }
  const libDir = path.resolve(__dirname, "..", "api", "_lib");
  for (const rel of ["db.js", "stytch.js", "leads-store.js", "leads-companies-store.js"]) {
    delete require.cache[path.join(libDir, rel)];
  }
  stubAt(path.join(libDir, "db.js"), database);
  const leads = require("../api/_lib/leads-store.js");
  leads.resetTableCache && leads.resetTableCache();

  const lead = await leads.createLead({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    personName: "Alex Rivera",
    company: "Northwind",
    email: "alex@northwind.test",
    source: "other",
    stage: "new",
    notes: "Owner notepad notes.",
  });
  // File import path writes Lead.notes — does not touch the outreach draft.
  const notesRes = await leads.updateLead({
    id: lead.id,
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    patch: { notes: "Edited on another device." },
  });
  assert.equal(notesRes.notes, "Edited on another device.");

  const created = await leads.createDraft({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id,
    channel: "gmail_outreach",
    body: "Exact approved note.",
    subject: "Hi",
  });
  const draft = created.draft;
  const approvedRes = await leads.approveDraft({
    id: draft.id,
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
  });
  const approved = approvedRes.draft;
  assert.equal(approved.status, "approved_to_send");
  assert.equal(approved.approvedText, "Exact approved note.");

  // Editing the composed draft still revokes approval (review-card path).
  assert.equal(
    core.approvalRevokedByImport(approved.status, approved.body, "Edited outreach body."),
    true
  );
  const revokedRes = await leads.updateDraft({
    id: draft.id,
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    patch: { body: "Edited outreach body." },
  });
  const revoked = revokedRes.draft || revokedRes;
  assert.equal(revoked.status, "draft");
  assert.equal(revoked.approvedText, "");
  assert.equal(revoked.body, "Edited outreach body.");
});

test("settings shows Notes folder row; unsupported copy; no owner-specific paths", () => {
  assert.match(settingsHtml, /data-notes-folder/);
  assert.match(settingsHtml, /Notes folder/);
  assert.match(settingsHtml, /data-notes-folder-pick/);
  assert.match(settingsHtml, /data-notes-folder-clear/);
  assert.match(settingsHtml, /notes still sync through Tinker/i);
  assert.match(settingsHtml, /Google Drive Desktop/);
  assert.match(settingsHtml, /not the Google Drive website picker/i);
  assert.match(settingsHtml, /\.settings__row\[hidden\]/);
  assert.match(settingsHtml, /notes-folder-core\.js/);
  assert.match(settingsHtml, /notes-folder\.js/);
  assert.equal(/\/Users\/Tyler|tylerlindow|\\Tyler\\/i.test(settingsHtml + notesJs + composerJs), false);
});

test("inbox and electron wire notes folder without extra chrome", () => {
  assert.match(indexHtml, /notes-folder-core\.js/);
  assert.match(indexHtml, /notes-folder\.js/);
  assert.match(composerJs, /tinkerNotesFolder\.scheduleWrite/);
  assert.match(composerJs, /applyImportedBody/);
  assert.match(composerJs, /hydrateFromLead|state\.notes\s*=/);
  assert.match(notesJs, /showDirectoryPicker|pickNotesFolder/);
  assert.match(notesJs, /isAppleMobile/);
  assert.match(notesJs, /pickerErrorMessage/);
  assert.match(notesJs, /IndexedDB|indexedDB/);
  assert.match(notesJs, /conflict/);
  assert.match(notesJs, /PATCH", "edit"/);
  assert.match(notesJs, /notes: nextBody/);
  assert.equal(/POST", "draft"/.test(notesJs), false);
  assert.match(mainJs, /notesFolder:pick/);
  assert.match(mainJs, /dialog\.showOpenDialog/);
  assert.match(preloadJs, /pickNotesFolder/);
  // Product principle: no extra chrome beyond the Settings row.
  assert.equal(/notes folder wizard|sync dashboard/i.test(notesJs), false);
});

test("service worker leaves /settings on the network and bumps cache version", () => {
  const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
  assert.match(sw, /tinker-shell-v15/);
  assert.match(sw, /pathname === "\/settings"/);
  assert.match(sw, /isShellNav/);
});
