/* Job application store + MCP tools. Fake users only. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");

process.env.STYTCH_PROJECT_ID = "project-test-apps";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "";

let seq = 0;
const userDataRows = [];
const touchRows = [];
const companyRows = [];

const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  tinkerUserData: {
    async create({ data }) {
      const now = new Date();
      const row = Object.assign({ id: "ud_" + (++seq), createdAt: now, updatedAt: now }, data);
      userDataRows.push(row);
      return row;
    },
    async findUnique({ where }) {
      const pair = where.userId_kind;
      if (!pair) return null;
      return userDataRows.find((r) => r.userId === pair.userId && r.kind === pair.kind) || null;
    },
    async upsert({ where, create, update }) {
      const pair = where.userId_kind;
      const row = userDataRows.find((r) => r.userId === pair.userId && r.kind === pair.kind);
      if (!row) return this.create({ data: create });
      Object.assign(row, update, { updatedAt: new Date() });
      return row;
    },
  },
  outreachTouch: {
    async findMany({ where }) {
      return touchRows.filter((row) => {
        if (where.userId && row.userId !== where.userId) return false;
        if (where.companyId && row.companyId !== where.companyId) return false;
        if (where.touchType && row.touchType !== where.touchType) return false;
        if (where.status && where.status.in && !where.status.in.includes(row.status)) return false;
        return true;
      });
    },
    async update({ where, data }) {
      const row = touchRows.find((r) => r.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async findUnique({ where }) {
      return touchRows.find((r) => r.id === where.id) || null;
    },
  },
  targetCompany: {
    async findMany() { return companyRows.slice(); },
  },
};

function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}

const libDir = path.resolve(__dirname, "..", "api", "_lib");
const apiDir = path.resolve(__dirname, "..", "api");
[
  "job-application-store.js",
  "business-days.js",
  "db.js",
  "outreach-schedule-store.js",
  "leads-companies-store.js",
  "leads-store.js",
  "calendar-date.js",
].forEach((rel) => delete require.cache[path.join(libDir, rel)]);
delete require.cache[path.join(apiDir, "mcp.js")];

stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "leads-companies-store.js"), {
  UNAVAILABLE: "Companies unavailable",
  ensureTable: async () => {},
  listCompanies: async ({ userId }) => companyRows.filter((c) => c.userId === userId),
  presentCompany: (row) => Object.assign({}, row),
});
stubAt(path.join(libDir, "outreach-schedule-store.js"), {
  UNAVAILABLE: "Schedule unavailable",
  ensureTable: async () => {},
  updateTouch: async ({ id, patch }) => {
    const row = touchRows.find((r) => r.id === id);
    if (!row) throw Object.assign(new Error("missing"), { status: 404 });
    if (patch && patch.date) row.date = new Date(patch.date + "T00:00:00.000Z");
    return {
      id: row.id,
      companyId: row.companyId,
      touchType: row.touchType,
      status: row.status,
      date: patch.date,
    };
  },
});

const store = require("../api/_lib/job-application-store.js");

test("create/list/update/mark done for fake user (fit-scan shaped fields)", async () => {
  userDataRows.length = 0;
  touchRows.length = 0;
  companyRows.length = 0;
  companyRows.push({
    id: "co_figma",
    userId: "fake-user-a",
    name: "Figma",
    status: "active",
    priority: 1,
    northStar: false,
    tier: "wave_1",
  });
  touchRows.push({
    id: "touch_rec",
    userId: "fake-user-a",
    companyId: "co_figma",
    touchType: "recruiter_outreach",
    status: "planned",
    date: new Date("2026-10-10T00:00:00.000Z"),
  });

  const created = await store.createApplication({
    userId: "fake-user-a",
    roleTitle: "Engineering Manager, Platform",
    companyName: "Figma",
    companyId: "co_figma",
    postingUrl: "https://www.figma.com/careers/platform-em",
    payRange: "$250k-$320k + equity",
    fitNotes: "Product-minded platform leadership.",
    referrerName: "",
  });
  assert.equal(created.status, "open");
  assert.equal(created.roleTitle, "Engineering Manager, Platform");
  assert.ok(created.id.startsWith("app_"));

  const listed = await store.listApplications({ userId: "fake-user-a", status: "open" });
  assert.equal(listed.length, 1);

  const updated = await store.updateApplication({
    userId: "fake-user-a",
    applicationId: created.id,
    patch: { fitNotes: "Updated fit notes for Figma." },
  });
  assert.equal(updated.fitNotes, "Updated fit notes for Figma.");

  const done = await store.markApplicationDone({
    userId: "fake-user-a",
    emailHint: "fake@example.com",
    applicationId: created.id,
    actor: { kind: "bot", label: "bot:test" },
  });
  assert.equal(done.application.status, "done");
  assert.ok(done.application.doneAt);
  assert.equal(done.recruiterTouches.length, 1);
  // 1 business day after doneAt (today) — just assert date was rewritten
  assert.ok(done.recruiterTouches[0].date);

  const other = await store.listApplications({ userId: "fake-user-b" });
  assert.equal(other.length, 0, "fake users stay isolated");
});

test("drop status records droppedAt, never sets doneAt, and filters correctly", async () => {
  userDataRows.length = 0;
  touchRows.length = 0;
  companyRows.length = 0;

  const created = await store.createApplication({
    userId: "fake-user-drop",
    roleTitle: "Engineering Manager, Bill Pay",
    companyName: "Brex",
  });
  assert.equal(created.status, "open");
  assert.equal(created.droppedAt, null);

  const dropped = await store.updateApplication({
    userId: "fake-user-drop",
    applicationId: created.id,
    patch: { status: "dropped" },
  });
  assert.equal(dropped.status, "dropped");
  assert.ok(dropped.droppedAt);
  assert.equal(dropped.doneAt, null, "dropping never sets doneAt");

  const onlyDropped = await store.listApplications({ userId: "fake-user-drop", status: "dropped" });
  assert.equal(onlyDropped.length, 1);
  assert.equal(onlyDropped[0].id, created.id);

  const onlyOpen = await store.listApplications({ userId: "fake-user-drop", status: "open" });
  assert.equal(onlyOpen.length, 0);

  const onlyDone = await store.listApplications({ userId: "fake-user-drop", status: "done" });
  assert.equal(onlyDone.length, 0);

  const reopened = await store.updateApplication({
    userId: "fake-user-drop",
    applicationId: created.id,
    patch: { status: "open" },
  });
  assert.equal(reopened.status, "open");
  assert.equal(reopened.droppedAt, null, "reopening clears droppedAt");
  assert.equal(reopened.doneAt, null);

  const createdDropped = await store.createApplication({
    userId: "fake-user-drop",
    roleTitle: "Engineering Manager, Platform",
    companyName: "Figma",
    status: "dropped",
  });
  assert.equal(createdDropped.status, "dropped");
  assert.ok(createdDropped.droppedAt);
  assert.equal(createdDropped.doneAt, null);

  await assert.rejects(
    () => store.updateApplication({
      userId: "fake-user-drop",
      applicationId: created.id,
      patch: { status: "archived" },
    }),
    (err) => err && err.status === 400 && /open, done, or dropped/.test(err.message),
  );
});

test("stage and appliedAt validate, auto-set stageUpdatedAt, and filter", async () => {
  userDataRows.length = 0;
  touchRows.length = 0;
  companyRows.length = 0;

  const created = await store.createApplication({
    userId: "fake-user-stage",
    roleTitle: "Engineering Manager, Platform",
    companyName: "Figma",
    stage: "applied",
    appliedAt: "2026-09-15",
  });
  assert.equal(created.stage, "applied");
  assert.equal(created.appliedAt, "2026-09-15");
  assert.ok(created.stageUpdatedAt);
  const firstStageAt = created.stageUpdatedAt;

  const legacy = await store.createApplication({
    userId: "fake-user-stage",
    roleTitle: "Staff Engineer",
    companyName: "Notion",
  });
  assert.equal(legacy.stage, null);
  assert.equal(legacy.appliedAt, null);
  assert.equal(legacy.stageUpdatedAt, null);

  const sameStage = await store.updateApplication({
    userId: "fake-user-stage",
    applicationId: created.id,
    patch: { stage: "applied", fitNotes: "still applied" },
  });
  assert.equal(sameStage.stageUpdatedAt, firstStageAt, "unchanged stage does not bump stageUpdatedAt");
  assert.equal(sameStage.fitNotes, "still applied");

  const advanced = await store.updateApplication({
    userId: "fake-user-stage",
    applicationId: created.id,
    patch: { stage: "interviewing" },
  });
  assert.equal(advanced.stage, "interviewing");
  assert.ok(advanced.stageUpdatedAt);
  assert.notEqual(advanced.stageUpdatedAt, firstStageAt);

  const byStage = await store.listApplications({ userId: "fake-user-stage", stage: "interviewing" });
  assert.equal(byStage.length, 1);
  assert.equal(byStage[0].id, created.id);
  assert.equal(byStage[0].stage, "interviewing");
  assert.equal(byStage[0].appliedAt, "2026-09-15");

  const byApplied = await store.listApplications({ userId: "fake-user-stage", stage: "applied" });
  assert.equal(byApplied.length, 0);

  const got = await store.getApplication({ userId: "fake-user-stage", applicationId: created.id });
  assert.equal(got.stage, "interviewing");
  assert.equal(got.appliedAt, "2026-09-15");
  assert.ok(got.stageUpdatedAt);

  await assert.rejects(
    () => store.createApplication({
      userId: "fake-user-stage",
      roleTitle: "EM",
      companyName: "X",
      stage: "phone_screen",
    }),
    (err) => err && err.status === 400 && /stage must be/.test(err.message),
  );

  await assert.rejects(
    () => store.updateApplication({
      userId: "fake-user-stage",
      applicationId: created.id,
      patch: { stage: "onsite" },
    }),
    (err) => err && err.status === 400 && /stage must be/.test(err.message),
  );

  await assert.rejects(
    () => store.createApplication({
      userId: "fake-user-stage",
      roleTitle: "EM",
      companyName: "X",
      appliedAt: "not-a-date",
    }),
    (err) => err && err.status === 400 && /appliedAt must be a date/.test(err.message),
  );

  await assert.rejects(
    () => store.listApplications({ userId: "fake-user-stage", stage: "bogus" }),
    (err) => err && err.status === 400 && /stage must be/.test(err.message),
  );
});

test("UI wires messages-application.js and SW precaches it", () => {
  const { EXPECTED_SW_CACHE_VERSION } = require("./helpers/sw-cache-version.js");
  const index = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "sw.js"), "utf8");
  const shell = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "messages-shell.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "messages-application.js"), "utf8");
  assert.match(index, /messages-application\.js/);
  assert.match(sw, /messages-application\.js/);
  assert.match(sw, new RegExp(EXPECTED_SW_CACHE_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(shell, /APPLICATION_PREFIX/);
  assert.match(shell, /selectApplication/);
  assert.match(shell, /kind === "application"/);
  assert.match(shell, /postingUrl/);
  assert.match(app, /postingUrl/);
  assert.match(app, /renderProfileLinks/);
  assert.match(app, /appliedAt|stage/);
  assert.match(shell, /messages-rail__stage/);
  assert.match(shell, /formatAppliedAt|appliedAt/);
});
