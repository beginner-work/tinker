/* GET /api/approvals is public. PUT requires a Stytch session on
 * APPROVAL_ALLOWLIST. Postgres and Stytch are stubbed.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");

const SEND_NOTE =
  "The draft card with its Send button always stays, even when this is off.";

const stytchCalls = [];
let stytchUserId = "user-owner";
let stytchEmails = [];
let stytchShouldThrow = null;
let findManyError = null;

const rows = new Map();

const stytchStub = {
  authenticateSession: async (token) => {
    stytchCalls.push(token);
    if (stytchShouldThrow) throw stytchShouldThrow;
    if (!token) throw Object.assign(new Error("Missing token."), { status: 401 });
    if (token === "good-token") {
      return {
        session: { user_id: stytchUserId },
        user: {
          user_id: stytchUserId,
          emails: stytchEmails.map((email) => ({ email })),
          name: { first_name: "", last_name: "" },
        },
      };
    }
    throw Object.assign(new Error("Session expired."), { status: 401 });
  },
};

const dbStub = {
  approvalSetting: {
    findMany: async () => {
      if (findManyError) throw findManyError;
      return [...rows.values()].map((row) => ({ ...row }));
    },
    update: async ({ where, data }) => {
      const row = rows.get(where.key);
      if (!row) {
        const err = new Error("not found");
        err.code = "P2025";
        throw err;
      }
      row.required = data.required;
      row.updatedBy = data.updatedBy;
      row.updatedAt = data.updatedAt;
      return { ...row };
    },
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
stubAt(path.join(libDir, "stytch.js"), stytchStub);
stubAt(path.join(libDir, "db.js"), dbStub);

const catalog = require("../api/_lib/approvals.js");
const handler = require("../api/approvals.js");

function seedRows() {
  rows.clear();
  for (const item of catalog.APPROVAL_ITEMS) {
    rows.set(item.key, {
      key: item.key,
      required: item.required,
      updatedBy: null,
      updatedAt: null,
    });
  }
}

function reset() {
  stytchCalls.length = 0;
  stytchUserId = "user-owner";
  stytchEmails = [];
  stytchShouldThrow = null;
  findManyError = null;
  process.env.APPROVAL_ALLOWLIST = "user-owner:tyler";
  seedRows();
}

function fakeRes() {
  const captured = { status: null, body: undefined, headers: {} };
  return {
    captured,
    statusCode: 200,
    setHeader(name, value) {
      captured.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      captured.status = code;
      this.statusCode = code;
      return this;
    },
    json(body) {
      captured.body = body;
      return this;
    },
  };
}

function getReq() {
  return { method: "GET", url: "/api/approvals", headers: {}, query: {} };
}

function putReq({ key = "linkedin_posts", token = "", body = { required: false }, query } = {}) {
  return {
    method: "PUT",
    url: `/api/approvals?key=${encodeURIComponent(key)}`,
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "content-type": "application/json",
    },
    query: query || { key },
    body,
  };
}

test.beforeEach(reset);

test("GET returns 14 defaults, send_note on three keys, and a 60s cache", async () => {
  const res = fakeRes();
  await handler(getReq(), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.headers["cache-control"], "public, max-age=60");
  assert.deepEqual(Object.keys(res.captured.body), ["default_if_missing", "items"]);
  assert.equal(res.captured.body.default_if_missing, "required");
  assert.equal(res.captured.body.items.length, 14);
  assert.deepEqual(
    res.captured.body.items.map((item) => item.key),
    catalog.APPROVAL_ITEMS.map((item) => item.key),
  );

  const notes = [];
  for (const item of res.captured.body.items) {
    const def = catalog.APPROVAL_ITEMS.find((entry) => entry.key === item.key);
    const fields = ["key", "label", "required", "updated_by", "updated_at"];
    if (def.send_note) fields.push("send_note");
    assert.deepEqual(Object.keys(item), fields);
    assert.equal(item.label, def.label);
    assert.equal(item.required, def.required);
    assert.equal(item.updated_by, null);
    assert.equal(item.updated_at, null);
    if (def.send_note) {
      assert.equal(item.send_note, SEND_NOTE);
      notes.push(item.key);
    } else {
      assert.equal(Object.prototype.hasOwnProperty.call(item, "send_note"), false);
    }
  }
  assert.deepEqual(notes, ["linkedin_messages", "outreach_emails", "family_admin_messages"]);
  assert.equal(stytchCalls.length, 0);
  assert.equal(JSON.stringify(res.captured.body).includes("\u2014"), false);
});

test("GET keeps catalog order when the table comes back shuffled", async () => {
  const stored = [...rows.values()].reverse();
  rows.clear();
  for (const row of stored) rows.set(row.key, row);
  const res = fakeRes();
  await handler(getReq(), res);
  assert.deepEqual(
    res.captured.body.items.map((item) => item.key),
    catalog.APPROVAL_ITEMS.map((item) => item.key),
  );
});

test("GET returns catalog defaults when the table is missing", async () => {
  findManyError = Object.assign(
    new Error('relation "approval_settings" does not exist'),
    { code: "P2021" },
  );
  const res = fakeRes();
  await handler(getReq(), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.headers["cache-control"], "public, max-age=60");
  assert.equal(res.captured.body.default_if_missing, "required");
  assert.equal(res.captured.body.items.length, 14);
  assert.equal(res.captured.body.items[0].key, "linkedin_profile_edits");
  assert.equal(res.captured.body.items[0].required, false);
  assert.equal(res.captured.body.items[0].updated_by, null);
  const posts = res.captured.body.items.find((item) => item.key === "linkedin_posts");
  assert.equal(posts.required, true);
  assert.equal(posts.updated_by, null);
  const notes = res.captured.body.items.filter((item) => item.send_note).map((item) => item.key);
  assert.deepEqual(notes, ["linkedin_messages", "outreach_emails", "family_admin_messages"]);
});

test("GET still fails when the database error is not a missing table", async () => {
  findManyError = Object.assign(new Error("connection reset"), { code: "P1001" });
  const res = fakeRes();
  await handler(getReq(), res);
  assert.equal(res.captured.status, 500);
  assert.equal(res.captured.body.error, "Could not load approvals.");
});

test("GET uses the catalog default when a seeded row is missing", async () => {
  rows.delete("linkedin_profile_edits");
  const res = fakeRes();
  await handler(getReq(), res);
  const item = res.captured.body.items.find((entry) => entry.key === "linkedin_profile_edits");
  assert.equal(item.required, false);
  assert.equal(item.updated_by, null);
});

test("PUT signed out is 401 and does not write", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "" }), res);
  assert.equal(res.captured.status, 401);
  assert.equal(res.captured.headers["cache-control"], "no-store");
  assert.equal(rows.get("linkedin_posts").required, true);
  assert.equal(rows.get("linkedin_posts").updatedBy, null);
});

test("PUT with a rejected session is 401", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "expired-token" }), res);
  assert.equal(res.captured.status, 401);
  assert.equal(rows.get("linkedin_posts").updatedAt, null);
});

test("PUT signed in but not allowlisted is 403", async () => {
  stytchUserId = "user-stranger";
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { required: false } }), res);
  assert.equal(res.captured.status, 403);
  assert.equal(res.captured.body.error, "Not allowed to change approvals.");
  assert.equal(rows.get("linkedin_posts").required, true);
  assert.equal(rows.get("linkedin_posts").updatedBy, null);
});

test("PUT allowlisted persists required, updated_by, and updated_at", async () => {
  const before = Date.now();
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { required: false } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.key, "linkedin_posts");
  assert.equal(res.captured.body.required, false);
  assert.equal(res.captured.body.updated_by, "tyler");
  assert.equal(typeof res.captured.body.updated_at, "string");
  assert.ok(Date.parse(res.captured.body.updated_at) >= before);
  assert.equal(Object.prototype.hasOwnProperty.call(res.captured.body, "send_note"), false);

  const listed = fakeRes();
  await handler(getReq(), listed);
  const item = listed.captured.body.items.find((entry) => entry.key === "linkedin_posts");
  assert.equal(item.required, false);
  assert.equal(item.updated_by, "tyler");
  assert.equal(item.updated_at, res.captured.body.updated_at);

  const others = listed.captured.body.items.filter((entry) => entry.key !== "linkedin_posts");
  assert.ok(others.every((entry) => entry.updated_by === null && entry.updated_at === null));
});

test("PUT matches an allowlisted email and stores that entry's name", async () => {
  process.env.APPROVAL_ALLOWLIST = "tyler@lindowlabs.dev:tyler";
  stytchUserId = "user-phone";
  stytchEmails = ["Tyler@Lindowlabs.dev"];
  const res = fakeRes();
  await handler(putReq({
    token: "good-token",
    key: "family_admin_messages",
    body: { required: false },
  }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.updated_by, "tyler");
  assert.equal(res.captured.body.send_note, SEND_NOTE);
  assert.equal(res.captured.body.required, false);
});

test("PUT unknown key is 404", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "good-token", key: "not_a_real_toggle", body: { required: true } }), res);
  assert.equal(res.captured.status, 404);
  assert.equal(res.captured.body.error, "Unknown approval.");
});

test("PUT bad body is 400 and does not write", async () => {
  for (const body of [{}, { required: "true" }, { required: 1 }, { required: null }]) {
    const res = fakeRes();
    await handler(putReq({ token: "good-token", body }), res);
    assert.equal(res.captured.status, 400, JSON.stringify(body));
  }
  const invalid = fakeRes();
  await handler(putReq({ token: "good-token", body: "{not json" }), invalid);
  assert.equal(invalid.captured.status, 400);
  assert.equal(rows.get("linkedin_posts").required, true);
  assert.equal(rows.get("linkedin_posts").updatedBy, null);
});

test("an empty allowlist rejects a signed-in user", async () => {
  process.env.APPROVAL_ALLOWLIST = "";
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { required: false } }), res);
  assert.equal(res.captured.status, 403);
});

test("migration seeds the same 14 keys and defaults, without labels or the send note", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260925150000_add_approval_settings", "migration.sql"),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "approval_settings"/);
  assert.match(sql, /"updated_by" TEXT/);
  assert.match(sql, /"updated_at" TIMESTAMPTZ/);
  assert.equal(sql.includes(SEND_NOTE), false);
  assert.equal(sql.includes("LinkedIn posts"), false);
  for (const item of catalog.APPROVAL_ITEMS) {
    const literal = item.required ? "true" : "false";
    assert.match(sql, new RegExp(`\\('${item.key}', ${literal}\\)`));
  }
  assert.equal(sql.includes("\u2014"), false);
});

test("the page is a plain list that returns through the existing sign-in", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "approvals", "index.html"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "approvals", "approvals.js"),
    "utf8",
  );
  const auth = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "auth.js"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "sw.js"), "utf8");
  assert.match(html, /On means your approval is needed\./);
  assert.match(html, /src="\/approvals\/approvals\.js"/);
  assert.match(page, /Default, never changed/);
  assert.match(page, /tinker_mcp_return/);
  assert.match(page, /\/approvals/);
  assert.match(page, /method:\s*"PUT"/);
  assert.match(page, /previous\.required/);
  assert.match(page, /item\.send_note/);
  assert.match(auth, /path !== "\/approvals"/);
  assert.match(sw, /pathname === "\/approvals"/);
  assert.match(page, /timeZone:\s*"America\/Los_Angeles"/);
  assert.match(page, / \+ " PT"/);
  assert.equal(page.includes(SEND_NOTE), false);
  assert.equal(page.includes("\u2014"), false);
  assert.equal(html.includes("\u2014"), false);
});

test("changed-by time is Pacific Time and ends with PT", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "approvals", "approvals.js"),
    "utf8",
  );
  const start = page.indexOf("function changedLine");
  const end = page.indexOf("function render");
  assert.ok(start > 0 && end > start);
  const changedLine = new Function(`${page.slice(start, end)}\nreturn changedLine;`)();
  assert.equal(
    changedLine({ updated_by: "tyler", updated_at: "2026-09-25T14:45:00.000Z" }),
    "Changed by tyler on Sep 25, 2026, 7:45 AM PT",
  );
  assert.equal(
    changedLine({ updated_by: "tyler", updated_at: "2026-01-15T18:05:00.000Z" }),
    "Changed by tyler on Jan 15, 2026, 10:05 AM PT",
  );
  assert.equal(changedLine({ updated_by: null, updated_at: null }), "Default, never changed");
});

test("signed-out /approvals comes back to /approvals after sign-in", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "approvals", "approvals.js"),
    "utf8",
  );
  const auth = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "auth.js"), "utf8");
  const map = {};
  const assigns = [];
  const sessionStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null; },
    setItem(key, value) { map[key] = String(value); },
    removeItem(key) { delete map[key]; },
  };
  const window = { location: { assign(url) { assigns.push(String(url)); } } };
  vm.runInNewContext(page, vm.createContext({
    localStorage: {
      getItem() { return ""; },
      setItem() {},
      removeItem() {},
    },
    sessionStorage,
    document: { getElementById() { return {}; } },
    window,
  }));
  assert.deepEqual(assigns, ["/"]);
  assert.equal(map.tinker_mcp_return, "/approvals");

  const start = auth.indexOf("const MCP_RETURN_KEY");
  const call = "if (resumeMcpReturn()) return;";
  const end = auth.indexOf(call) + call.length;
  assert.ok(start > 0 && end > start);
  vm.runInNewContext(`(function () {\n${auth.slice(start, end)}\n})();`, vm.createContext({
    sessionStorage,
    window,
    auth: { token: "signed-in-session" },
  }));
  assert.deepEqual(assigns, ["/", "/approvals"]);
  assert.equal(map.tinker_mcp_return, undefined);

  function readBack(value) {
    map.tinker_mcp_return = value;
    const take = new Function(
      "sessionStorage",
      `${auth.slice(start, auth.indexOf("function resumeMcpReturn()"))}\nreturn takeMcpReturn;`,
    )(sessionStorage);
    return take();
  }
  assert.equal(readBack("/approvals"), "/approvals");
  assert.equal(readBack("//approvals"), "");
  assert.equal(readBack("//evil.example/approvals"), "");
  assert.equal(readBack("https://evil.example/approvals"), "");
  assert.equal(readBack("/approvals\\evil"), "");
  assert.equal(readBack("\\\\approvals"), "");
  assert.equal(readBack("/elsewhere"), "");
  assert.equal(readBack("/approvals/extra"), "");
  assert.equal(readBack("/mcp/authorize?state=abc"), "/mcp/authorize?state=abc");
});
