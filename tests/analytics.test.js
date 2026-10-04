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
  assert.match(html, /analytics\.js\?v=1/);
  assert.match(html, /vercel-analytics\.js\?v=1/);
  assert.match(html, /analytics-keystrokes\.js\?v=1/);
  assert.match(sw, /tinker-shell-v50/);
  assert.match(sw, /analytics\.js/);
  assert.ok((vercel.rewrites || []).some((r) => r.source === "/metrics"));
  assert.ok(pkg.dependencies["@vercel/analytics"]);
  assert.ok(fs.existsSync(path.join(root, "src/renderer/metrics/index.html")));
  const va = fs.readFileSync(path.join(root, "src/renderer/vercel-analytics.js"), "utf8");
  assert.match(va, /\/_vercel\/insights\/script\.js/);
  assert.doesNotMatch(va, /\.track\(/);
});

test("owner gate fails closed without METRICS_OWNER_ALLOWLIST", () => {
  const analytics = require("../api/_lib/analytics.js");
  const prev = process.env.METRICS_OWNER_ALLOWLIST;
  process.env.METRICS_OWNER_ALLOWLIST = "";
  assert.equal(analytics.isMetricsOwner("user-live-anything"), false);
  process.env.METRICS_OWNER_ALLOWLIST = "user-live-tyler,user-test-1";
  assert.equal(analytics.isMetricsOwner("user-live-tyler"), true);
  assert.equal(analytics.isMetricsOwner("user-other"), false);
  if (prev == null) delete process.env.METRICS_OWNER_ALLOWLIST;
  else process.env.METRICS_OWNER_ALLOWLIST = prev;
});
