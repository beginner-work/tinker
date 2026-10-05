/* Practice rep: marking a touch sent.
 * Spec + empty editor seed + hints only. Isolated function - not the real data model.
 */
(function (root) {
  "use strict";

  var rep = {
    id: "mark-touch-sent",
    title: "Sending a touch marks it sent",
    summary: "When Tyler marks an outreach touch as sent, its status must become \"sent\" instead of staying \"planned\".",
    tags: ["from-tinker", "outreach"],
    sourceNote: "Drawn from a real Tinker bug: marking a touch sent left status at planned.",
    learnFromDocs: false,
    spec: [
      "Outreach touches start as status \"planned\".",
      "When Tyler finishes sending a message and marks the touch sent, the",
      "helper must return a new touch object.",
      "",
      "Write from scratch (pseudocode first is fine):",
      "",
      "  markTouchSent(touch, sentAt)",
      "    Inputs:",
      "      touch  - an object with at least { id, status, channel, ... }",
      "      sentAt - optional ISO timestamp string; when given, use it",
      "    Output: a NEW object (do not mutate touch) with:",
      "      - every field from touch",
      "      - status: \"sent\"",
      "      - sentAt: the sentAt argument, or a new ISO timestamp if omitted",
      "",
      "Export it so the tests can call it:",
      "  module.exports = { markTouchSent };",
      "",
      "Do not touch any real Tinker store, API, or database - fixtures only.",
    ].join("\n"),
    emptyPrompt: "// write markTouchSent(touch, sentAt)\n",
    hints: [
      "Object.assign copies fields you pass in. status stays \"planned\" unless you set it to \"sent\".",
      "Return a new object. Keep the original touch.id and other fields; change status to \"sent\" and set sentAt.",
      "Prefer the sentAt argument when the caller provides one, so tests can pass a fixed timestamp.",
    ],
    tests: [
      {
        name: "status becomes sent",
        body: [
          "var before = fixtures.plannedTouch;",
          "var after = api.markTouchSent(before, \"2026-10-02T16:00:00.000Z\");",
          "assert.equal(after.status, \"sent\");",
        ].join("\n"),
      },
      {
        name: "sentAt is recorded from the argument",
        body: [
          "var after = api.markTouchSent(fixtures.plannedTouch, \"2026-10-02T16:00:00.000Z\");",
          "assert.equal(after.sentAt, \"2026-10-02T16:00:00.000Z\");",
        ].join("\n"),
      },
      {
        name: "input touch is not mutated",
        body: [
          "var before = {",
          "  id: fixtures.plannedTouch.id,",
          "  status: fixtures.plannedTouch.status,",
          "  channel: fixtures.plannedTouch.channel,",
          "};",
          "api.markTouchSent(before, \"2026-10-02T16:00:00.000Z\");",
          "assert.equal(before.status, \"planned\");",
          "assert.equal(before.sentAt, undefined);",
        ].join("\n"),
      },
    ],
    fixtures: {
      plannedTouch: {
        id: "touch_practice_1",
        leadId: "lead_practice_1",
        channel: "email",
        status: "planned",
        plannedFor: "2026-10-02",
      },
    },
  };

  root.TINKER_PRACTICE_REPS = root.TINKER_PRACTICE_REPS || [];
  root.TINKER_PRACTICE_REPS.push(rep);
})(typeof window !== "undefined" ? window : globalThis);
