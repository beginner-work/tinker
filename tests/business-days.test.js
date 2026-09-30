/* Business-day helper: skip weekends. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { addBusinessDays, dayKey } = require("../api/_lib/business-days.js");

test("addBusinessDays skips Saturday and Sunday", () => {
  // Friday + 1 business day → Monday
  assert.equal(addBusinessDays("2026-10-02", 1), "2026-10-05");
  // Thursday + 5 business days → next Thursday
  assert.equal(addBusinessDays("2026-10-01", 5), "2026-10-08");
  // Friday + 5 business days skips weekend → next Friday
  assert.equal(addBusinessDays("2026-10-02", 5), "2026-10-09");
});

test("addBusinessDays from mid-week stays on weekdays", () => {
  assert.equal(addBusinessDays("2026-09-30", 1), "2026-10-01"); // Wed → Thu
  assert.equal(addBusinessDays("2026-09-30", 2), "2026-10-02"); // Wed → Fri
  assert.equal(addBusinessDays("2026-09-30", 3), "2026-10-05"); // Wed → Mon
});

test("dayKey normalizes ISO timestamps", () => {
  assert.equal(dayKey("2026-10-01T16:00:00.000Z"), "2026-10-01");
  assert.equal(dayKey("2026-10-01"), "2026-10-01");
});
