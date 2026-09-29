/* TYL-64 calendar helpers: .ics + Google template links. No Google OAuth. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const calendar = require("../api/_lib/schedule-calendar.js");

test("ics export and google template urls stay read-only", () => {
  const sessions = [{
    session: {
      id: "s1", type: "company", title: "Tinker on Acme: recruiter note",
      startsAt: "2026-09-29T16:00:00.000Z", endsAt: "2026-09-29T17:00:00.000Z",
      productArea: "", concept: "", curriculumRef: "",
    },
    touches: [{ touch: { touchType: "recruiter_outreach", status: "planned" }, company: { name: "Acme" } }],
  }];
  const ics = calendar.buildIcs(sessions);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Tinker on Acme: recruiter note/);
  assert.doesNotMatch(ics, /never sends/i);
  const url = calendar.googleEventUrl(sessions[0].session, sessions[0].touches);
  assert.match(url, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(url, /action=TEMPLATE/);
  assert.equal(typeof calendar.calendarReadEnabled, "undefined");
  assert.equal(typeof calendar.listBusyEvents, "undefined");
});
