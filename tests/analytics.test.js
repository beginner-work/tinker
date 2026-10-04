/* First-party analytics client: batching, DNT, no content leakage, keystrokes. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../src/renderer/lib/analytics-core.js");
const keystrokes = require("../src/renderer/lib/analytics-keystrokes.js");
const ingest = require("../api/_lib/analytics-ingest.js");
const aggregate = require("../api/_lib/analytics-aggregate.js");

const SAMPLE = "The quick brown fox jumps over the lazy dog";

function memStorage() {
  const m = Object.create(null);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v) { m[k] = String(v); },
    removeItem(k) { delete m[k]; },
  };
}

test("DNT / GPC disables tracking and flush", async () => {
  const bodies = [];
  const client = core.createAnalyticsClient({
    storage: memStorage(),
    navigator: { doNotTrack: "1" },
    send: async (body) => { bodies.push(body); },
    flushMs: 10,
  });
  assert.equal(client.isDisabled(), true);
  assert.equal(client.track("page_view"), null);
  const result = await client.flush();
  assert.equal(result.reason, "dnt");
  assert.equal(bodies.length, 0);
});

test("GPC alone disables tracking", () => {
  const client = core.createAnalyticsClient({
    storage: memStorage(),
    navigator: { globalPrivacyControl: true },
  });
  assert.equal(client.isDisabled(), true);
});

test("batches events and flushes compactly", async () => {
  const bodies = [];
  let now = 1_700_000_000_000;
  const client = core.createAnalyticsClient({
    storage: memStorage(),
    navigator: { doNotTrack: "0" },
    now: () => now,
    send: async (body) => { bodies.push(body); },
    flushMs: 60_000,
  });
  client.captureFirstTouch("?utm_source=linkedin&utm_campaign=spring", "https://www.linkedin.com/in/x", "tinker.beginner.work");
  client.track("page_view", {}, { path: "/", viewportW: 390, viewportH: 844, appVersion: "50" });
  client.track("signin_gate_shown", {}, { path: "/", viewportW: 390 });
  assert.equal(client.peekQueue().length, 2);
  const flushed = await client.flush();
  assert.equal(flushed.sent, true);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].events.length, 2);
  assert.equal(bodies[0].events[0].utmSource, "linkedin");
  assert.equal(bodies[0].events[0].utmCampaign, "spring");
  assert.equal(bodies[0].events[0].deviceType, "phone");
  assert.equal(client.peekQueue().length, 0);
});

test("never leaks draft text or titles into event props or payloads", async () => {
  const bodies = [];
  const client = core.createAnalyticsClient({
    storage: memStorage(),
    navigator: {},
    send: async (body) => { bodies.push(body); },
  });
  client.track("save_succeeded", {
    title: "Secret Essay Title",
    body: SAMPLE,
    text: SAMPLE,
    word_count_bucket: "11-50",
  });
  const flushed = await client.flush();
  const json = JSON.stringify(flushed.body);
  assert.equal(core.payloadContainsForbiddenText(json, SAMPLE), false);
  assert.equal(json.includes("Secret Essay Title"), false);
  assert.equal(json.includes(SAMPLE), false);
  assert.equal(flushed.body.events[0].props.word_count_bucket, "11-50");
  assert.equal(flushed.body.events[0].props.title, undefined);
  assert.equal(flushed.body.events[0].props.body, undefined);
});

test("keystroke buffer stores categories only — typed sentence never appears", async () => {
  const bodies = [];
  let now = 1000;
  const client = core.createAnalyticsClient({
    storage: memStorage(),
    navigator: {},
    now: () => now,
    send: async (body) => { bodies.push(body); },
    flushMs: 60_000,
  });

  for (const ch of SAMPLE) {
    now += 40;
    const t0 = now;
    client.onKeyEvent({
      key: ch,
      code: ch === " " ? "Space" : "Key" + ch.toUpperCase(),
    }, t0);
  }
  // Also paste with content that must not be stored — only count.
  client.onPasteOrCut("paste", SAMPLE.length);

  const buf = client.peekKeystrokeBuffer();
  assert.ok(buf.length >= SAMPLE.length);
  for (const row of buf) {
    assert.equal(typeof row[0], "number");
    assert.equal(typeof row[1], "number");
    assert.equal(row.every((x) => typeof x === "number"), true);
  }
  assert.equal(keystrokes.packedContainsText(buf, SAMPLE), false);

  const latency = client.latencyStats();
  assert.ok(latency.count >= SAMPLE.length);
  // Handler should stay well under 5ms in this synthetic clock (same tick).
  assert.ok(latency.p95 < 5, "p95 latency " + latency.p95);

  const flushed = await client.flush();
  const json = JSON.stringify(flushed.body);
  assert.equal(core.payloadContainsForbiddenText(json, SAMPLE), false);
  assert.equal(json.includes(SAMPLE), false);
  assert.equal(json.includes("quick"), false);
  assert.equal(json.includes("fox"), false);
  assert.ok(flushed.body.keystrokes.length >= 1);
  const packed = flushed.body.keystrokes[0].packed;
  assert.equal(keystrokes.packedContainsText(packed, SAMPLE), false);
  // Paste row includes count only.
  const paste = packed.find((r) => r[1] === keystrokes.CAT.paste);
  assert.ok(paste);
  assert.equal(paste[2], SAMPLE.length);
});

test("server sanitizeEvent strips forbidden props", () => {
  const ev = ingest.sanitizeEvent({
    name: "save_failed",
    anonymousId: "a" + "x".repeat(16),
    sessionId: "s1",
    props: {
      error_kind: "network",
      title: "Nope",
      body: SAMPLE,
      text: "abc",
    },
  });
  assert.ok(ev);
  assert.equal(ev.props.error_kind, "network");
  assert.equal(ev.props.title, undefined);
  assert.equal(ev.props.body, undefined);
  assert.equal(JSON.stringify(ev).includes(SAMPLE), false);
});

test("utm-tagged landing survives through signup_completed (first-touch)", async () => {
  const storage = memStorage();
  const bodies = [];
  const client = core.createAnalyticsClient({
    storage,
    navigator: {},
    send: async (body) => { bodies.push(body); },
  });
  client.captureFirstTouch(
    "?utm_source=linkedin&utm_medium=social&utm_campaign=beacon_q2&utm_content=hero&ref=tyler",
    "https://www.linkedin.com/feed/",
    "tinker.beginner.work"
  );
  client.track("page_view");
  client.track("signin_gate_shown");
  client.track("signup_completed", { is_new: true });
  await client.flush();
  const signup = bodies[0].events.find((e) => e.name === "signup_completed");
  assert.ok(signup);
  assert.equal(signup.utmSource, "linkedin");
  assert.equal(signup.utmMedium, "social");
  assert.equal(signup.utmCampaign, "beacon_q2");
  assert.equal(signup.utmContent, "hero");
  assert.equal(signup.ref, "tyler");
  assert.equal(signup.referrerHost, "www.linkedin.com");

  // Later navigation without utm params must not overwrite first-touch.
  client.captureFirstTouch("", "", "tinker.beginner.work");
  client.track("page_view");
  await client.flush();
  assert.equal(bodies[1].events[0].utmSource, "linkedin");
  assert.equal(bodies[1].events[0].utmCampaign, "beacon_q2");
});

test("aggregation: funnel, sources by utm_source, device split, day-2", () => {
  const day0 = new Date("2026-10-01T12:00:00.000Z");
  const day1 = new Date("2026-10-02T12:00:00.000Z");
  const events = [
    { name: "page_view", ts: day0, anonymousId: "a1", userId: "", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "signin_gate_shown", ts: day0, anonymousId: "a1", userId: "", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "signup_completed", ts: day0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "first_words_typed", ts: day0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "keep_crafting_tapped", ts: day0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "this_is_everything_tapped", ts: day0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "save_succeeded", ts: day0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "page_view", ts: day1, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "page_view", ts: day0, anonymousId: "a2", userId: "", deviceType: "desktop", utmSource: "", utmCampaign: "", referrerHost: "news.ycombinator.com" },
    { name: "page_view", ts: day0, anonymousId: "a3", userId: "", deviceType: "desktop", utmSource: "", utmCampaign: "", referrerHost: "" },
  ];
  // Freeze "now" by using days large enough relative to fixture dates — filterSince
  // uses Date.now(). Patch via far-past relative events instead:
  const now = Date.now();
  const recent = events.map((e, i) => ({
    ...e,
    ts: new Date(now - (i < 8 ? (i === 7 ? 1 : 2) * 24 * 60 * 60 * 1000 : 2 * 24 * 60 * 60 * 1000) + i * 1000),
  }));
  // Rebuild with clearer day keys for day-2: subject u1 has page_view on D and D+1.
  const d0 = new Date(now - 3 * 24 * 60 * 60 * 1000);
  const d1 = new Date(now - 2 * 24 * 60 * 60 * 1000);
  const rows = [
    { name: "page_view", ts: d0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "signin_gate_shown", ts: d0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "signup_completed", ts: d0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "first_words_typed", ts: d0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "keep_crafting_tapped", ts: d0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "this_is_everything_tapped", ts: d0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "save_succeeded", ts: d0, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "page_view", ts: d1, anonymousId: "a1", userId: "u1", deviceType: "phone", utmSource: "linkedin", utmCampaign: "c1", referrerHost: "" },
    { name: "page_view", ts: d0, anonymousId: "a2", userId: "", deviceType: "desktop", utmSource: "", utmCampaign: "", referrerHost: "news.ycombinator.com" },
    { name: "page_view", ts: d0, anonymousId: "a3", userId: "", deviceType: "desktop", utmSource: "", utmCampaign: "", referrerHost: "" },
  ];
  void recent;
  const summary = aggregate.summarize(rows, 7);
  assert.equal(summary.funnel[0].name, "page_view");
  assert.ok(summary.funnel[0].unique >= 3);
  assert.equal(summary.funnel.find((f) => f.name === "signup_completed").unique, 1);
  assert.equal(summary.topSources[0].source, "linkedin");
  assert.equal(summary.topSources[0].campaigns[0].campaign, "c1");
  assert.ok(summary.topSources.some((s) => s.source === "news.ycombinator.com"));
  assert.ok(summary.topSources.some((s) => s.source === "direct"));
  assert.ok(summary.deviceSplit.phone.unique >= 1);
  assert.ok(summary.deviceSplit.desktop.unique >= 1);
  assert.ok(summary.day2Return.eligible >= 1);
  assert.ok(summary.day2Return.returned >= 1);
});

test("deriveSessionMetrics marks pauses and deletions without text", () => {
  const packed = [
    [0, keystrokes.CAT.letter],
    [50, keystrokes.CAT.letter],
    [100, keystrokes.CAT.space],
    [150, keystrokes.CAT.letter],
    [3000, keystrokes.CAT.letter], // pause >2s
    [3100, keystrokes.CAT.backspace],
    [15000, keystrokes.CAT.letter], // pause >10s
    [15100, keystrokes.CAT.paste, 12],
  ];
  assert.equal(keystrokes.packedContainsText(packed, SAMPLE), false);
  const m = keystrokes.deriveSessionMetrics(packed, { firstWordMs: 50, doneMs: 20000 });
  assert.ok(m.pausesOver2s >= 1);
  assert.ok(m.pausesOver10s >= 1);
  assert.ok(m.pasteCount >= 1);
  assert.ok(m.backspaceDeleteRatio > 0);
  assert.ok(Array.isArray(m.timeline));
  assert.ok(m.timeline.some((b) => b.pause));
  assert.ok(m.timeline.some((b) => b.del > 0));
});

test("shipped assets and routes include analytics + metrics + vercel pageviews", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(html, /analytics\.js\?v=3/);
  assert.match(html, /vercel-analytics\.js\?v=1/);
  assert.match(html, /analytics-keystrokes\.js\?v=2/);
  assert.match(html, /analytics-owner-edit\.js\?v=1/);
  assert.match(html, /analytics-core\.js\?v=2/);
  assert.match(sw, /tinker-shell-v59/);
  assert.match(sw, /analytics\.js/);
  assert.match(sw, /analytics-owner-edit\.js/);
  assert.ok((vercel.rewrites || []).some((r) => r.source === "/metrics"));
  assert.ok((vercel.rewrites || []).some((r) => r.source === "/metrics/how-i-write"));
  assert.ok(pkg.dependencies["@vercel/analytics"]);
  assert.ok(fs.existsSync(path.join(root, "src/renderer/metrics/index.html")));
  assert.ok(fs.existsSync(path.join(root, "src/renderer/metrics/how-i-write.html")));
  assert.ok(fs.existsSync(path.join(root, "api/writing-summary.js")));
  const va = fs.readFileSync(path.join(root, "src/renderer/vercel-analytics.js"), "utf8");
  assert.match(va, /\/_vercel\/insights\/script\.js/);
  assert.doesNotMatch(va, /\.track\(/);
  const mcp = fs.readFileSync(path.join(root, "api/mcp.js"), "utf8");
  assert.match(mcp, /get_writing_metrics/);
  assert.match(mcp, /list_writing_sessions/);
  assert.match(mcp, /tag_writing_session/);
  const envEx = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(envEx, /WRITING_SUMMARY_TOKEN/);
});

test("owner gate fails closed when both allowlists empty; falls back to LEADS", () => {
  const analytics = require("../api/_lib/analytics.js");
  const prevM = process.env.METRICS_OWNER_ALLOWLIST;
  const prevL = process.env.LEADS_OWNER_ALLOWLIST;
  process.env.METRICS_OWNER_ALLOWLIST = "";
  process.env.LEADS_OWNER_ALLOWLIST = "";
  assert.equal(analytics.isMetricsOwner("user-live-anything"), false);

  process.env.METRICS_OWNER_ALLOWLIST = "user-live-tyler,user-test-1";
  process.env.LEADS_OWNER_ALLOWLIST = "";
  assert.equal(analytics.isMetricsOwner("user-live-tyler"), true);
  assert.equal(analytics.isMetricsOwner("user-other"), false);

  // METRICS empty → fall back to LEADS_OWNER_ALLOWLIST
  process.env.METRICS_OWNER_ALLOWLIST = "";
  process.env.LEADS_OWNER_ALLOWLIST = "user-from-leads";
  assert.equal(analytics.isMetricsOwner("user-from-leads"), true);
  assert.equal(analytics.isMetricsOwner("user-live-tyler"), false);

  // METRICS wins when both set
  process.env.METRICS_OWNER_ALLOWLIST = "user-metrics-only";
  process.env.LEADS_OWNER_ALLOWLIST = "user-from-leads";
  assert.equal(analytics.isMetricsOwner("user-metrics-only"), true);
  assert.equal(analytics.isMetricsOwner("user-from-leads"), false);

  if (prevM == null) delete process.env.METRICS_OWNER_ALLOWLIST;
  else process.env.METRICS_OWNER_ALLOWLIST = prevM;
  if (prevL == null) delete process.env.LEADS_OWNER_ALLOWLIST;
  else process.env.LEADS_OWNER_ALLOWLIST = prevL;
});

test("missing analytics tables are detected as metrics_not_setup", () => {
  const analytics = require("../api/_lib/analytics.js");
  assert.equal(analytics.isMissingAnalyticsSchema(null), false);
  assert.equal(analytics.isMissingAnalyticsSchema({ code: "P2021", message: "x" }), true);
  assert.equal(
    analytics.isMissingAnalyticsSchema({
      message: 'relation "AnalyticsEvent" does not exist',
    }),
    true,
  );
  assert.equal(
    analytics.isMissingAnalyticsSchema({ code: "P2002", message: "Unique constraint" }),
    false,
  );
});

test("POST ingest returns 202 and never throws when tables are missing", async () => {
  const analytics = require("../api/_lib/analytics.js");
  const handler = require("../api/analytics.js");
  const prev = analytics.ingestBatch;
  analytics.ingestBatch = async () => {
    const err = new Error('relation "AnalyticsEvent" does not exist');
    err.code = "P2021";
    throw err;
  };
  const res = {
    statusCode: 0,
    body: null,
    setHeader() {},
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = {
    method: "POST",
    headers: {},
    url: "/api/analytics",
    body: { events: [{ name: "page_view", anonymousId: "anon12345", sessionId: "s1" }] },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.accepted, 0);
  analytics.ingestBatch = prev;
});

test("GET summary returns metrics_not_setup when tables are missing", async () => {
  const analytics = require("../api/_lib/analytics.js");
  const stytchPath = require.resolve("../api/_lib/stytch.js");
  const handlerPath = require.resolve("../api/analytics.js");
  const prevAllow = process.env.METRICS_OWNER_ALLOWLIST;
  const prevLeads = process.env.LEADS_OWNER_ALLOWLIST;
  process.env.METRICS_OWNER_ALLOWLIST = "owner-1";
  process.env.LEADS_OWNER_ALLOWLIST = "";

  const stytch = require("../api/_lib/stytch.js");
  const prevAuth = stytch.authenticateSession;
  stytch.authenticateSession = async () => ({ session: { user_id: "owner-1" } });
  // analytics.js destructures authenticateSession at load time — reload after stub.
  delete require.cache[handlerPath];
  const handler = require("../api/analytics.js");

  const prevSummary = analytics.metricsSummary;
  analytics.metricsSummary = async () => {
    const err = new Error("The table `public.AnalyticsEvent` does not exist in the current database.");
    err.code = "P2021";
    throw err;
  };
  const prevRollup = analytics.rollupExpiredKeystrokes;
  analytics.rollupExpiredKeystrokes = async () => {};

  const res = {
    statusCode: 0,
    body: null,
    setHeader() {},
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  await handler({
    method: "GET",
    headers: { authorization: "Bearer sess" },
    url: "/api/analytics?action=summary&days=7",
  }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "metrics_not_setup");
  assert.match(res.body.error, /not set up yet/i);

  stytch.authenticateSession = prevAuth;
  analytics.metricsSummary = prevSummary;
  analytics.rollupExpiredKeystrokes = prevRollup;
  delete require.cache[handlerPath];
  delete require.cache[stytchPath];
  if (prevAllow == null) delete process.env.METRICS_OWNER_ALLOWLIST;
  else process.env.METRICS_OWNER_ALLOWLIST = prevAllow;
  if (prevLeads == null) delete process.env.LEADS_OWNER_ALLOWLIST;
  else process.env.LEADS_OWNER_ALLOWLIST = prevLeads;
});

test("analytics client flush never throws when send fails (editor stays unaffected)", async () => {
  const core = require("../src/renderer/lib/analytics-core.js");
  const client = core.createAnalyticsClient({
    storage: memStorage(),
    navigator: {},
    send: async () => { throw new Error("network / missing table"); },
    flushMs: 60_000,
  });
  client.track("page_view", {}, { path: "/" });
  const result = await client.flush();
  assert.equal(result.sent, false);
  assert.equal(result.reason, "network");
});

test("flow detection finds stretches and end causes without text", () => {
  const flow = require("../src/renderer/lib/analytics-flow.js");
  const packed = [];
  // 4 minutes of typing with small gaps, then a long pause
  for (let t = 0; t < 4 * 60 * 1000; t += 200) {
    packed.push([t, 0]); // letter
  }
  const markers = [
    { t: 0, kind: "prompt_shown", promptId: "interview.next_question", variantId: "B" },
    { t: 4 * 60 * 1000 + 100, kind: "surface_tapped", surfaceId: "btn.keep_crafting" },
  ];
  const stretches = flow.detectFlowStretches(packed, markers);
  assert.ok(stretches.length >= 1);
  assert.equal(stretches[0].startCause, "prompt_shown");
  assert.equal(stretches[0].endCause, "surface_tapped");
  assert.ok(stretches[0].lengthMs >= flow.FLOW_MIN_MS);
  const json = JSON.stringify(stretches);
  assert.equal(json.includes("The quick"), false);
});

test("writing metrics + summary are numbers-only (no draft text, no fine timestamps in export)", () => {
  const ownerEdit = require("../src/renderer/lib/analytics-owner-edit.js");
  const wm = require("../api/_lib/analytics-writing-metrics.js");
  const SECRET = "secret draft about fundraising that must never leak";
  const ops = [];
  let t = 0;
  // Simulate ~4 min of inserts with the secret sentence, then a delete, then more typing
  const words = (SECRET + " more words here to keep going ").repeat(20);
  for (let i = 0; i < words.length; i++) {
    ops.push({ t: t, op: "ins", pos: i, text: words[i] });
    t += 50; // 50ms per char → plenty of flow time
  }
  ops.push({ t: t + 100, op: "mark", mark: "keep_crafting" });
  ops.push(...ownerEdit.diffEdit(words, words.slice(0, 40), t + 200));

  const bags = [{
    sessionId: "sess-test-1",
    startedAt: new Date("2026-10-01T17:00:00.000Z"),
    ops,
    contextTag: "morning-pitch",
    surfaceEvents: [
      {
        name: "prompt_shown",
        promptId: "interview.next_question",
        variantId: "B",
        surfaceId: "",
        ts: new Date("2026-10-01T17:00:01.000Z"),
      },
      {
        name: "surface_tapped",
        surfaceId: "btn.keep_crafting",
        promptId: "",
        variantId: "",
        ts: new Date("2026-10-01T17:05:00.000Z"),
      },
    ],
  }];

  const metrics = wm.assembleWritingMetrics(bags, "12w");
  const blob = JSON.stringify(metrics);
  assert.equal(blob.includes(SECRET), false);
  assert.equal(blob.includes("fundraising"), false);
  assert.ok(Array.isArray(metrics.weeklyTrends));
  assert.ok(Array.isArray(metrics.flowStretches));
  assert.ok(metrics.rankings);
  assert.ok(metrics.timing);
  assert.ok(metrics.byContextTag.some((r) => r.contextTag === "morning-pitch"));

  const summary = wm.assembleWritingSummary(bags);
  const sumBlob = JSON.stringify(summary);
  assert.equal(sumBlob.includes(SECRET), false);
  assert.equal(sumBlob.includes("morning-pitch"), false);
  assert.equal(sumBlob.includes("contextTag"), false);
  assert.ok(Array.isArray(summary.weekly));
  assert.ok(summary.weekly[0].flowMinutes != null || summary.weekly[0].flowMinutes === 0);
  assert.ok("timeToFirstWordMs" in summary.weekly[0]);
  assert.ok("revisionRate" in summary.weekly[0]);
  assert.ok(Array.isArray(summary.promptRankings));
  // No ISO timestamps with time-of-day in the export
  assert.doesNotMatch(sumBlob, /T\d{2}:\d{2}:\d{2}/);
});

test("non-owner sanitizeOps strips text", () => {
  const ownerEdit = require("../src/renderer/lib/analytics-owner-edit.js");
  const ops = ownerEdit.sanitizeOps(
    [{ t: 0, op: "ins", pos: 0, text: "secret words" }],
    { allowText: false }
  );
  assert.equal(ops.length, 1);
  assert.equal(ops[0].text, undefined);
  assert.ok(ops[0].len >= 1);
});

test("writing-summary endpoint requires WRITING_SUMMARY_TOKEN", async () => {
  const prev = process.env.WRITING_SUMMARY_TOKEN;
  delete process.env.WRITING_SUMMARY_TOKEN;
  const handler = require("../api/writing-summary.js");
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  await handler({ method: "GET", headers: {}, url: "/api/writing-summary" }, res);
  assert.equal(res.statusCode, 503);
  assert.match(String(res.body && res.body.error), /WRITING_SUMMARY_TOKEN/);

  process.env.WRITING_SUMMARY_TOKEN = "test-token-abc";
  const res2 = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  await handler({
    method: "GET",
    headers: { authorization: "Bearer wrong" },
    url: "/api/writing-summary",
  }, res2);
  assert.equal(res2.statusCode, 401);

  if (prev == null) delete process.env.WRITING_SUMMARY_TOKEN;
  else process.env.WRITING_SUMMARY_TOKEN = prev;
});
