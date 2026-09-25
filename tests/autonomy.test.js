/* GET /api/autonomy is public. PUT requires a Stytch session on
 * AUTONOMY_ALLOWLIST. Edge Config reads and the Vercel PATCH are stubbed.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");

const SEND_NOTE =
  "Even when this is on, bots only prepare a draft card. You always press Send.";
const WRITE_TOKEN = "edge-write-token-do-not-leak";

const stytchCalls = [];
let stytchUserId = "user-owner";
let stytchEmails = [];
let getAllError = null;
const getAllCalls = [];
const store = new Map();
const patches = [];
let patchStatus = 200;

const stytchStub = {
  authenticateSession: async (token) => {
    stytchCalls.push(token);
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

const edgeStub = {
  getAll: async (keys) => {
    getAllCalls.push(keys);
    if (getAllError) throw getAllError;
    const out = {};
    for (const key of keys) {
      if (store.has(key)) out[key] = store.get(key);
    }
    return out;
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
stubAt(require.resolve("@vercel/edge-config"), edgeStub);

const catalog = require("../api/_lib/autonomy.js");
const edge = require("../api/_lib/autonomy-edge.js");
const handler = require("../api/autonomy.js");
const { seedMissing } = require("../scripts/seed-autonomy-edge-config.js");

function storedValue(key, extra = {}) {
  return {
    autonomous: key === "linkedin_profile_edits",
    note: "",
    updated_by: null,
    updated_at: null,
    ...extra,
  };
}

function seedStore() {
  store.clear();
  for (const item of catalog.AUTONOMY_ITEMS) {
    store.set(edge.edgeKey(item.key), storedValue(item.key));
  }
}

function reset() {
  stytchCalls.length = 0;
  stytchUserId = "user-owner";
  stytchEmails = [];
  getAllError = null;
  getAllCalls.length = 0;
  patches.length = 0;
  patchStatus = 200;
  process.env.AUTONOMY_ALLOWLIST = "user-owner:tyler";
  process.env.EDGE_CONFIG = "https://edge-config.vercel.com/ecfg_test?token=read-token";
  process.env.EDGE_CONFIG_ID = "ecfg_test";
  process.env.VERCEL_TEAM_ID = "team_test";
  process.env.EDGE_CONFIG_WRITE_TOKEN = WRITE_TOKEN;
  delete process.env.VERCEL_ENV;
  seedStore();
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    patches.push({ url: String(url), headers: options.headers, body });
    if (patchStatus !== 200) {
      return {
        ok: false,
        status: patchStatus,
        arrayBuffer: async () => Buffer.from("upstream " + WRITE_TOKEN),
      };
    }
    store.set(body.items[0].key, body.items[0].value);
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(0) };
  };
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

function assertNoToken(value) {
  assert.equal(JSON.stringify(value).includes(WRITE_TOKEN), false);
}

test.beforeEach(reset);

test("GET returns 14 seeded items, only linkedin_profile_edits on, and does not cache", async () => {
  const res = fakeRes();
  await handler(getReq(), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.headers["cache-control"], "no-store");
  assert.deepEqual(Object.keys(res.captured.body), ["default_if_missing", "items"]);
  assert.equal(res.captured.body.default_if_missing, "not_autonomous");
  assert.equal(res.captured.body.items.length, 14);
  assert.deepEqual(getAllCalls[0], catalog.AUTONOMY_ITEMS.map((item) => edge.edgeKey(item.key)));

  const notes = [];
  for (const item of res.captured.body.items) {
    const def = catalog.AUTONOMY_ITEMS.find((entry) => entry.key === item.key);
    const fields = ["key", "label", "autonomous", "note", "updated_by", "updated_at"];
    if (def.send_note) fields.push("send_note");
    assert.deepEqual(Object.keys(item), fields);
    assert.equal(item.label, def.label);
    assert.equal(item.autonomous, item.key === "linkedin_profile_edits");
    assert.equal(Object.prototype.hasOwnProperty.call(def, "autonomous"), false);
    assert.equal(item.note, null);
    if (def.send_note) {
      assert.equal(item.send_note, SEND_NOTE);
      notes.push(item.key);
    }
  }
  assert.equal(res.captured.body.items.filter((item) => item.autonomous).length, 1);
  assert.deepEqual(notes, ["linkedin_messages", "outreach_emails", "family_admin_messages"]);
  assert.equal(stytchCalls.length, 0);
});

test("linkedin_profile_edits is on only when the stored item says so", async () => {
  store.set(edge.edgeKey("linkedin_profile_edits"), storedValue("linkedin_profile_edits", {
    autonomous: false,
  }));
  const res = fakeRes();
  await handler(getReq(), res);
  const item = res.captured.body.items.find((entry) => entry.key === "linkedin_profile_edits");
  assert.equal(item.autonomous, false);
});

test("a missing item is not autonomous", async () => {
  store.delete(edge.edgeKey("linkedin_profile_edits"));
  const res = fakeRes();
  await handler(getReq(), res);
  const item = res.captured.body.items.find((entry) => entry.key === "linkedin_profile_edits");
  assert.equal(item.autonomous, false);
  assert.equal(item.note, null);
  const posts = res.captured.body.items.find((entry) => entry.key === "linkedin_posts");
  assert.equal(posts.autonomous, false);
});

test("EDGE_CONFIG unset gives every item off and does not read", async () => {
  delete process.env.EDGE_CONFIG;
  const res = fakeRes();
  await handler(getReq(), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.headers["cache-control"], "no-store");
  assert.equal(getAllCalls.length, 0);
  assert.ok(res.captured.body.items.every((item) => item.autonomous === false && item.note === null));
  assert.equal(res.captured.body.items[0].key, "linkedin_profile_edits");
});

test("a read error gives every item off", async () => {
  getAllError = new Error("edge config down");
  const res = fakeRes();
  await handler(getReq(), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.headers["cache-control"], "no-store");
  assert.equal(res.captured.body.default_if_missing, "not_autonomous");
  assert.ok(res.captured.body.items.every((item) => item.autonomous === false && item.note === null));
  const notes = res.captured.body.items.filter((item) => item.send_note).map((item) => item.key);
  assert.deepEqual(notes, ["linkedin_messages", "outreach_emails", "family_admin_messages"]);
});

test("a malformed item is off and its neighbors stay as stored", async () => {
  store.set(edge.edgeKey("linkedin_posts"), { autonomous: "yes", note: "<script>" });
  const res = fakeRes();
  await handler(getReq(), res);
  const posts = res.captured.body.items.find((item) => item.key === "linkedin_posts");
  const profile = res.captured.body.items.find((item) => item.key === "linkedin_profile_edits");
  assert.equal(posts.autonomous, false);
  assert.equal(posts.note, null);
  assert.equal(profile.autonomous, true);
});

test("PUT signed out is 401 and does not write", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "" }), res);
  assert.equal(res.captured.status, 401);
  assert.equal(Object.prototype.hasOwnProperty.call(res.captured.body, "your_user_id"), false);
  assert.equal(patches.length, 0);
  assert.equal(store.get(edge.edgeKey("linkedin_posts")).autonomous, false);
});

test("PUT signed in but not allowlisted is 403 and returns that caller's user id", async () => {
  stytchUserId = "user-live-abc";
  stytchEmails = ["tyler@lindowlabs.dev"];
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 403);
  assert.deepEqual(res.captured.body, {
    error: "Not allowed to change autonomy.",
    your_user_id: "user-live-abc",
  });
  assert.equal(JSON.stringify(res.captured.body).includes("tyler@lindowlabs.dev"), false);
  assert.equal(patches.length, 0);
});

test("PUT unknown key is 404", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "good-token", key: "not_a_real_toggle", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 404);
  assert.equal(res.captured.body.error, "Unknown autonomy setting.");
  assert.equal(Object.prototype.hasOwnProperty.call(res.captured.body, "your_user_id"), false);
  assert.equal(patches.length, 0);
  assert.equal(stytchCalls.length, 0);
});

test("PUT sends one upsert for that key and merges a note onto the current toggle", async () => {
  store.set(edge.edgeKey("linkedin_posts"), storedValue("linkedin_posts", {
    autonomous: false,
    note: "",
  }));
  const res = fakeRes();
  await handler(putReq({
    token: "good-token",
    body: { note: "  only after the draft is reviewed  " },
  }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].body.items.length, 1);
  assert.equal(patches[0].body.items[0].operation, "upsert");
  assert.equal(patches[0].body.items[0].key, "autonomy_linkedin_posts");
  assert.equal(patches[0].body.items[0].value.autonomous, false);
  assert.equal(patches[0].body.items[0].value.note, "only after the draft is reviewed");
  assert.equal(patches[0].body.items[0].value.updated_by, "tyler");
  assert.equal(typeof patches[0].body.items[0].value.updated_at, "string");
  assert.equal(patches[0].headers.Authorization, "Bearer " + WRITE_TOKEN);
  assert.equal(
    patches[0].url,
    "https://api.vercel.com/v1/edge-config/ecfg_test/items?teamId=team_test",
  );
  assert.equal(res.captured.body.autonomous, false);
  assert.equal(res.captured.body.note, "only after the draft is reviewed");
  assert.equal(res.captured.body.updated_by, "tyler");
  assert.equal(res.captured.body.updated_at, patches[0].body.items[0].value.updated_at);
  assert.equal(Object.prototype.hasOwnProperty.call(res.captured.body, "your_user_id"), false);
  assertNoToken(res.captured.body);

  const listed = fakeRes();
  await handler(getReq(), listed);
  const item = listed.captured.body.items.find((entry) => entry.key === "linkedin_posts");
  assert.equal(item.note, "only after the draft is reviewed");
  assert.equal(item.autonomous, false);
  const others = [...store.keys()].filter((key) => key !== "autonomy_linkedin_posts");
  assert.ok(others.every((key) => store.get(key).note === ""));
});

test("a toggle-only PUT keeps the saved note", async () => {
  store.set(edge.edgeKey("linkedin_posts"), storedValue("linkedin_posts", { note: "only after X" }));
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(patches[0].body.items[0].value.autonomous, true);
  assert.equal(patches[0].body.items[0].value.note, "only after X");
  assert.equal(res.captured.body.note, "only after X");
  assert.equal(res.captured.body.autonomous, true);
});

test("PUT without a team id omits teamId", async () => {
  delete process.env.VERCEL_TEAM_ID;
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(patches[0].url, "https://api.vercel.com/v1/edge-config/ecfg_test/items");
});

test("the write token is not in the response or the logs when the PATCH fails", async () => {
  patchStatus = 500;
  process.env.VERCEL_ENV = "preview";
  const lines = [];
  const originals = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  for (const key of Object.keys(originals)) {
    console[key] = (...args) => lines.push(args.map(String).join(" "));
  }
  try {
    const res = fakeRes();
    await handler(putReq({ token: "good-token", body: { note: "only after X" } }), res);
    assert.equal(res.captured.status, 503);
    assert.equal(res.captured.body.error, "Autonomy settings are not ready.");
    assertNoToken(res.captured.body);
    assert.equal(lines.join("\n").includes(WRITE_TOKEN), false);
    assert.equal(patches[0].headers.Authorization, "Bearer " + WRITE_TOKEN);
  } finally {
    for (const key of Object.keys(originals)) console[key] = originals[key];
  }
});

test("the preview logger is not called with your_user_id", async () => {
  stytchUserId = "user-live-not-in-logs";
  process.env.VERCEL_ENV = "preview";
  const lines = [];
  const originals = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  for (const key of Object.keys(originals)) {
    console[key] = (...args) => lines.push(args.map(String).join(" "));
  }
  try {
    const res = fakeRes();
    await handler(putReq({ token: "good-token", body: { autonomous: true } }), res);
    assert.equal(res.captured.body.your_user_id, "user-live-not-in-logs");
    assert.ok(lines.some((line) => line.includes("[preview]") && line.includes("403")));
    assert.equal(lines.join("\n").includes("user-live-not-in-logs"), false);
  } finally {
    for (const key of Object.keys(originals)) console[key] = originals[key];
  }
});

test("a 403 account id is shown as text", async () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "autonomy", "autonomy.js"),
    "utf8",
  );
  const hostile = "<img src=x onerror=alert(1)>";
  const nodes = [];
  function makeEl(tag) {
    const node = {
      tag,
      className: "",
      children: [],
      attrs: {},
      value: "only after X",
      disabled: false,
      listeners: {},
      _text: "",
      set textContent(value) { this._text = String(value); },
      get textContent() { return this._text; },
      set innerHTML(_value) { throw new Error("innerHTML used"); },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren() { this.children = []; },
    };
    nodes.push(node);
    return node;
  }
  const list = makeEl("ul");
  const status = makeEl("p");
  let fetches = 0;
  vm.runInNewContext(page, vm.createContext({
    localStorage: { getItem() { return "signed-in"; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      getElementById(id) { return id === "autonomy-list" ? list : status; },
      createElement: makeEl,
    },
    window: { location: { assign() {} } },
    fetch() {
      fetches += 1;
      if (fetches === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json() {
            return Promise.resolve({
              items: [{
                key: "linkedin_posts",
                label: "LinkedIn posts",
                autonomous: false,
                note: "only after X",
                updated_by: null,
                updated_at: null,
              }],
            });
          },
        });
      }
      return Promise.resolve({
        ok: false,
        status: 403,
        json() {
          return Promise.resolve({
            error: "Not allowed to change autonomy.",
            your_user_id: hostile,
          });
        },
      });
    },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  const button = nodes.find((node) => node.attrs.role === "switch");
  button.listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status._text, "You're not on the allowlist. Your account id is " + hostile + ".");
  assert.equal(nodes.some((node) => node.tag === "img" || node.tag === "script"), false);
  const switches = nodes.filter((node) => node.attrs.role === "switch");
  assert.equal(switches[switches.length - 1].attrs["aria-checked"], "false");
});

test("PUT note longer than 500 characters is 400 and does not write", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { note: "a".repeat(501) } }), res);
  assert.equal(res.captured.status, 400);
  assert.equal(patches.length, 0);
});

test("an empty note clears the stored note", async () => {
  store.set(edge.edgeKey("linkedin_posts"), storedValue("linkedin_posts", { note: "tell me first" }));
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { note: "   " } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.note, null);
  assert.equal(patches[0].body.items[0].value.note, "");
});

test("PUT with neither field is 400", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: {} }), res);
  assert.equal(res.captured.status, 400);
  assert.equal(patches.length, 0);
});

test("a missing write token is 503 and does not call PATCH", async () => {
  delete process.env.EDGE_CONFIG_WRITE_TOKEN;
  const res = fakeRes();
  await handler(putReq({ token: "good-token", body: { note: "only after X" } }), res);
  assert.equal(res.captured.status, 503);
  assert.equal(patches.length, 0);
  assertNoToken(res.captured.body);
});

test("send_note stays on the JSON item when it is autonomous", async () => {
  store.set(edge.edgeKey("linkedin_messages"), storedValue("linkedin_messages", { autonomous: true }));
  const res = fakeRes();
  await handler(getReq(), res);
  const item = res.captured.body.items.find((entry) => entry.key === "linkedin_messages");
  assert.equal(item.autonomous, true);
  assert.equal(item.send_note, SEND_NOTE);
});

test("the seed script upserts only missing items and can run twice", async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(0) };
  };
  const current = {};
  for (const item of catalog.AUTONOMY_ITEMS) {
    if (item.key === "linkedin_posts" || item.key === "linkedin_profile_edits") continue;
    current[edge.edgeKey(item.key)] = storedValue(item.key, { note: "keep", updated_by: "tyler" });
  }
  try {
    const written = await seedMissing({ getAll: async () => current });
    assert.deepEqual(written, [
      "autonomy_linkedin_profile_edits",
      "autonomy_linkedin_posts",
    ]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.items.length, 1);
    assert.equal(calls[0].body.items[0].operation, "upsert");
    assert.equal(calls[0].body.items[0].key, "autonomy_linkedin_profile_edits");
    assert.equal(calls[0].body.items[0].value.autonomous, true);
    assert.equal(calls[0].body.items[0].value.note, "");
    assert.equal(calls[0].body.items[0].value.updated_by, null);
    assert.equal(calls[1].body.items.length, 1);
    assert.equal(calls[1].body.items[0].key, "autonomy_linkedin_posts");
    assert.equal(calls[1].body.items[0].value.autonomous, false);
    assert.equal(calls.some((call) => call.body.items[0].key === "autonomy_linkedin_messages"), false);
    assert.equal(JSON.stringify(calls[0].body).includes(WRITE_TOKEN), false);
    assert.equal(JSON.stringify(calls[1].body).includes(WRITE_TOKEN), false);
    assert.equal(calls[0].headers.Authorization, "Bearer " + WRITE_TOKEN);

    const again = await seedMissing({
      getAll: async () => ({
        ...current,
        autonomy_linkedin_profile_edits: calls[0].body.items[0].value,
        autonomy_linkedin_posts: calls[1].body.items[0].value,
      }),
    });
    assert.deepEqual(again, []);
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = original;
  }
});

test("the seed script does not write when the read fails", async () => {
  let called = false;
  const original = global.fetch;
  global.fetch = async () => {
    called = true;
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(0) };
  };
  try {
    await assert.rejects(
      () => seedMissing({ getAll: async () => null }),
      /Could not read Edge Config/,
    );
    assert.equal(called, false);
  } finally {
    global.fetch = original;
  }
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
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.match(html, /On means a bot may do this on its own\./);
  assert.match(html, /A change can take a few seconds to apply everywhere\./);
  assert.match(html, /src="\/autonomy\/autonomy\.js"/);
  assert.match(page, /textContent/);
  assert.equal(page.includes("innerHTML"), false);
  assert.match(auth, /path !== "\/autonomy"/);
  assert.equal(auth.includes("/approvals"), false);
  assert.match(sw, /pathname === "\/autonomy"/);
  assert.match(vercel, /\/api\/autonomy\/:key/);
  assert.equal(schema.includes("AutonomySetting"), false);
  assert.equal(schema.includes("autonomy_settings"), false);
  assert.equal(
    fs.existsSync(path.join(__dirname, "..", "prisma", "migrations", "20260925170000_add_autonomy_settings")),
    false,
  );
  assert.match(page, /timeZone:\s*"America\/Los_Angeles"/);
  assert.match(page, / \+ " PT"/);
  assert.equal(html.includes("\u2014"), false);
});

test("changed-by time is Pacific Time and ends with PT", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "autonomy", "autonomy.js"),
    "utf8",
  );
  const start = page.indexOf("function changedLine");
  const end = page.indexOf("function applySaved");
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
              {
                key: "linkedin_messages",
                label: "LinkedIn messages and follow-ups",
                autonomous: true,
                note: null,
                updated_by: null,
                updated_at: null,
                send_note: SEND_NOTE,
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
  assert.ok(texts.includes(SEND_NOTE));
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
  assert.equal(readBack("//evil.example/autonomy"), "");
  assert.equal(readBack("https://evil.example/autonomy"), "");
  assert.equal(readBack("/autonomy\\evil"), "");
  assert.equal(readBack("/elsewhere"), "");
  assert.equal(readBack("/autonomy/extra"), "");
  assert.equal(readBack("/mcp/authorize?state=abc"), "/mcp/authorize?state=abc");
});
