/* Practice rep: Pacific wall-clock time across the 2026 DST fall-back.
 * Spec + empty editor seed + hints only. No solution ships with this file.
 */
(function (root) {
  "use strict";

  var rep = {
    id: "pacific-wall-time",
    title: "Keep 9:00 AM after daylight saving ends",
    summary: "A scheduling helper must keep a saved 9:00 AM America/Los_Angeles wall time at 9:00 AM after DST ends on Nov 1, 2026.",
    tags: ["from-tinker", "scheduling"],
    sourceNote: "Drawn from a real Tinker scheduling bug: a saved morning outreach time shifted when Pacific left daylight saving.",
    learnFromDocs: false,
    spec: [
      "Tinker lets you save an outreach time as a wall-clock time in America/Los_Angeles.",
      "If Tyler picks 9:00 AM, that must stay 9:00 AM on both sides of the daylight-saving change.",
      "",
      "Daylight saving ends on Sunday, Nov 1, 2026 (Pacific falls back from PDT/UTC-7 to PST/UTC-8).",
      "",
      "Write these from scratch (pseudocode first is fine):",
      "",
      "  saveWallTime(dateYmd, hour, minute)",
      "    Inputs: dateYmd is \"YYYY-MM-DD\"; hour and minute are local wall-clock",
      "    numbers (9 and 0 mean 9:00 AM).",
      "    Output: a string you can store and later pass to readWallTime.",
      "",
      "  readWallTime(saved)",
      "    Input: whatever saveWallTime returned.",
      "    Output: the wall-clock time in America/Los_Angeles as \"HH:MM\"",
      "    (24-hour, zero-padded), e.g. \"09:00\".",
      "",
      "Export both on module.exports so the tests can call them:",
      "  module.exports = { saveWallTime, readWallTime };",
      "",
      "Rules:",
      "- Use the IANA zone America/Los_Angeles (not a hard-coded offset).",
      "- Do not call fetch or any network API.",
    ].join("\n"),
    emptyPrompt: "// write saveWallTime(dateYmd, hour, minute) and readWallTime(saved)\n",
    hints: [
      "Hard-coding -07:00 only matches Pacific during daylight saving. After the fall-back, Pacific is UTC-8.",
      "Store the civil wall time (date + hour + minute + time zone name), or convert with the zone's real offset for that calendar day - not today's offset and not a fixed -07:00.",
      "Intl.DateTimeFormat (or Temporal, if you prefer) can format a UTC instant in America/Los_Angeles. The trick is building the right instant for a wall time on a specific date in that zone.",
    ],
    tests: [
      {
        name: "before DST ends, 9:00 AM stays 9:00 AM",
        body: [
          "var saved = api.saveWallTime(\"2026-10-15\", 9, 0);",
          "assert.equal(api.readWallTime(saved), \"09:00\");",
        ].join("\n"),
      },
      {
        name: "after DST ends (Nov 5, 2026), 9:00 AM stays 9:00 AM",
        body: [
          "var saved = api.saveWallTime(\"2026-11-05\", 9, 0);",
          "assert.equal(api.readWallTime(saved), \"09:00\");",
        ].join("\n"),
      },
      {
        name: "another post-DST morning also holds",
        body: [
          "var saved = api.saveWallTime(\"2026-11-02\", 9, 0);",
          "assert.equal(api.readWallTime(saved), \"09:00\");",
        ].join("\n"),
      },
    ],
  };

  root.TINKER_PRACTICE_REPS = root.TINKER_PRACTICE_REPS || [];
  root.TINKER_PRACTICE_REPS.push(rep);
})(typeof window !== "undefined" ? window : globalThis);
