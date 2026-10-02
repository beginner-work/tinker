/* Practice rep: Pacific wall-clock time across the 2026 DST fall-back.
 * Spec + failing starter + hints only. No solution ships with this file.
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
      "Implement two functions:",
      "",
      "  saveWallTime(dateYmd, hour, minute)",
      "    dateYmd is \"YYYY-MM-DD\". hour/minute are local wall-clock numbers",
      "    (9 and 0 mean 9:00 AM). Return a string you can store.",
      "",
      "  readWallTime(saved)",
      "    Take what saveWallTime returned. Return the wall-clock time in",
      "    America/Los_Angeles as \"HH:MM\" (24-hour, zero-padded).",
      "",
      "Rules:",
      "- Use the IANA zone America/Los_Angeles (not a hard-coded offset).",
      "- Do not call fetch or any network API.",
      "- The starter below fails the post-DST case on purpose.",
    ].join("\n"),
    starterCode: [
      "// BUG: always stamps -07:00 (PDT). After Nov 1, 2026 Pacific is",
      "// UTC-8, so a \"9:00 AM\" save for a November morning reads back as 8:00.",
      "function pad(n) {",
      "  return String(n).padStart(2, \"0\");",
      "}",
      "",
      "function saveWallTime(dateYmd, hour, minute) {",
      "  var stamped = dateYmd + \"T\" + pad(hour) + \":\" + pad(minute) + \":00.000-07:00\";",
      "  return new Date(stamped).toISOString();",
      "}",
      "",
      "function readWallTime(saved) {",
      "  var d = new Date(saved);",
      "  var parts = new Intl.DateTimeFormat(\"en-US\", {",
      "    timeZone: \"America/Los_Angeles\",",
      "    hour: \"2-digit\",",
      "    minute: \"2-digit\",",
      "    hour12: false,",
      "  }).formatToParts(d);",
      "  var hour = \"00\";",
      "  var minute = \"00\";",
      "  for (var i = 0; i < parts.length; i++) {",
      "    if (parts[i].type === \"hour\") hour = parts[i].value;",
      "    if (parts[i].type === \"minute\") minute = parts[i].value;",
      "  }",
      "  if (hour === \"24\") hour = \"00\";",
      "  return hour + \":\" + minute;",
      "}",
      "",
      "module.exports = { saveWallTime: saveWallTime, readWallTime: readWallTime };",
    ].join("\n"),
    hints: [
      "Hard-coding -07:00 only matches Pacific during daylight saving. After the fall-back, Pacific is UTC-8.",
      "Store the civil wall time (date + hour + minute + time zone name), or convert with the zone's real offset for that calendar day — not today's offset and not a fixed -07:00.",
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
