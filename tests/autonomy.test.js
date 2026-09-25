/* GET and PUT /api/autonomy require the caller's Stytch session.
 * Settings live in that user's Upstash Redis hash. Reads and writes
 * are stubbed at fetch.
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
const UNAVAILABLE = "Autonomy settings are unavailable right now.";
const REST_URL = "https://secret-kv.upstash.io";
const WRITE_TOKEN = "kv-write-token-do-not-leak";
const READ_TOKEN = "kv-read-token-do-not-leak";
const UPSTASH_URL = "https://secret-upstash.upstash.io";
const UPSTASH_TOKEN = "upstash-token-do-not-leak";
const DECOY_TCP = "redis://decoy-tcp.internal";
const DECOY_REDIS = "rediss://decoy-redis.internal";

const USERS = {
  "token-a": {
    userId: "user-a",
    emails: ["a@example.com"],
    first: "",
    last: "",
  },
  "token-b": {
    userId: "user-b",
    emails: [],
    first: "Bea",
    last: "User",
  },
  "token-id": {
    userId: "user-id-only",
    emails: [],
    first: "",
    last: "",
  },
  "token-long": {
    userId: "user-long",
    emails: ["a".repeat(90) + "@example.com"],
    first: "",
    last: "",
  },
};

const stytchCalls = [];
const commands = [];
const hashes = new Map();
let fetchError = null;
let fetchStatus = 200;
let upstashError = null;
let hgetallAsObject = false;
const logs = [];
let originalError;
let originalLog;

const stytchStub = {
  authenticateSession: async (token) => {
    stytchCalls.push(token);
    const user = USERS[token];
    if (!user) throw Object.assign(new Error("Session expired."), { status: 401 });
    return {
      session: { user_id: user.userId },
      user: {
        user_id: user.userId,
        emails: user.emails.map((email) => ({ email })),
        name: { first_name: user.first, last_name: user.last },
      },
    };
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

const catalog = require("../api/_lib/autonomy.js");
const redis = require("../api/_lib/autonomy-redis.js");
const handler = require("../api/autonomy.js");

function fieldJson(extra = {}) {
  return JSON.stringify({
    autonomous: false,
    note: "",
    updated_by: null,
    updated_at: null,
    ...extra,
  });
}

function seedUser(userId, fields) {
  const hash = new Map();
  for (const [key, value] of Object.entries(fields)) hash.set(key, value);
  hashes.set(redis.hashKey(userId), hash);
}

function redisReply(args) {
  const [cmd, key, field, value] = args;
  if (cmd === "HGETALL") {
    const hash = hashes.get(key);
    if (!hash || hash.size === 0) return hgetallAsObject ? {} : [];
    if (hgetallAsObject) return Object.fromEntries(hash);
    const flat = [];
    for (const [name, raw] of hash) {
      flat.push(name, raw);
    }
    return flat;
  }
  if (cmd === "HGET") {
    const hash = hashes.get(key);
    if (!hash || !hash.has(field)) return null;
    return hash.get(field);
  }
  if (cmd === "HSET") {
    let hash = hashes.get(key);
    if (!hash) {
      hash = new Map();
      hashes.set(key, hash);
    }
    hash.set(field, value);
    return 1;
  }
  return null;
}

function reset() {
  stytchCalls.length = 0;
  commands.length = 0;
  hashes.clear();
  fetchError = null;
  fetchStatus = 200;
  upstashError = null;
  hgetallAsObject = false;
  logs.length = 0;
  process.env.KV_REST_API_URL = REST_URL;
  process.env.KV_REST_API_TOKEN = WRITE_TOKEN;
  process.env.KV_REST_API_READ_ONLY_TOKEN = READ_TOKEN;
  process.env.KV_URL = DECOY_TCP;
  process.env.REDIS_URL = DECOY_REDIS;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.EDGE_CONFIG;
  delete process.env.EDGE_CONFIG_ID;
  delete process.env.EDGE_CONFIG_WRITE_TOKEN;
  delete process.env.AUTONOMY_ALLOWLIST;
  delete process.env.VERCEL_ENV;
  if (!originalError) originalError = console.error;
  if (!originalLog) originalLog = console.log;
  console.error = (...args) => {
    logs.push(args.map(String).join(" "));
  };
  console.log = (...args) => {
    logs.push(args.map(String).join(" "));
  };
  global.fetch = async (url, options) => {
    const args = JSON.parse(options.body);
    commands.push({
      url: String(url),
      authorization: options.headers && options.headers.Authorization,
      args,
      signal: options.signal,
    });
    if (fetchError) throw fetchError;
    if (fetchStatus !== 200) {
      return {
        ok: false,
        status: fetchStatus,
        json: async () => ({ error: "upstream " + WRITE_TOKEN + " " + READ_TOKEN + " " + REST_URL }),
      };
    }
    if (upstashError) {
      return { ok: true, status: 200, json: async () => ({ error: upstashError }) };
    }
    return { ok: true, status: 200, json: async () => ({ result: redisReply(args) }) };
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

function getReq(token = "token-a") {
  return {
    method: "GET",
    url: "/api/autonomy",
    headers: { authorization: token ? `Bearer ${token}` : "" },
    query: {},
  };
}

function putReq({
  key = "linkedin_posts",
  token = "token-a",
  body = { autonomous: true },
  query,
} = {}) {
  return {
    method: "PUT",
    url: `/api/autonomy?key=${encodeURIComponent(key)}&user_id=user-b`,
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "content-type": "application/json",
    },
    query: query || { key, user_id: "user-b" },
    body,
  };
}

const SECRETS = [REST_URL, WRITE_TOKEN, READ_TOKEN, UPSTASH_URL, UPSTASH_TOKEN, DECOY_TCP, DECOY_REDIS];

function assertNoSecret(value) {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) assert.equal(text.includes(secret), false);
}

function assertLogsClean() {
  const text = logs.join("\n");
  for (const secret of SECRETS) assert.equal(text.includes(secret), false);
}

function assertClient(userId, token) {
  for (const call of commands) {
    assert.equal(call.args[1], redis.hashKey(userId));
    assert.equal(call.url, REST_URL);
    assert.equal(call.authorization, "Bearer " + token);
    assert.equal(call.url === DECOY_TCP || call.url === DECOY_REDIS, false);
  }
}

function assertAllOff(body) {
  assert.equal(body.default_if_missing, "not_autonomous");
  assert.equal(body.items.length, 14);
  const notes = [];
  for (const item of body.items) {
    const def = catalog.AUTONOMY_ITEMS.find((entry) => entry.key === item.key);
    const fields = ["key", "label", "autonomous", "note", "updated_by", "updated_at"];
    if (def.send_note) fields.push("send_note");
    assert.deepEqual(Object.keys(item), fields);
    assert.equal(item.label, def.label);
    assert.equal(item.autonomous, false);
    assert.equal(item.note, null);
    assert.equal(Object.prototype.hasOwnProperty.call(def, "autonomous"), false);
    if (def.send_note) {
      assert.equal(item.send_note, SEND_NOTE);
      notes.push(item.key);
    }
  }
  assert.deepEqual(notes, ["linkedin_messages", "outreach_emails", "family_admin_messages"]);
}

test.beforeEach(reset);
test.after(() => {
  if (originalError) console.error = originalError;
  if (originalLog) console.log = originalLog;
});

test("a new user reads every item off, including linkedin_profile_edits", async () => {
  const res = fakeRes();
  await handler(getReq(), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.headers["cache-control"], "no-store");
  assertAllOff(res.captured.body);
  assert.deepEqual(commands.map((call) => call.args), [["HGETALL", "autonomy:user-a"]]);
  assert.equal(commands[0].authorization, "Bearer " + READ_TOKEN);
  assert.equal(commands[0].signal instanceof AbortSignal, true);
  assert.equal(stytchCalls.length, 1);
});

test("user A cannot read or write user B's settings", async () => {
  seedUser("user-b", {
    linkedin_profile_edits: fieldJson({
      autonomous: true,
      note: "secret-from-b",
      updated_by: "b@example.com",
      updated_at: "2026-09-25T14:45:00.000Z",
    }),
    linkedin_posts: fieldJson({ autonomous: true, note: "also-secret" }),
  });
  seedUser("user-a", {
    linkedin_posts: fieldJson({ note: "mine", autonomous: false }),
  });

  const listed = fakeRes();
  await handler(getReq("token-a"), listed);
  assert.equal(listed.captured.status, 200);
  assertAllOff({
    ...listed.captured.body,
    items: listed.captured.body.items.map((item) =>
      item.key === "linkedin_posts" ? { ...item, note: null, autonomous: false } : item,
    ),
  });
  const posts = listed.captured.body.items.find((item) => item.key === "linkedin_posts");
  assert.equal(posts.autonomous, false);
  assert.equal(posts.note, "mine");
  const profile = listed.captured.body.items.find((item) => item.key === "linkedin_profile_edits");
  assert.equal(profile.autonomous, false);
  assert.equal(profile.note, null);
  assert.equal(JSON.stringify(listed.captured.body).includes("secret-from-b"), false);
  assertClient("user-a", READ_TOKEN);

  commands.length = 0;
  const written = fakeRes();
  await handler(putReq({
    token: "token-a",
    body: { autonomous: true, user_id: "user-b", note: "from-a" },
  }), written);
  assert.equal(written.captured.status, 200);
  assert.equal(written.captured.body.autonomous, true);
  assert.equal(written.captured.body.note, "from-a");
  assert.equal(written.captured.body.updated_by, "a@example.com");
  assert.deepEqual(commands.map((call) => call.args.slice(0, 3)), [
    ["HGET", "autonomy:user-a", "linkedin_posts"],
    ["HSET", "autonomy:user-a", "linkedin_posts"],
  ]);
  assert.equal(commands[1].args.length, 4);
  assertClient("user-a", WRITE_TOKEN);
  const stored = JSON.parse(commands[1].args[3]);
  assert.equal(stored.autonomous, true);
  assert.equal(stored.note, "from-a");
  assert.equal(stored.updated_by, "a@example.com");
  assert.equal(hashes.get("autonomy:user-b").get("linkedin_profile_edits").includes("secret-from-b"), true);
  assert.equal(hashes.get("autonomy:user-b").get("linkedin_posts").includes("also-secret"), true);
  assert.equal(JSON.stringify(written.captured.body).includes("user-b"), false);

  commands.length = 0;
  const other = fakeRes();
  await handler(getReq("token-b"), other);
  const otherProfile = other.captured.body.items.find((item) => item.key === "linkedin_profile_edits");
  assert.equal(otherProfile.autonomous, true);
  assert.equal(otherProfile.note, "secret-from-b");
  const otherPosts = other.captured.body.items.find((item) => item.key === "linkedin_posts");
  assert.equal(otherPosts.note, "also-secret");
  assert.equal(JSON.stringify(other.captured.body).includes("from-a"), false);
  assertClient("user-b", READ_TOKEN);
});

test("signed-out GET and PUT return 401 and do not touch Redis", async () => {
  seedUser("user-a", { linkedin_posts: fieldJson({ autonomous: true, note: "keep" }) });
  const getRes = fakeRes();
  await handler(getReq(""), getRes);
  assert.equal(getRes.captured.status, 401);
  assert.equal(getRes.captured.body.error, "Sign in to tinker first.");
  assert.equal(getRes.captured.headers["cache-control"], "no-store");

  const putRes = fakeRes();
  await handler(putReq({ token: "", key: "not-a-real-key" }), putRes);
  assert.equal(putRes.captured.status, 401);
  assert.equal(putRes.captured.body.error, "Sign in to tinker first.");
  assert.equal(commands.length, 0);
  assert.equal(stytchCalls.length, 0);
  assert.equal(hashes.get("autonomy:user-a").get("linkedin_posts").includes("keep"), true);
});

test("a rejected session is 401 and does not touch Redis", async () => {
  const res = fakeRes();
  await handler(putReq({ token: "expired" }), res);
  assert.equal(res.captured.status, 401);
  assert.equal(res.captured.body.error, "Session expired.");
  assert.equal(commands.length, 0);
});

test("a store outage makes GET read all off and PUT return 503", async () => {
  process.env.VERCEL_ENV = "preview";
  seedUser("user-a", {
    linkedin_posts: fieldJson({ autonomous: true, note: "keep" }),
  });
  fetchError = Object.assign(
    new Error("aborted " + REST_URL + " " + WRITE_TOKEN + " " + READ_TOKEN),
    { name: "AbortError" },
  );

  const listed = fakeRes();
  await handler(getReq(), listed);
  assert.equal(listed.captured.status, 200);
  assert.equal(listed.captured.headers["cache-control"], "no-store");
  assertAllOff(listed.captured.body);
  assertNoSecret(listed.captured.body);
  assertLogsClean();
  assert.match(logs.join("\n"), /\[preview\] GET \/api\/autonomy 200/);
  assert.equal(commands[0].authorization, "Bearer " + READ_TOKEN);
  assert.equal(commands.some((call) => call.args[0] === "HSET"), false);

  logs.length = 0;
  commands.length = 0;
  const written = fakeRes();
  await handler(putReq({ body: { autonomous: false } }), written);
  assert.equal(written.captured.status, 503);
  assert.deepEqual(written.captured.body, { error: UNAVAILABLE });
  assertNoSecret(written.captured.body);
  assertLogsClean();
  assert.match(logs.join("\n"), /\[preview\] PUT .* 503/);
  assert.equal(commands[0].authorization, "Bearer " + WRITE_TOKEN);
  assert.equal(commands.some((call) => call.args[0] === "HSET"), false);
  assert.equal(hashes.get("autonomy:user-a").get("linkedin_posts").includes('"keep"'), true);

  fetchError = null;
  fetchStatus = 500;
  logs.length = 0;
  commands.length = 0;
  const again = fakeRes();
  await handler(putReq({ body: { note: "nope" } }), again);
  assert.equal(again.captured.status, 503);
  assert.deepEqual(again.captured.body, { error: UNAVAILABLE });
  assertNoSecret(again.captured.body);
  assertLogsClean();
  assert.equal(commands.some((call) => call.args[0] === "HSET"), false);
});

test("an unconfigured store fails closed and does not call fetch", async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_READ_ONLY_TOKEN;
  const listed = fakeRes();
  await handler(getReq(), listed);
  assert.equal(listed.captured.status, 200);
  assertAllOff(listed.captured.body);
  const written = fakeRes();
  await handler(putReq(), written);
  assert.equal(written.captured.status, 503);
  assert.deepEqual(written.captured.body, { error: UNAVAILABLE });
  assert.equal(commands.length, 0);
});

test("a missing read-only token fails GET closed and does not use the write token", async () => {
  delete process.env.KV_REST_API_READ_ONLY_TOKEN;
  seedUser("user-a", {
    linkedin_profile_edits: fieldJson({ autonomous: true, note: "hidden" }),
  });
  const listed = fakeRes();
  await handler(getReq(), listed);
  assert.equal(listed.captured.status, 200);
  assertAllOff(listed.captured.body);
  assert.equal(commands.length, 0);
  assertNoSecret(listed.captured.body);

  const written = fakeRes();
  await handler(putReq({ body: { autonomous: true } }), written);
  assert.equal(written.captured.status, 200);
  assertClient("user-a", WRITE_TOKEN);
  assert.equal(commands.some((call) => call.authorization.includes(READ_TOKEN)), false);
});

test("a PUT is one HSET on the caller's field and keeps the other half", async () => {
  seedUser("user-a", {
    linkedin_posts: fieldJson({
      autonomous: false,
      note: "tell me first",
      updated_by: "a@example.com",
      updated_at: "2026-09-01T00:00:00.000Z",
    }),
    linkedin_messages: fieldJson({ autonomous: true, note: "leave-this" }),
  });

  const toggled = fakeRes();
  await handler(putReq({ body: { autonomous: true } }), toggled);
  assert.equal(toggled.captured.status, 200);
  assert.equal(toggled.captured.body.autonomous, true);
  assert.equal(toggled.captured.body.note, "tell me first");
  assert.equal(toggled.captured.headers["cache-control"], "no-store");
  assert.deepEqual(commands.map((call) => [call.args[0], call.args[1], call.args[2]]), [
    ["HGET", "autonomy:user-a", "linkedin_posts"],
    ["HSET", "autonomy:user-a", "linkedin_posts"],
  ]);
  assert.equal(commands[1].args.length, 4);
  assertClient("user-a", WRITE_TOKEN);
  assert.equal(JSON.parse(commands[1].args[3]).note, "tell me first");
  assert.equal(hashes.get("autonomy:user-a").get("linkedin_messages").includes("leave-this"), true);

  commands.length = 0;
  const noted = fakeRes();
  await handler(putReq({ body: { note: "  only after X  " } }), noted);
  assert.equal(noted.captured.status, 200);
  assert.equal(noted.captured.body.note, "only after X");
  assert.equal(noted.captured.body.autonomous, true);
  assert.equal(JSON.parse(commands[1].args[3]).autonomous, true);
  assert.equal(JSON.parse(commands[1].args[3]).note, "only after X");
});

test("an empty note clears the stored note", async () => {
  seedUser("user-a", { linkedin_posts: fieldJson({ note: "tell me first", autonomous: true }) });
  const res = fakeRes();
  await handler(putReq({ body: { note: "   " } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.note, null);
  assert.equal(res.captured.body.autonomous, true);
  assert.equal(JSON.parse(commands[1].args[3]).note, "");
});

test("a bad stored value reads as off and a note-only save rewrites it", async () => {
  seedUser("user-a", {
    linkedin_profile_edits: "not-json",
    linkedin_posts: JSON.stringify({ autonomous: "yes", note: 1 }),
  });
  const listed = fakeRes();
  await handler(getReq(), listed);
  assertAllOff(listed.captured.body);

  const res = fakeRes();
  await handler(putReq({ body: { note: "start clean" } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.autonomous, false);
  assert.equal(res.captured.body.note, "start clean");
  assert.equal(JSON.parse(hashes.get("autonomy:user-a").get("linkedin_posts")).autonomous, false);
});

test("HGETALL as an object still returns only the caller's fields", async () => {
  hgetallAsObject = true;
  seedUser("user-a", {
    linkedin_posts: fieldJson({ autonomous: true, note: "object-shape" }),
    extra_field: fieldJson({ autonomous: true, note: "ignore" }),
  });
  const res = fakeRes();
  await handler(getReq(), res);
  const posts = res.captured.body.items.find((item) => item.key === "linkedin_posts");
  assert.equal(posts.autonomous, true);
  assert.equal(posts.note, "object-shape");
  assert.equal(res.captured.body.items.some((item) => item.key === "extra_field"), false);
  assert.equal(res.captured.body.items.filter((item) => item.autonomous).length, 1);
});

test("an unknown key is 404 for a signed-in caller and does not write", async () => {
  const res = fakeRes();
  await handler(putReq({ key: "not-a-real-key", body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 404);
  assert.equal(res.captured.body.error, "Unknown autonomy setting.");
  assert.equal(commands.length, 0);
});

test("a note longer than 500 characters is 400 and does not write", async () => {
  seedUser("user-a", { linkedin_posts: fieldJson({ note: "keep" }) });
  const res = fakeRes();
  await handler(putReq({ body: { note: "a".repeat(501) } }), res);
  assert.equal(res.captured.status, 400);
  assert.equal(res.captured.body.error, "Note must be 500 characters or fewer.");
  assert.equal(commands.length, 0);
  assert.equal(hashes.get("autonomy:user-a").get("linkedin_posts").includes("keep"), true);

  const ok = fakeRes();
  await handler(putReq({ body: { note: "b".repeat(500) } }), ok);
  assert.equal(ok.captured.status, 200);
  assert.equal(ok.captured.body.note.length, 500);
});

test("PUT with neither field is 400", async () => {
  const res = fakeRes();
  await handler(putReq({ body: {} }), res);
  assert.equal(res.captured.status, 400);
  assert.equal(commands.length, 0);
});

test("updated_by comes from the session and is capped at 80 characters", async () => {
  const named = fakeRes();
  await handler(putReq({ token: "token-b", body: { autonomous: true } }), named);
  assert.equal(named.captured.body.updated_by, "Bea User");
  assert.equal(commands[1].args[1], "autonomy:user-b");

  commands.length = 0;
  const idOnly = fakeRes();
  await handler(putReq({ token: "token-id", body: { autonomous: false } }), idOnly);
  assert.equal(idOnly.captured.body.updated_by, "user-id-only");

  commands.length = 0;
  const long = fakeRes();
  await handler(putReq({ token: "token-long", body: { note: "hi" } }), long);
  assert.equal(long.captured.body.updated_by.length, 80);
});

test("Redis commands use a two second timeout and split read and write clients", async () => {
  assert.equal(redis.TIMEOUT_MS, 2000);
  process.env.UPSTASH_REDIS_REST_URL = UPSTASH_URL;
  process.env.UPSTASH_REDIS_REST_TOKEN = UPSTASH_TOKEN;
  const preferred = fakeRes();
  await handler(getReq(), preferred);
  assert.equal(commands[0].url, REST_URL);
  assert.equal(commands[0].authorization, "Bearer " + READ_TOKEN);

  commands.length = 0;
  const saved = fakeRes();
  await handler(putReq({ body: { note: "write-pair" } }), saved);
  assert.equal(saved.captured.status, 200);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].args[0], "HGET");
  assert.equal(commands[1].args[0], "HSET");
  assert.equal(commands[0].authorization, "Bearer " + WRITE_TOKEN);
  assert.equal(commands[1].authorization, "Bearer " + WRITE_TOKEN);
  assert.equal(commands[0].url, REST_URL);

  delete process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_READ_ONLY_TOKEN;
  commands.length = 0;
  const closed = fakeRes();
  await handler(getReq(), closed);
  assert.equal(closed.captured.status, 200);
  assertAllOff(closed.captured.body);
  assert.equal(commands.length, 0);
  assertNoSecret(closed.captured.body);
});

test("PUT with only the UPSTASH vars set returns 503 and saves nothing", async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_READ_ONLY_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = UPSTASH_URL;
  process.env.UPSTASH_REDIS_REST_TOKEN = UPSTASH_TOKEN;
  seedUser("user-a", { linkedin_posts: fieldJson({ autonomous: false, note: "keep" }) });
  const res = fakeRes();
  await handler(putReq({ body: { autonomous: true } }), res);
  assert.equal(res.captured.status, 503);
  assert.deepEqual(res.captured.body, { error: UNAVAILABLE });
  assert.equal(commands.length, 0);
  assertNoSecret(res.captured.body);
  assert.equal(hashes.get("autonomy:user-a").get("linkedin_posts").includes("keep"), true);
});

test("send_note stays on the JSON item when it is autonomous", async () => {
  seedUser("user-a", {
    linkedin_messages: fieldJson({ autonomous: true }),
  });
  const res = fakeRes();
  await handler(getReq(), res);
  const item = res.captured.body.items.find((entry) => entry.key === "linkedin_messages");
  assert.equal(item.autonomous, true);
  assert.equal(item.send_note, SEND_NOTE);
});

test("edge config, the allowlist, and the seed script are gone", () => {
  const root = path.join(__dirname, "..");
  assert.equal(fs.existsSync(path.join(root, "api", "_lib", "autonomy-edge.js")), false);
  assert.equal(fs.existsSync(path.join(root, "scripts", "seed-autonomy-edge-config.js")), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["autonomy:seed"], undefined);
  assert.equal(JSON.stringify(pkg.dependencies).includes("edge-config"), false);
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const env = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(readme, /autonomy:<user id>/);
  assert.match(readme, /KV_REST_API_URL/);
  assert.match(readme, /KV_REST_API_TOKEN/);
  assert.match(readme, /KV_REST_API_READ_ONLY_TOKEN/);
  assert.equal(readme.includes("UPSTASH_REDIS_REST_"), false);
  assert.match(readme, /Autonomy settings are unavailable right now/);
  assert.equal(readme.includes("AUTONOMY_ALLOWLIST"), false);
  assert.equal(readme.includes("EDGE_CONFIG"), false);
  assert.equal(readme.includes("autonomy:seed"), false);
  assert.equal(readme.includes("autonomy_last_denied"), false);
  assert.match(env, /KV_REST_API_URL=/);
  assert.match(env, /KV_REST_API_READ_ONLY_TOKEN=/);
  assert.equal(env.includes("UPSTASH_REDIS_REST_"), false);
  assert.equal(env.includes("EDGE_CONFIG"), false);
  assert.equal(env.includes("AUTONOMY_ALLOWLIST"), false);
});

test("application code does not reference the tcp redis urls", () => {
  const root = path.join(__dirname, "..");
  const needles = ["KV_URL", "REDIS_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|html|css)$/.test(entry.name)) files.push(full);
    }
  }
  walk(path.join(root, "api"));
  walk(path.join(root, "src"));
  walk(path.join(root, "scripts"));
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const needle of needles) {
      assert.equal(text.includes(needle), false, `${file} references ${needle}`);
    }
  }
});

test("the page and static assets do not mention redis credentials", () => {
  const renderer = path.join(__dirname, "..", "src", "renderer");
  const banned = [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "KV_REST_API_READ_ONLY_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_URL",
    "REDIS_URL",
  ];
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(renderer);
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const needle of banned) {
      assert.equal(text.includes(needle), false, `${file} mentions ${needle}`);
    }
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
  assert.equal(html.includes("A change can take a few seconds to apply everywhere."), false);
  assert.equal(html.includes("autonomy__lag"), false);
  assert.match(html, /src="\/autonomy\/autonomy\.js"/);
  assert.match(page, /textContent/);
  assert.equal(page.includes("innerHTML"), false);
  assert.equal(page.includes("allowlist"), false);
  assert.match(page, /fetch\("\/api\/autonomy", \{[^}]*Authorization: "Bearer " \+ token\(\)/);
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

test("a failed toggle puts the switch back and shows the error as text", async () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "autonomy", "autonomy.js"),
    "utf8",
  );
  const nodes = [];
  const hostile = "<img src=x onerror=alert(1)>";

  function makeEl(tag) {
    const node = {
      tag,
      className: "",
      children: [],
      attrs: {},
      disabled: false,
      listeners: {},
      _text: "",
      set textContent(value) { this._text = String(value); },
      get textContent() { return this._text; },
      set innerHTML(_value) { throw new Error("innerHTML used"); },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren() { this.children = []; },
    };
    nodes.push(node);
    return node;
  }

  const list = makeEl("ul");
  const status = makeEl("p");
  let calls = 0;
  vm.runInNewContext(page, vm.createContext({
    localStorage: { getItem() { return "signed-in"; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      getElementById(id) { return id === "autonomy-list" ? list : status; },
      createElement: makeEl,
    },
    window: { location: { assign() {} } },
    fetch() {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          status: 200,
          json() {
            return Promise.resolve({
              items: [{
                key: "linkedin_posts",
                label: "LinkedIn posts",
                autonomous: false,
                note: null,
                updated_by: null,
                updated_at: null,
              }],
            });
          },
        });
      }
      return Promise.resolve({
        status: 503,
        json() { return Promise.resolve({ error: hostile }); },
      });
    },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  const button = nodes.find((node) => node.attrs.role === "switch");
  button.listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status._text, hostile);
  assert.equal(nodes.some((node) => node.tag === "img" || node.tag === "script"), false);
  const switches = nodes.filter((node) => node.attrs.role === "switch");
  assert.equal(switches[switches.length - 1].attrs["aria-checked"], "false");
});

test("a 401 on GET clears the session and sends the user home", async () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "autonomy", "autonomy.js"),
    "utf8",
  );
  const removed = [];
  const assigns = [];
  const fetches = [];
  vm.runInNewContext(page, vm.createContext({
    localStorage: {
      getItem() { return "signed-in"; },
      setItem() {},
      removeItem(key) { removed.push(key); },
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      getElementById() {
        return { textContent: "", replaceChildren() {}, appendChild() {} };
      },
      createElement() { return {}; },
    },
    window: { location: { assign(url) { assigns.push(String(url)); } } },
    fetch(url, options) {
      fetches.push({ url: String(url), options });
      return Promise.resolve({
        status: 401,
        json() { return Promise.resolve({ error: "Sign in to tinker first." }); },
      });
    },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches[0].url, "/api/autonomy");
  assert.equal(fetches[0].options.headers.Authorization, "Bearer signed-in");
  assert.deepEqual(removed, ["tinker_jwt"]);
  assert.deepEqual(assigns, ["/"]);
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
