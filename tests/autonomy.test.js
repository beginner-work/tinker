/* GET /api/autonomy is public. PUT requires a Stytch session on
 * AUTONOMY_ALLOWLIST. Postgres and Stytch are stubbed.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");

const SEND_NOTE =
  "The draft card with its Send button always stays, even when this is on.";

const stytchCalls = [];
let stytchUserId = "user-owner";
let stytchEmails = [];
let stytchShouldThrow = null;
let findManyError = null;
let updateError = null;

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
  autonomySetting: {
    findMany: async () => {
      if (findManyError) throw findManyError;
      return [...rows.values()].map((row) => ({ ...row }));
    },
    update: async ({ where, data }) => {
      if (updateError) throw updateError;
      const row = rows.get(where.key);
      if (!row) {
        const err = new Error("not found");
        err.code = "P2025";
        throw err;
      }
      if (Object.prototype.hasOwnProperty.call(data, "autonomous")) row.autonomous = data.autonomous;
      if (Object.prototype.hasOwnProperty.call(data, "note")) row.note = data.note;
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

const catalog = require("../api/_lib/autonomy.js");
const handler = require("../api/autonomy.js");

function seedRows() {
  rows.clear();
  for (const item of catalog.AUTONOMY_ITEMS) {
    rows.set(item.key, {
      key: item.key,
      autonomous: item.autonomous,
      note: null,
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
  updateError = null;
  process.env.AUTONOMY_ALLOWLIST = "user-owner:tyler";
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
  return { method: "GET", url: "/api/autonomy", headers: {}, query: {} };
}

function putReq({ key = "linkedin_posts", token = "", body = { autonomous: true }, query } = {}) {
  return {
    method: "PUT",
    url: `/api/autonomy?key=${encodeURIComponent(key)}`,
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
  assert.equal(res.captured.body.default_if_missing, "not_autonomous");
  assert.equal(res.captured.body.items.length, 14);
  assert.deepEqual(
    res.captured.body.items.map((item) => item.key),
    catalog.AUTONOMY_ITEMS.map((item) => item.key),
  );

  const notes = [];
  for (const item of res.captured.body.items) {
    const def = catalog.AUTONOMY_ITEMS.find((entry) => entry.key === item.key);
    const fields = ["key", "label", "autonomous", "note", "updated_by", "updated_at"];
    if (def.send_note) fields.push("send_note");
    assert.deepEqual(Object.keys(item), fields);
    assert.equal(item.label, def.label);
    assert.equal(item.autonomous, def.autonomous);
    assert.equal(item.note, null);
    assert.equal(item.updated_by, null);
    assert.equal(item.updated_at, null);
    if (def.send_note) {
      assert.equal(item.send_note, SEND_NOTE);
      notes.push(item.key);
    } else {
      assert.equal(Object.prototype.hasOwnProperty.call(item, "send_note"), false);
    }
  }
  assert.equal(res.captured.body.items[0].key, "linkedin_profile_edits");
  assert.equal(res.captured.body.items[0].autonomous, true);
  assert.equal(
    res.captured.body.items.filter((item) => item.autonomous).length,
    1,
  );
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
    catalog.AUTONOMY_ITEMS.map((item) => item.key),
  );
});

test("GET fails closed to all false when the table is missing or the database errors", async () => {
  for (const err of [
    Object.assign(new Error('relation "autonomy_settings" does not exist'), { code: "P2021" }),
    Object.assign(new Error("connection reset"), { code: "P1001" }),
  ]) {
    findManyError = err;
    const res = fakeRes();
    await handler(getReq(), res);
    assert.equal(res.captured.status, 200);
    assert.equal(res.captured.headers["cache-control"], "public, max-age=60");
    assert.equal(res.captured.body.default_if_missing, "not_autonomous");
    assert.equal(res.captured.body.items.length, 14);
    assert.ok(res.captured.body.items.every((item) => item.autonomous === false && item.note === null));
    assert.equal(res.captured.body.items[0].key, "linkedin_profile_edits");
    assert.equal(res.captured.body.items[0].autonomous, false);
    const notes = res.captured.body.items.filter((item) => item.send_note).map((item) => item.key);
    assert.deepEqual(notes, ["linkedin_messages", "outreach_emails", "family_admin_messages"]);
  }
});

test("GET fails closed when a seeded row is missing, including linkedin_profile_edits", async () => {
  rows.delete("linkedin_profile_edits");
  const res = fakeRes();
  await handler(getReq(), res);
  const item = res.captured.body.items.find((entry) => entry.key === "linkedin_profile_edits");
  assert.equal(item.autonomous, false);
  assert.equal(item.note, null);
  assert.equal(item.updated_by, null);
});

test("PUT signed out is 401 and does not write", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "" }), res);
  assert.equal(res.captured.status, 401);
  assert.equal(res.captured.headers["cache-control"], "no-store");
  assert.equal(rows.get("linkedin_posts").autonomous, false);
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
  await handler(putReq({ token: "good-token", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 403);
  assert.equal(res.captured.body.error, "Not allowed to change autonomy.");
  assert.equal(rows.get("linkedin_posts").autonomous, false);
  assert.equal(rows.get("linkedin_posts").updatedBy, null);
});

test("PUT allowlisted persists autonomous, updated_by, and updated_at", async () => {
  const before = Date.now();
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.key, "linkedin_posts");
  assert.equal(res.captured.body.autonomous, true);
  assert.equal(res.captured.body.note, null);
  assert.equal(res.captured.body.updated_by, "tyler");
  assert.equal(typeof res.captured.body.updated_at, "string");
  assert.ok(Date.parse(res.captured.body.updated_at) >= before);
  assert.equal(Object.prototype.hasOwnProperty.call(res.captured.body, "send_note"), false);

  const listed = fakeRes();
  await handler(getReq(), listed);
  const item = listed.captured.body.items.find((entry) => entry.key === "linkedin_posts");
  assert.equal(item.autonomous, true);
  assert.equal(item.updated_by, "tyler");
  assert.equal(item.updated_at, res.captured.body.updated_at);

  const others = listed.captured.body.items.filter((entry) => entry.key !== "linkedin_posts");
  assert.ok(others.every((entry) => entry.updated_by === null && entry.updated_at === null));
});

test("PUT saves a trimmed note and GET reads it back", async () => {
  const res = fakeRes();
  await handler(putReq({
    token: "good-token",
    body: { note: "  only after the draft is reviewed  " },
  }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.note, "only after the draft is reviewed");
  assert.equal(res.captured.body.autonomous, false);
  assert.equal(res.captured.body.updated_by, "tyler");

  const listed = fakeRes();
  await handler(getReq(), listed);
  const item = listed.captured.body.items.find((entry) => entry.key === "linkedin_posts");
  assert.equal(item.note, "only after the draft is reviewed");
  assert.equal(item.updated_by, "tyler");
  assert.equal(item.updated_at, res.captured.body.updated_at);
});

test("PUT empty note clears it", async () => {
  rows.get("linkedin_posts").note = "tell me first";
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { note: "   " } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.note, null);
  assert.equal(rows.get("linkedin_posts").note, null);
});

test("PUT note longer than 500 characters is 400 and does not write", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { note: "a".repeat(501) } }), res);
  assert.equal(res.captured.status, 400);
  assert.equal(res.captured.body.error, "Note must be 500 characters or fewer.");
  assert.equal(rows.get("linkedin_posts").note, null);
  assert.equal(rows.get("linkedin_posts").updatedBy, null);
});

test("PUT note of 500 characters is saved", async () => {
  const note = "b".repeat(500);
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { note } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.note, note);
});

test("flipping autonomous keeps the saved note", async () => {
  rows.get("linkedin_posts").note = "only after X";
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.autonomous, true);
  assert.equal(res.captured.body.note, "only after X");
});

test("PUT matches an allowlisted email and stores that entry's name", async () => {
  process.env.AUTONOMY_ALLOWLIST = "tyler@lindowlabs.dev:tyler";
  stytchUserId = "user-phone";
  stytchEmails = ["Tyler@Lindowlabs.dev"];
  const res = fakeRes();
  await handler(putReq({
    token: "good-token",
    key: "family_admin_messages",
    body: { autonomous: true },
  }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.updated_by, "tyler");
  assert.equal(res.captured.body.send_note, SEND_NOTE);
  assert.equal(res.captured.body.autonomous, true);
});

test("PUT unknown key is 404", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "good-token", key: "not_a_real_toggle", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 404);
  assert.equal(res.captured.body.error, "Unknown autonomy setting.");
});

test("PUT with neither autonomous nor note is 400 and does not write", async () => {
  for (const body of [{}, { autonomous: "true" }, { autonomous: 1 }, { autonomous: null }, { note: 12 }]) {
    const res = fakeRes();
    await handler(putReq({ token: "good-token", body }), res);
    assert.equal(res.captured.status, 400, JSON.stringify(body));
  }
  const invalid = fakeRes();
  await handler(putReq({ token: "good-token", body: "{not json" }), invalid);
  assert.equal(invalid.captured.status, 400);
  assert.equal(rows.get("linkedin_posts").autonomous, false);
  assert.equal(rows.get("linkedin_posts").updatedBy, null);
});

test("PUT with a missing table is 503", async () => {
  updateError = Object.assign(
    new Error('relation "autonomy_settings" does not exist'),
    { code: "P2021" },
  );
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { note: "only after X" } }), res);
  assert.equal(res.captured.status, 503);
  assert.equal(res.captured.body.error, "Autonomy settings are not ready.");
});

test("an empty allowlist rejects a signed-in user", async () => {
  process.env.AUTONOMY_ALLOWLIST = "";
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 403);
});

test("migration seeds the same 14 keys and defaults, without labels or the send note", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260925170000_add_autonomy_settings", "migration.sql"),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "autonomy_settings"/);
  assert.match(sql, /"autonomous" BOOLEAN NOT NULL/);
  assert.match(sql, /"note" TEXT/);
  assert.match(sql, /"updated_by" TEXT/);
  assert.match(sql, /"updated_at" TIMESTAMPTZ/);
  assert.equal(sql.includes(SEND_NOTE), false);
  assert.equal(sql.includes("LinkedIn posts"), false);
  assert.equal(sql.includes("required"), false);
  for (const item of catalog.AUTONOMY_ITEMS) {
    const literal = item.autonomous ? "true" : "false";
    assert.match(sql, new RegExp(`\\('${item.key}', ${literal}\\)`));
  }
  assert.equal(sql.includes("\u2014"), false);
  assert.equal(
    fs.existsSync(path.join(__dirname, "..", "prisma", "migrations", "20260925150000_add_approval_settings")),
    false,
  );
});

test("the page is a plain list that returns through the existing sign-in", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "autonomy", "index.html"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "autonomy", "autonomy.js"),
    "utf8",
  );
  const auth = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "auth.js"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "sw.js"), "utf8");
  const vercel = fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8");
  assert.match(html, /On means a bot may do this on its own\./);
  assert.match(html, /src="\/autonomy\/autonomy\.js"/);
  assert.match(page, /Default, never changed/);
  assert.match(page, /tinker_mcp_return/);
  assert.match(page, /\/autonomy/);
  assert.match(page, /method:\s*"PUT"/);
  assert.match(page, /previous\.autonomous/);
  assert.match(page, /item\.send_note/);
  assert.match(page, /textContent/);
  assert.equal(page.includes("innerHTML"), false);
  assert.equal(html.includes("innerHTML"), false);
  assert.match(auth, /path !== "\/autonomy"/);
  assert.equal(auth.includes("/approvals"), false);
  assert.match(sw, /pathname === "\/autonomy"/);
  assert.match(vercel, /\/api\/autonomy\/:key/);
  assert.match(vercel, /\/autonomy/);
  assert.equal(vercel.includes("/approvals"), false);
  assert.match(page, /timeZone:\s*"America\/Los_Angeles"/);
  assert.match(page, / \+ " PT"/);
  assert.equal(page.includes(SEND_NOTE), false);
  assert.equal(page.includes("\u2014"), false);
  assert.equal(html.includes("\u2014"), false);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "api", "approvals.js")), false);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "src", "renderer", "approvals")), false);
});

test("changed-by time is Pacific Time and ends with PT", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "autonomy", "autonomy.js"),
    "utf8",
  );
  const start = page.indexOf("function changedLine");
  const end = page.indexOf("function applySaved");
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

test("a note renders as text and never as HTML", async () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "autonomy", "autonomy.js"),
    "utf8",
  );
  const hostile = "<script>alert(1)</script>";
  const hostileSaved = "<img src=x onerror=alert(1)>";
  const nodes = [];

  function makeEl(tag) {
    const node = {
      tag,
      className: "",
      children: [],
      attrs: {},
      value: "",
      _text: "",
      set textContent(value) { this._text = String(value); },
      get textContent() { return this._text; },
      set innerHTML(_value) { throw new Error("innerHTML used"); },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      addEventListener() {},
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren() { this.children = []; },
    };
    nodes.push(node);
    return node;
  }

  const list = makeEl("ul");
  const status = makeEl("p");
  vm.runInNewContext(page, vm.createContext({
    localStorage: { getItem() { return "signed-in"; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      getElementById(id) { return id === "autonomy-list" ? list : status; },
      createElement: makeEl,
    },
    window: { location: { assign() {} } },
    fetch() {
      return Promise.resolve({
        ok: true,
        status: 200,
        json() {
          return Promise.resolve({
            items: [
              {
                key: "linkedin_posts",
                label: "LinkedIn posts",
                autonomous: false,
                note: hostile,
                updated_by: null,
                updated_at: null,
              },
              {
                key: "linkedin_profile_edits",
                label: "LinkedIn profile edits",
                autonomous: true,
                note: hostileSaved,
                updated_by: "tyler",
                updated_at: "2026-09-25T14:45:00.000Z",
              },
            ],
          });
        },
      });
    },
  }));

  await new Promise((resolve) => setImmediate(resolve));
  const texts = nodes.map((node) => node._text);
  const values = nodes.map((node) => node.value);
  assert.ok(values.includes(hostile));
  assert.ok(texts.includes(hostileSaved));
  assert.equal(nodes.some((node) => node.tag === "script" || node.tag === "img"), false);
});

test("signed-out /autonomy comes back to /autonomy after sign-in", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "autonomy", "autonomy.js"),
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
  assert.equal(map.tinker_mcp_return, "/autonomy");

  const start = auth.indexOf("const MCP_RETURN_KEY");
  const call = "if (resumeMcpReturn()) return;";
  const end = auth.indexOf(call) + call.length;
  assert.ok(start > 0 && end > start);
  vm.runInNewContext(`(function () {\n${auth.slice(start, end)}\n})();`, vm.createContext({
    sessionStorage,
    window,
    auth: { token: "signed-in-session" },
  }));
  assert.deepEqual(assigns, ["/", "/autonomy"]);
  assert.equal(map.tinker_mcp_return, undefined);

  function readBack(value) {
    map.tinker_mcp_return = value;
    const take = new Function(
      "sessionStorage",
      `${auth.slice(start, auth.indexOf("function resumeMcpReturn()"))}\nreturn takeMcpReturn;`,
    )(sessionStorage);
    return take();
  }
  assert.equal(readBack("/autonomy"), "/autonomy");
  assert.equal(readBack("/approvals"), "");
  assert.equal(readBack("//autonomy"), "");
  assert.equal(readBack("//evil.example/autonomy"), "");
  assert.equal(readBack("https://evil.example/autonomy"), "");
  assert.equal(readBack("/autonomy\\evil"), "");
  assert.equal(readBack("\\\\autonomy"), "");
  assert.equal(readBack("/elsewhere"), "");
  assert.equal(readBack("/autonomy/extra"), "");
  assert.equal(readBack("/mcp/authorize?state=abc"), "/mcp/authorize?state=abc");
});
