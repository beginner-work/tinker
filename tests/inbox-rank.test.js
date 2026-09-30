/* Flat inbox ranking: deadlines before cold outreach. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rankInboxItems, TIER } = require("../api/_lib/inbox-rank.js");

test("Malay interview deadline ranks above cold outreach", () => {
  const items = rankInboxItems({
    leads: [
      {
        id: "malay",
        personName: "Malay",
        company: "Hightouch",
        companyId: "ht",
        nextStep: "Do the Hightouch AI interview on Braintrust",
        nextStepAt: "2026-09-30",
        notes: "### Tell me about yourself?\n\n",
        queueOrder: 0,
      },
      {
        id: "tina",
        personName: "Tina Li",
        company: "Robinhood",
        companyId: "rh",
        nextStep: "Write her about the role",
        nextStepAt: "2026-10-01T16:00:00.000Z",
        notes: "",
        queueOrder: 0,
      },
    ],
    drafts: [],
    companies: [
      { id: "ht", name: "Hightouch", priority: 0, northStar: false, tier: "other" },
      { id: "rh", name: "Robinhood", priority: 2, northStar: false, tier: "wave_1" },
    ],
    byLeadId: {
      tina: { touch: { date: "2026-10-01T16:00:00.000Z", touchType: "hiring_leader_outreach", status: "planned" } },
    },
    readingThreads: [],
  });
  assert.equal(items[0].id, "malay");
  assert.equal(items[0].tier, TIER.DEADLINE);
  assert.match(items[0].rankReason, /interview|deadline/i);
  assert.equal(items[1].id, "tina");
  assert.equal(items[1].tier, TIER.COLD);
});

test("sent outreach is hidden from ranked inbox", () => {
  const items = rankInboxItems({
    leads: [
      { id: "a", personName: "Sent", companyId: "c", nextStepAt: "2026-09-30", notes: "" },
      { id: "b", personName: "Open", companyId: "c", nextStepAt: "2026-10-02", notes: "" },
    ],
    drafts: [{ leadId: "a", status: "sent_by_owner" }],
    companies: [{ id: "c", name: "Co", priority: 1, northStar: false, tier: "wave_1" }],
    byLeadId: {},
    readingThreads: [],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "b");
});

test("warm follow-up beats cold; reading is prep tier", () => {
  const items = rankInboxItems({
    leads: [
      {
        id: "david",
        personName: "David",
        companyId: "brex",
        nextStepAt: "2026-10-01T21:00:00.000Z",
        notes: "",
      },
      {
        id: "cold",
        personName: "Cold",
        companyId: "alloy",
        nextStepAt: "2026-09-30T16:00:00.000Z",
        notes: "",
      },
    ],
    drafts: [],
    companies: [
      { id: "brex", name: "Brex", priority: 20, northStar: false, tier: "other" },
      { id: "alloy", name: "Alloy", priority: 1, northStar: false, tier: "wave_1" },
    ],
    byLeadId: {
      david: { touch: { date: "2026-10-01T21:00:00.000Z", touchType: "call_follow_up", status: "planned" } },
      cold: { touch: { date: "2026-09-30T16:00:00.000Z", touchType: "hiring_leader_outreach", status: "planned" } },
    },
    readingThreads: [
      { id: "book", title: "DDD", done: false, currentSection: { title: "Ch 1" } },
    ],
  });
  assert.equal(items[0].id, "david");
  assert.equal(items[0].tier, TIER.WARM);
  const reading = items.find((row) => row.kind === "reading");
  assert.ok(reading);
  assert.equal(reading.tier, TIER.PREP);
  assert.equal(items.find((row) => row.id === "cold").tier, TIER.COLD);
});
