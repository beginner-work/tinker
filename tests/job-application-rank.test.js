/* Application sequencing in the flat inbox ranker.
 * Fake users only. Field shapes mirror fit-scan roles (Adyen, Brex, Figma,
 * Betterment, Ripple) without loading Tyler's account.
 */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rankInboxItems, COMPANY_SEQ, TIER } = require("../api/_lib/inbox-rank.js");
const { addBusinessDays } = require("../api/_lib/business-days.js");

const NOW = new Date("2026-10-03T17:00:00.000Z"); // Friday

function company(id, name, priority) {
  return { id, name, priority, northStar: false, tier: "wave_1" };
}

function person(partial) {
  return Object.assign({
    notes: "",
    stage: "new",
    queueOrder: 0,
    nextStep: "",
    nextStepAt: "",
    personTitle: "",
  }, partial);
}

const FIT_SCAN_SHAPE = [
  {
    roleTitle: "Engineering Manager, Issuing",
    companyName: "Adyen",
    postingUrl: "https://careers.adyen.com/vacancies/issuing-em",
    payRange: "$240k-$300k + equity",
    fitNotes: "Issuing in Chicago; equity has to carry it.",
  },
  {
    roleTitle: "Engineering Manager, Bill Pay",
    companyName: "Brex",
    postingUrl: "https://www.brex.com/careers/bill-pay-em",
    payRange: "$230k-$290k",
    fitNotes: "On hold until the Thursday feedback call.",
  },
  {
    roleTitle: "Engineering Manager, Platform",
    companyName: "Figma",
    postingUrl: "https://www.figma.com/careers/platform-em",
    payRange: "$250k-$320k + equity",
    fitNotes: "Product-minded platform leadership.",
  },
  {
    roleTitle: "Engineering Manager, API & Auth",
    companyName: "Betterment",
    postingUrl: "https://www.betterment.com/careers/api-auth-em",
    payRange: "$220k-$280k",
    fitNotes: "Developer-facing work in regulated fintech.",
  },
  {
    roleTitle: "Engineering Manager, Payments",
    companyName: "Ripple",
    postingUrl: "https://ripple.com/careers/payments-em",
    payRange: "$240k-$310k",
    fitNotes: "Payments rails and partner integrations.",
  },
];

test("fit-scan shaped applications expose role, posting, pay, fit notes", () => {
  const companies = FIT_SCAN_SHAPE.map((row, i) => company("c" + i, row.companyName, i + 10));
  const applications = FIT_SCAN_SHAPE.map((row, i) => Object.assign({
    id: "app_" + i,
    companyId: "c" + i,
    status: "open",
    referrerName: "",
    referrerPersonId: "",
  }, row));
  const items = rankInboxItems({
    leads: [],
    drafts: [],
    companies,
    byLeadId: {},
    readingThreads: [],
    applications,
    now: NOW,
  });
  assert.equal(items.length, 5);
  items.forEach((item) => {
    assert.equal(item.kind, "application");
    assert.ok(item.postingUrl);
    assert.ok(item.payRange);
    assert.ok(item.fitNotes);
    assert.match(item.rankReason, /apply/i);
  });
});

test("1. warm referral ask ranks before eng lead and application", () => {
  const items = rankInboxItems({
    leads: [
      person({
        id: "ref",
        personName: "Referral Friend",
        companyId: "fig",
        company: "Figma",
        contactType: "referrer",
        nextStepAt: "2026-10-03",
        stage: "new",
      }),
      person({
        id: "eng",
        personName: "Eng Lead",
        companyId: "fig",
        company: "Figma",
        contactType: "hiring_leader",
        nextStepAt: "2026-10-03",
        stage: "new",
      }),
    ],
    drafts: [],
    companies: [company("fig", "Figma", 1)],
    byLeadId: {
      ref: { touch: { date: "2026-10-03", touchType: "referral_outreach", status: "planned" } },
      eng: { touch: { date: "2026-10-03", touchType: "hiring_leader_outreach", status: "planned" } },
    },
    applications: [{
      id: "app_fig",
      roleTitle: "Engineering Manager, Platform",
      companyName: "Figma",
      companyId: "fig",
      postingUrl: "https://www.figma.com/careers/platform-em",
      payRange: "$250k-$320k + equity",
      fitNotes: "Product-minded platform leadership.",
      status: "open",
    }],
    now: NOW,
  });
  const ids = items.map((row) => row.id);
  assert.deepEqual(ids.slice(0, 3), ["ref", "eng", "app_fig"]);
  assert.equal(items[0].companySeq, COMPANY_SEQ.referrer);
  assert.equal(items[1].companySeq, COMPANY_SEQ.hiring_leader);
  assert.equal(items[2].companySeq, COMPANY_SEQ.application);
  assert.match(items[2].rankReason, /waiting · after referral/i);
});

test("2. eng lead peer outreach ranks before application and must not mention applying", () => {
  const items = rankInboxItems({
    leads: [
      person({
        id: "eng",
        personName: "Eng Lead",
        companyId: "rip",
        company: "Ripple",
        contactType: "hiring_leader",
        nextStepAt: "2026-10-03",
        stage: "new",
      }),
    ],
    drafts: [],
    companies: [company("rip", "Ripple", 2)],
    byLeadId: {
      eng: { touch: { date: "2026-10-03", touchType: "hiring_leader_outreach", status: "planned" } },
    },
    applications: [{
      id: "app_rip",
      roleTitle: "Engineering Manager, Payments",
      companyName: "Ripple",
      companyId: "rip",
      status: "open",
      postingUrl: "https://ripple.com/careers/payments-em",
      payRange: "$240k-$310k",
      fitNotes: "Payments rails.",
    }],
    now: NOW,
  });
  assert.equal(items[0].id, "eng");
  assert.equal(items[1].id, "app_rip");
  assert.match(items[0].rankReason, /eng lead · peer/i);
  assert.doesNotMatch(items[0].rankReason, /\bI just applied\b/i);
  assert.match(items[1].rankReason, /waiting · after eng lead/i);
});

test("3a. application becomes due when eng lead is marked talked/replied", () => {
  const items = rankInboxItems({
    leads: [
      person({
        id: "eng",
        personName: "Eng Lead",
        companyId: "bet",
        company: "Betterment",
        contactType: "hiring_leader",
        stage: "replied",
        nextStepAt: "2026-09-25",
      }),
    ],
    drafts: [{ leadId: "eng", status: "sent_by_owner", sentAt: "2026-09-25" }],
    companies: [company("bet", "Betterment", 3)],
    byLeadId: {},
    applications: [{
      id: "app_bet",
      roleTitle: "Engineering Manager, API & Auth",
      companyName: "Betterment",
      companyId: "bet",
      status: "open",
      postingUrl: "https://www.betterment.com/careers/api-auth-em",
      payRange: "$220k-$280k",
      fitNotes: "API platform.",
    }],
    includeSent: true,
    now: NOW,
  });
  const app = items.find((row) => row.id === "app_bet");
  assert.ok(app);
  assert.equal(app.waiting, false);
  assert.ok(app.dueDay);
  assert.match(app.rankReason, /apply · after eng lead talk/i);
});

test("3b. application due after 5 business days with no reply (skips weekends)", () => {
  // Sent Friday 2026-09-25 → +5 business days = Friday 2026-10-02
  const sentDay = "2026-09-25";
  const unlock = addBusinessDays(sentDay, 5);
  assert.equal(unlock, "2026-10-02");
  const items = rankInboxItems({
    leads: [
      person({
        id: "eng",
        personName: "Eng Lead",
        companyId: "ady",
        company: "Adyen",
        contactType: "hiring_leader",
        stage: "contacted",
        nextStepAt: sentDay,
        updatedAt: sentDay,
      }),
    ],
    drafts: [{ leadId: "eng", status: "sent_by_owner", sentAt: sentDay + "T16:00:00.000Z" }],
    companies: [company("ady", "Adyen", 4)],
    byLeadId: {},
    applications: [{
      id: "app_ady",
      roleTitle: "Engineering Manager, Issuing",
      companyName: "Adyen",
      companyId: "ady",
      status: "open",
      postingUrl: "https://careers.adyen.com/vacancies/issuing-em",
      payRange: "$240k-$300k + equity",
      fitNotes: "Issuing Chicago.",
    }],
    includeSent: true,
    now: new Date("2026-10-03T17:00:00.000Z"),
  });
  const app = items.find((row) => row.id === "app_ady");
  assert.ok(app);
  assert.equal(app.dueDay, unlock);
  assert.match(app.rankReason, /5 business days/i);
});

test("3c. application still waiting before 5 business days elapse", () => {
  const sentDay = "2026-10-01"; // Thursday
  const unlock = addBusinessDays(sentDay, 5);
  assert.equal(unlock, "2026-10-08");
  const items = rankInboxItems({
    leads: [
      person({
        id: "eng",
        personName: "Eng Lead",
        companyId: "brex",
        company: "Brex",
        contactType: "hiring_leader",
        stage: "contacted",
        updatedAt: sentDay,
      }),
    ],
    drafts: [{ leadId: "eng", status: "sent_by_owner", sentAt: sentDay }],
    companies: [company("brex", "Brex", 5)],
    byLeadId: {},
    applications: [{
      id: "app_brex",
      roleTitle: "Engineering Manager, Bill Pay",
      companyName: "Brex",
      companyId: "brex",
      status: "open",
      postingUrl: "https://www.brex.com/careers/bill-pay-em",
      payRange: "$230k-$290k",
      fitNotes: "Bill Pay.",
    }],
    includeSent: true,
    now: new Date("2026-10-03T17:00:00.000Z"),
  });
  const app = items.find((row) => row.id === "app_brex");
  assert.ok(app);
  assert.equal(app.waiting, true);
  assert.match(app.rankReason, new RegExp("waiting · eng lead sent · apply " + unlock));
});

test("4. recruiter waits until application done; then rankReason links I just applied", () => {
  const open = rankInboxItems({
    leads: [
      person({
        id: "rec",
        personName: "Recruiter",
        companyId: "fig",
        company: "Figma",
        contactType: "recruiter",
        nextStepAt: "2026-10-03",
        stage: "new",
      }),
    ],
    drafts: [],
    companies: [company("fig", "Figma", 1)],
    byLeadId: {
      rec: { touch: { date: "2026-10-03", touchType: "recruiter_outreach", status: "planned" } },
    },
    applications: [{
      id: "app_fig",
      roleTitle: "Engineering Manager, Platform",
      companyName: "Figma",
      companyId: "fig",
      status: "open",
      postingUrl: "https://www.figma.com/careers/platform-em",
      payRange: "$250k",
      fitNotes: "fit",
    }],
    now: NOW,
  });
  const waitingRec = open.find((row) => row.id === "rec");
  assert.ok(waitingRec);
  assert.match(waitingRec.rankReason, /waiting · after application/i);
  assert.equal(waitingRec.companySeq, COMPANY_SEQ.recruiter);

  const done = rankInboxItems({
    leads: [
      person({
        id: "rec",
        personName: "Recruiter",
        companyId: "fig",
        company: "Figma",
        contactType: "recruiter",
        nextStepAt: "2026-10-06",
        stage: "new",
      }),
    ],
    drafts: [],
    companies: [company("fig", "Figma", 1)],
    byLeadId: {
      rec: { touch: { date: "2026-10-06", touchType: "recruiter_outreach", status: "planned" } },
    },
    applications: [{
      id: "app_fig",
      roleTitle: "Engineering Manager, Platform",
      companyName: "Figma",
      companyId: "fig",
      status: "done",
      postingUrl: "https://www.figma.com/careers/platform-em",
      payRange: "$250k",
      fitNotes: "fit",
      doneAt: "2026-10-03",
    }],
    now: NOW,
  });
  const readyRec = done.find((row) => row.id === "rec");
  assert.ok(readyRec);
  assert.match(readyRec.rankReason, /I just applied for Engineering Manager, Platform/i);
  assert.ok(!done.find((row) => row.id === "app_fig"), "done applications are hidden from inbox");
});

test("dropped applications are hidden from inbox and do not gate recruiter", () => {
  const items = rankInboxItems({
    leads: [
      person({
        id: "rec",
        personName: "Recruiter",
        companyId: "brex",
        company: "Brex",
        contactType: "recruiter",
        nextStepAt: "2026-10-03",
        stage: "new",
      }),
    ],
    drafts: [],
    companies: [company("brex", "Brex", 5)],
    byLeadId: {
      rec: { touch: { date: "2026-10-03", touchType: "recruiter_outreach", status: "planned" } },
    },
    applications: [{
      id: "app_brex",
      roleTitle: "Engineering Manager, Bill Pay",
      companyName: "Brex",
      companyId: "brex",
      status: "dropped",
      postingUrl: "https://www.brex.com/careers/bill-pay-em",
      payRange: "$230k-$290k",
      fitNotes: "On hold.",
      droppedAt: "2026-10-01",
    }],
    now: NOW,
  });
  assert.ok(!items.find((row) => row.id === "app_brex"), "dropped applications are hidden from inbox");
  const rec = items.find((row) => row.id === "rec");
  assert.ok(rec);
  assert.doesNotMatch(rec.rankReason, /waiting · after application/i);
  assert.doesNotMatch(rec.rankReason, /I just applied/i);
});

test("full company order: referral → eng lead → application → recruiter", () => {
  const items = rankInboxItems({
    leads: [
      person({
        id: "ref",
        personName: "Naomi",
        companyId: "co",
        company: "Co",
        contactType: "referrer",
        nextStepAt: "2026-10-03",
        notes: "### __done__\n",
        stage: "contacted",
      }),
      person({
        id: "eng",
        personName: "Pat",
        companyId: "co",
        company: "Co",
        contactType: "hiring_leader",
        nextStepAt: "2026-10-03",
        stage: "replied",
      }),
      person({
        id: "rec",
        personName: "Sam",
        companyId: "co",
        company: "Co",
        contactType: "recruiter",
        nextStepAt: "2026-10-03",
        stage: "new",
      }),
    ],
    drafts: [],
    companies: [company("co", "Co", 1)],
    byLeadId: {
      ref: { touch: { date: "2026-10-03", touchType: "referral_outreach", status: "planned" } },
      eng: { touch: { date: "2026-10-03", touchType: "hiring_leader_outreach", status: "planned" } },
      rec: { touch: { date: "2026-10-03", touchType: "recruiter_outreach", status: "planned" } },
    },
    applications: [{
      id: "app",
      roleTitle: "EM",
      companyName: "Co",
      companyId: "co",
      status: "open",
      postingUrl: "https://example.com/job",
      payRange: "$200k",
      fitNotes: "fit",
    }],
    now: NOW,
  });
  assert.deepEqual(items.map((row) => row.id), ["ref", "eng", "app", "rec"]);
  assert.equal(items[0].tier, TIER.COLD);
  assert.match(items[2].rankReason, /apply · after eng lead talk/i);
  assert.match(items[3].rankReason, /waiting · after application/i);
});
