/* Career record: check_text fixtures, Redis routes, and connector tools.
 *
 * Claim finding is injected. The comparator runs for real.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const zlib = require("zlib");

const {
  norm,
  normalizeMoney,
  normalizeMonthYear,
  normalizeTitle,
  normalizeEmployer,
  judgeClaims,
  checkText,
  parseClaims,
} = require("../api/_lib/career-check.js");
const { record } = require("./fixtures/career-record.js");
const cases = require("./fixtures/career-checks.js");
const { excerptIn, parseFacts, extractProposed } = require("../api/_lib/career-extract.js");
const { extractPdfText } = require("../api/_lib/pdf-text.js");
const { shapeForTool, seedRecord } = require("../api/_lib/career.js");

const REST_URL = "https://secret-kv.upstash.io";
const READ_TOKEN = "kv-read-token-do-not-leak";
const WRITE_TOKEN = "kv-write-token-do-not-leak";
const CAREER_UNAVAILABLE = "Career record is unavailable right now.";

test("normalize then exact-compare money, dates, titles, and employers", () => {
  assert.equal(normalizeMoney("$250K"), normalizeMoney("$250,000"));
  assert.equal(normalizeMoney("$250K"), "250000");
  assert.equal(normalizeMoney("0"), "0");
  assert.equal(normalizeMoney("$0"), "0");
  assert.equal(normalizeMonthYear("Mar 2025"), normalizeMonthYear("March 2025"));
  assert.equal(normalizeMonthYear("Mar 2025"), "2025-03");
  assert.equal(normalizeMonthYear("Jul 2021"), "2021-07");
  assert.equal(normalizeTitle("Software Engineering Manager"), "software engineering manager");
  assert.equal(
    normalizeTitle("Software Engineering Manager") === normalizeTitle("Senior Engineering Manager"),
    false,
  );
  assert.equal(normalizeEmployer("Affirm"), normalizeEmployer("affirm"));
  assert.equal(normalizeEmployer("Beginner Work Inc."), "beginner work");
  assert.equal(norm("San Diego, CA"), "san diego ca");
});

test("a model verdict is ignored and the code comparator decides", () => {
  const judged = judgeClaims(record, [{
    text: "I grew the team from 1 to 12.",
    kind: "team_size",
    verdict: "pass",
  }]);
  assert.equal(judged[0].verdict, "mismatch");
  assert.equal(judged[0].id, "fact_team_1_to_9");
  assert.equal(judged[0].correct, "1 to 9");
  assert.equal(Object.prototype.hasOwnProperty.call(judged[0], "verdict"), true);
});

test("the combined same-team claim passes only after it is verified", () => {
  const text = "I grew a team from 1 to 9 that spanned the US, Canada and Poland";
  const before = judgeClaims(record, [{ text, kind: "team_size" }]);
  assert.equal(before[0].verdict, "unsupported");
  const verified = {
    facts: record.facts.map((fact) => fact.id === "seed_same_team_span"
      ? { ...fact, status: "verified" }
      : fact),
    rules: record.rules,
  };
  const after = judgeClaims(verified, [{ text, kind: "team_size" }]);
  assert.equal(after[0].verdict, "pass");
  assert.equal(after[0].id, "seed_same_team_span");
});

function recordFor(item) {
  if (!item.verify) return record;
  return {
    rules: record.rules,
    facts: record.facts.map((fact) => {
      if (!Object.prototype.hasOwnProperty.call(item.verify, fact.id)) return fact;
      return { ...fact, status: "verified", ...item.verify[fact.id] };
    }),
  };
}

test("check_text fixture set scores every known answer", async () => {
  assert.ok(cases.length >= 20, "expected at least 20 cases, got " + cases.length);
  const failures = [];
  for (const item of cases) {
    const result = await checkText({
      record: recordFor(item),
      text: item.text,
      company: item.company || "",
      field_label: item.field_label || "",
      findClaims: async () => item.claims,
    });
    const actual = result.claims.map((claim) => {
      const shaped = { verdict: claim.verdict };
      if (claim.id) shaped.id = claim.id;
      if (Object.prototype.hasOwnProperty.call(claim, "correct")) shaped.correct = claim.correct;
      return shaped;
    });
    const reasonOk = item.reason == null || result.reason === item.reason;
    const same = reasonOk && result.ready === item.ready && JSON.stringify(actual) === JSON.stringify(item.expect);
    if (!same) {
      failures.push(item.name + "\n  expected ready=" + item.ready + " reason=" + (item.reason || "")
        + " " + JSON.stringify(item.expect)
        + "\n  actual   ready=" + result.ready + " reason=" + (result.reason || "")
        + " " + JSON.stringify(actual));
    }
  }
  const score = cases.length - failures.length;
  assert.equal(failures.length, 0, score + "/" + cases.length + "\n" + failures.join("\n\n"));
});

test("parseClaims drops a model verdict", () => {
  const claims = parseClaims(JSON.stringify({
    claims: [{ text: "grew the team from 1 to 12", kind: "team_size", verdict: "pass" }],
  }));
  assert.deepEqual(claims, [{ text: "grew the team from 1 to 12", kind: "team_size", field: "" }]);
});

test("an excerpt must appear in the upload, and contact lines are dropped", () => {
  const doc = "Grew the developer-support engineering function from 1 to 9 engineers. NOTSTOREDUNIQUE stays out.";
  const address = ["person", "example.com"].join("@");
  const facts = parseFacts(JSON.stringify({
    facts: [
      {
        kind: "team_size",
        value: "1 to 9",
        excerpt: "Grew the developer-support engineering function from 1 to 9 engineers",
      },
      {
        kind: "other",
        value: "invented",
        excerpt: "this excerpt was not in the document at all",
      },
      {
        kind: "contact",
        value: address,
        excerpt: "Grew the developer-support engineering function from 1 to 9 engineers",
      },
    ],
  }), [{ name: "resume.md", text: doc }]);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].status, "proposed");
  assert.equal(facts[0].value, "1 to 9");
  assert.equal(facts[0].source.document, "resume.md");
  assert.equal(excerptIn(doc, facts[0].source.excerpt), true);
});

test("a text PDF yields the page text and a non-PDF is refused", () => {
  const sentence = "Grew the team from 1 to 9";
  const stream = "BT (" + sentence + ") Tj ET";
  const pdf = "%PDF-1.1\n1 0 obj\n<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream\nendobj\n";
  assert.equal(extractPdfText(Buffer.from(pdf)), sentence);
  const packed = zlib.deflateSync(Buffer.from("BT (Remote from Jul 2021) Tj ET"));
  const flate = "%PDF-1.4\n1 0 obj << /Filter /FlateDecode /Length " + packed.length + " >>\nstream\n"
    + packed.toString("latin1") + "\nendstream\nendobj\n";
  assert.match(extractPdfText(Buffer.from(flate, "latin1")), /Remote from Jul 2021/);
  assert.throws(() => extractPdfText(Buffer.from("hello")), /not a PDF/);
});

test("extract keeps excerpts and does not return the rest of the file", async () => {
  const doc = [
    "Grew the developer-support engineering function from 1 to 9 engineers.",
    "NOTSTOREDUNIQUE is only in the upload.",
  ].join(" ");
  const facts = await extractProposed([{
    name: "resume.md",
    kind: "markdown",
    text: doc,
  }], async () => JSON.stringify({
    facts: [{
      kind: "team_size",
      value: "1 to 9",
      excerpt: "Grew the developer-support engineering function from 1 to 9 engineers.",
    }],
  }));
  assert.equal(facts.length, 1);
  assert.equal(JSON.stringify(facts).includes("NOTSTOREDUNIQUE"), false);
});

function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}

const stytchCalls = [];
stubAt(path.join(__dirname, "..", "api", "_lib", "stytch.js"), {
  authenticateSession: async (token) => {
    stytchCalls.push(token);
    if (token !== "good-token") {
      throw Object.assign(new Error("Session expired."), { status: 401 });
    }
    return {
      session: { user_id: "user-1" },
      user: { user_id: "user-1", emails: [], name: { first_name: "", last_name: "" } },
    };
  },
});

const handler = require("../api/career.js");
const mcp = require("../api/mcp.js");

const docs = new Map();
let fetchError = null;
let fetchStatus = 200;
const commands = [];
const logs = [];
const originalLog = console.log;
const originalFetch = global.fetch;

function useStore() {
  process.env.KV_REST_API_URL = REST_URL;
  process.env.KV_REST_API_TOKEN = WRITE_TOKEN;
  process.env.KV_REST_API_READ_ONLY_TOKEN = READ_TOKEN;
}

function resetStore() {
  docs.clear();
  commands.length = 0;
  stytchCalls.length = 0;
  logs.length = 0;
  fetchError = null;
  fetchStatus = 200;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_READ_ONLY_TOKEN;
  delete process.env.VERCEL_ENV;
  delete process.env.ANTHROPIC_API_KEY;
}

global.fetch = async (url, opts) => {
  const target = String(url);
  if (target.includes("api.anthropic.com")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            claims: [{ text: "I grew the team from 1 to 12.", kind: "team_size", verdict: "pass" }],
          }),
        }],
      }),
    };
  }
  const args = JSON.parse(opts.body);
  commands.push({
    url: target,
    authorization: opts.headers && opts.headers.Authorization,
    args,
  });
  if (fetchError) throw fetchError;
  if (fetchStatus !== 200) {
    return { ok: false, status: fetchStatus, json: async () => ({ error: "upstream " + REST_URL }) };
  }
  if (target !== REST_URL) throw new Error("unexpected fetch " + target);
  const [cmd, key, value] = args;
  if (cmd === "GET") return { ok: true, status: 200, json: async () => ({ result: docs.has(key) ? docs.get(key) : null }) };
  if (cmd === "SET" && args[3] === "NX") {
    if (docs.has(key)) return { ok: true, status: 200, json: async () => ({ result: null }) };
    docs.set(key, value);
    return { ok: true, status: 200, json: async () => ({ result: "OK" }) };
  }
  if (cmd === "SET") {
    docs.set(key, value);
    return { ok: true, status: 200, json: async () => ({ result: "OK" }) };
  }
  throw new Error("unexpected redis " + cmd);
};

console.log = (...args) => {
  logs.push(args.map(String).join(" "));
};

function fakeRes() {
  const captured = { status: null, body: undefined, headers: {} };
  return {
    captured,
    statusCode: 200,
    setHeader(name, value) { captured.headers[String(name).toLowerCase()] = value; },
    status(code) { captured.status = code; this.statusCode = code; return this; },
    json(body) { captured.body = body; return this; },
    end() { return this; },
  };
}

function careerReq({ method = "GET", token = "good-token", action = "", body } = {}) {
  return {
    method,
    url: "/api/career" + (action ? "?action=" + action : ""),
    query: action ? { action } : {},
    headers: { authorization: token ? "Bearer " + token : "" },
    body,
  };
}

function rpcReq(method, params, token = "good-token") {
  return {
    method: "POST",
    url: "/api/mcp",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: { jsonrpc: "2.0", id: 1, method, params },
  };
}

function assertNoSecrets(value) {
  const text = JSON.stringify(value) + "\n" + logs.join("\n");
  assert.equal(text.includes(REST_URL), false);
  assert.equal(text.includes(READ_TOKEN), false);
  assert.equal(text.includes(WRITE_TOKEN), false);
  assert.equal(text.includes("good-token"), false);
}

test.beforeEach(() => {
  resetStore();
  useStore();
});

test.after(() => {
  console.log = originalLog;
  global.fetch = originalFetch;
  resetStore();
});

test("an mcp_ bearer is 401 before Stytch and does not touch Redis", async () => {
  const token = "mcp_super-secret-token";
  for (const req of [
    careerReq({ token }),
    careerReq({ method: "POST", token, action: "extract", body: { documents: [] } }),
    careerReq({ method: "POST", token, action: "fact", body: { id: "x", action: "verify" } }),
  ]) {
    stytchCalls.length = 0;
    commands.length = 0;
    const res = fakeRes();
    await handler(req, res);
    assert.equal(res.captured.status, 401);
    assert.equal(res.captured.body.error, "Connector credentials cannot change the career record.");
    assert.equal(res.captured.headers["cache-control"], "no-store");
    assert.equal(stytchCalls.length, 0);
    assert.equal(commands.length, 0);
    assert.equal(JSON.stringify(res.captured.body).includes(token), false);
    assertNoSecrets(res.captured.body);
  }
});

test("first load seeds proposed facts and verified rules, then only reads", async () => {
  const first = fakeRes();
  await handler(careerReq(), first);
  assert.equal(first.captured.status, 200);
  const proposedIds = first.captured.body.proposed_facts.map((fact) => fact.id);
  assert.deepEqual(proposedIds, [
    "seed_l7_people_leadership",
    "seed_500k_baseline_mechanism",
    "seed_999_baseline_mechanism",
    "seed_same_team_span",
  ]);
  assert.equal(first.captured.body.proposed_facts.every((fact) => fact.status === "proposed"), true);
  assert.equal(first.captured.body.verified_facts.length, 0);
  assert.equal(first.captured.body.rules.length, 6);
  assert.equal(first.captured.body.rules.every((rule) => rule.status === "verified"), true);
  assert.match(first.captured.body.unverified_note, /not facts/i);
  assert.equal(commands.some((call) => call.args[0] === "SET"), true);
  assert.equal(commands[0].authorization, "Bearer " + READ_TOKEN);

  commands.length = 0;
  const second = fakeRes();
  await handler(careerReq(), second);
  assert.equal(second.captured.status, 200);
  assert.deepEqual(commands.map((call) => call.args[0]), ["GET"]);
  assert.equal(commands[0].authorization, "Bearer " + READ_TOKEN);
  assertNoSecrets(second.captured.body);
});

test("confirm and reject change only the signed-in user's fact", async () => {
  await handler(careerReq(), fakeRes());
  const verified = fakeRes();
  await handler(careerReq({
    method: "POST",
    action: "fact",
    body: { id: "seed_l7_people_leadership", action: "verify", value: "L7 people-leadership outcome" },
  }), verified);
  assert.equal(verified.captured.status, 200);
  assert.equal(verified.captured.body.verified_facts.some((fact) => fact.id === "seed_l7_people_leadership"), true);
  assert.equal(verified.captured.body.proposed_facts.some((fact) => fact.id === "seed_l7_people_leadership"), false);

  const rejected = fakeRes();
  await handler(careerReq({
    method: "POST",
    action: "fact",
    body: { id: "seed_same_team_span", action: "reject" },
  }), rejected);
  assert.equal(rejected.captured.body.rejected_facts.some((fact) => fact.id === "seed_same_team_span"), true);
  const tool = shapeForTool(JSON.parse(docs.get("career:user-1")));
  assert.equal(tool.unverified_facts.some((fact) => fact.id === "seed_same_team_span"), false);
  assert.equal(tool.verified_facts.some((fact) => fact.id === "seed_same_team_span"), false);
  assert.equal(tool.verified_facts.some((fact) => fact.id === "seed_l7_people_leadership"), true);
  assert.equal(tool.unverified_facts.every((fact) => fact.unverified === true), true);
});

test("extract stores proposed excerpts and not the rest of the upload", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  const marker = "NOTSTOREDUNIQUE";
  const sentence = "Grew the developer-support engineering function from 1 to 9 engineers.";
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes("api.anthropic.com")) {
      const sent = JSON.parse(opts.body);
      assert.equal(JSON.stringify(sent).includes(marker), true);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{
            type: "text",
            text: JSON.stringify({
              facts: [{ kind: "team_size", value: "1 to 9", excerpt: sentence }],
            }),
          }],
        }),
      };
    }
    return original(url, opts);
  };
  try {
    const res = fakeRes();
    await handler(careerReq({
      method: "POST",
      action: "extract",
      body: { documents: [{ name: "resume.md", kind: "markdown", text: sentence + " " + marker }] },
    }), res);
    assert.equal(res.captured.status, 200, JSON.stringify(res.captured.body));
    const stored = docs.get("career:user-1");
    assert.equal(stored.includes(marker), false);
    assert.equal(stored.includes(sentence), true);
    assert.equal(res.captured.body.proposed_facts.some((fact) => fact.value === "1 to 9" && fact.status === "proposed"), true);
  } finally {
    global.fetch = original;
  }
});

test("preview logs omit facts, excerpts, and the checked text", async () => {
  process.env.VERCEL_ENV = "preview";
  await handler(careerReq(), fakeRes());
  const excerpt = seedRecord().facts[0].source.excerpt;
  assert.equal(logs.join("\n").includes(excerpt), false);
  assert.equal(logs.join("\n").includes("\"excerpt\""), false);
  assert.match(logs.join("\n"), /redacted":"career"/);

  logs.length = 0;
  docs.set("career:user-1", JSON.stringify(record));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  const checked = fakeRes();
  await mcp(rpcReq("tools/call", {
    name: "check_text",
    arguments: { text: "I grew the team from 1 to 12.", userId: "user-other" },
  }), checked);
  assert.equal(checked.captured.body.result.structuredContent.claims[0].verdict, "mismatch");
  assert.equal(logs.join("\n").includes("I grew the team from 1 to 12."), false);
  assert.equal(logs.join("\n").includes("1 to 9"), false);
  assertNoSecrets(checked.captured.body);
});

test("get_career_record reads only this user and check_text does not write", async () => {
  docs.set("career:user-1", JSON.stringify(record));
  docs.set("career:user-other", JSON.stringify({
    facts: [{
      id: "fact_other",
      kind: "team_size",
      value: "1 to 40",
      source: { document: "other", excerpt: "Grew a private team from 1 to 40 engineers" },
      status: "verified",
      updated_at: "2026-09-25T22:00:00.000Z",
    }],
    rules: [],
  }));
  const listed = fakeRes();
  await mcp(rpcReq("tools/list"), listed);
  const tools = listed.captured.body.result.tools;
  const names = tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    "ask_followups",
    "draft_linkedin_post",
    "get_autonomy_settings",
    "get_career_record",
    "check_text",
  ]);
  for (const name of ["get_career_record", "check_text"]) {
    const tool = tools.find((item) => item.name === name);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
  }
  assert.equal(names.some((name) => /set_|update_|verify|reject|write/.test(name)), false);

  commands.length = 0;
  const read = fakeRes();
  await mcp(rpcReq("tools/call", {
    name: "get_career_record",
    arguments: { userId: "user-other", user_id: "user-other" },
  }), read);
  const shaped = read.captured.body.result.structuredContent;
  assert.equal(read.captured.body.result.isError, undefined);
  assert.equal(shaped.verified_facts.some((fact) => fact.id === "fact_team_1_to_9"), true);
  assert.equal(shaped.unverified_facts.some((fact) => fact.id === "seed_same_team_span" && fact.unverified === true), true);
  assert.equal(shaped.verified_facts.some((fact) => fact.id === "fact_other"), false);
  assert.equal(JSON.stringify(shaped).includes("1 to 40"), false);
  assert.equal(shaped.rules.some((rule) => rule.id === "rule_salary"), true);
  assert.deepEqual(commands.map((call) => call.args), [["GET", "career:user-1"]]);
  assert.equal(commands[0].authorization, "Bearer " + READ_TOKEN);
  assertNoSecrets(read.captured.body);

  commands.length = 0;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  const checked = fakeRes();
  await mcp(rpcReq("tools/call", {
    name: "check_text",
    arguments: { text: "I grew the team from 1 to 12." },
  }), checked);
  const claim = checked.captured.body.result.structuredContent.claims[0];
  assert.equal(claim.verdict, "mismatch");
  assert.equal(claim.id, "fact_team_1_to_9");
  assert.equal(checked.captured.body.result.structuredContent.ready, false);
  assert.deepEqual(commands.map((call) => call.args[0]), ["GET"]);
});

test("a missing record is empty and distinct from an unreachable store", async () => {
  const read = fakeRes();
  await mcp(rpcReq("tools/call", { name: "get_career_record", arguments: {} }), read);
  assert.equal(read.captured.body.result.isError, undefined);
  const shaped = read.captured.body.result.structuredContent;
  assert.deepEqual(shaped.verified_facts, []);
  assert.deepEqual(shaped.unverified_facts, []);
  assert.deepEqual(shaped.rules, []);
  assert.match(shaped.unverified_note, /not facts/i);
  assert.equal(commands.some((call) => call.args[0] === "SET"), false);
});

test("an unreachable store is an error, not an empty record", async () => {
  delete process.env.KV_REST_API_READ_ONLY_TOKEN;
  const missing = fakeRes();
  await mcp(rpcReq("tools/call", { name: "get_career_record", arguments: {} }), missing);
  assert.equal(missing.captured.body.result.isError, true);
  assert.equal(missing.captured.body.result.content[0].text, CAREER_UNAVAILABLE);
  assert.equal(missing.captured.body.result.structuredContent, undefined);
  assert.equal(JSON.stringify(missing.captured.body).includes(REST_URL), false);

  useStore();
  fetchError = Object.assign(new Error("aborted " + REST_URL + " " + READ_TOKEN), { name: "AbortError" });
  const down = fakeRes();
  await mcp(rpcReq("tools/call", { name: "get_career_record", arguments: {} }), down);
  assert.equal(down.captured.body.result.content[0].text, CAREER_UNAVAILABLE);
  assert.equal(JSON.stringify(down.captured.body).includes(REST_URL), false);
  assert.equal(JSON.stringify(down.captured.body).includes(READ_TOKEN), false);

  const browser = fakeRes();
  await handler(careerReq(), browser);
  assert.equal(browser.captured.status, 503);
  assert.deepEqual(browser.captured.body, { error: CAREER_UNAVAILABLE });
  assert.equal(logs.join("\n").includes(REST_URL), false);
});

test("the career page uses the existing sign-in and does not render HTML from facts", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "src", "renderer", "career", "index.html"), "utf8");
  const page = fs.readFileSync(path.join(root, "src", "renderer", "career", "career.js"), "utf8");
  const auth = fs.readFileSync(path.join(root, "src", "renderer", "auth.js"), "utf8");
  const sw = fs.readFileSync(path.join(root, "src", "renderer", "sw.js"), "utf8");
  const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
  assert.match(html, /Nothing is verified until you click/);
  assert.match(html, /src="\/career\/career\.js"/);
  assert.equal(html.includes("\u2014"), false);
  assert.match(page, /textContent/);
  assert.equal(page.includes("innerHTML"), false);
  assert.match(page, /fetch\("\/api\/career", \{/);
  assert.match(page, /sessionStorage.setItem\(RETURN_KEY, "\/career"\)/);
  assert.match(auth, /path !== "\/career"/);
  assert.match(sw, /pathname === "\/career"/);
  assert.match(vercel, /\/career\/index.html/);
  const banned = [REST_URL, READ_TOKEN, WRITE_TOKEN, "KV_REST_API_URL"];
  for (const file of [html, page]) {
    for (const needle of banned) assert.equal(file.includes(needle), false);
  }
});

test("fixtures and career code do not contain an email address or a phone number", () => {
  const root = path.join(__dirname, "..");
  const files = [
    "src/renderer/career/catalog.js",
    "src/renderer/career/career.js",
    "src/renderer/career/index.html",
    "api/career.js",
    "api/_lib/career.js",
    "api/_lib/career-check.js",
    "api/_lib/career-extract.js",
    "api/_lib/career-redis.js",
    "tests/fixtures/career-record.js",
    "tests/fixtures/career-checks.js",
    "tests/career.test.js",
  ];
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const phone = /\b\d{3}[-.)]\s*\d{3}[-.]\d{4}\b/;
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(email.test(text), false, file);
    assert.equal(phone.test(text), false, file);
  }
});
