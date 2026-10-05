/* Checked-in list of learning exercise modules in beginner-work/tinker.
 *
 * Add one object under modules[] to surface a new track (for example
 * api-design). Keep ids identical to the file or folder under exercises/.
 * External-only modules set externalUrl and omit path.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerExercisesManifest = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  return {
    repo: "beginner-work/tinker",
    branch: "main",
    exercisesRoot: "exercises",
    modules: [
      {
        id: "formation-persistent-storage",
        name: "Formation: Persistent Storage",
        description: "Current Formation system design module.",
        topic: "System design",
        status: "In progress",
        externalUrl: "https://formation.dev",
        tags: ["formation", "system design", "storage", "persistent"],
      },
      {
        id: "pacific-wall-time",
        name: "Keep 9:00 AM after daylight saving ends",
        description:
          "Keep a saved America/Los_Angeles wall time at 9:00 AM across the Nov 1, 2026 fall-back.",
        topic: "Scheduling",
        status: "Not started",
        path: "exercises/pacific-wall-time.js",
        tags: ["scheduling", "dst", "timezone", "pacific", "wall time"],
      },
      {
        id: "mark-touch-sent",
        name: "Sending a touch marks it sent",
        description:
          "markTouchSent(touch, sentAt) returns a new touch with status sent. From a real Tinker bug.",
        topic: "Outreach",
        status: "Not started",
        path: "exercises/mark-touch-sent.js",
        tags: ["outreach", "touch", "sent", "markTouchSent"],
      },
      {
        id: "stripe-payment-intent",
        name: "Stripe PaymentIntent (test mode)",
        description:
          "Read client_secret, amount, currency and livemode from a PaymentIntent create fixture, no network.",
        topic: "Payments",
        status: "Not started",
        path: "exercises/stripe-payment-intent.js",
        tags: ["stripe", "payments", "paymentintent", "fixture"],
      },
      // TODO: add api-design when that worksheet lands under exercises/api-design/.
    ],
    // Reading order is fixed.
    readings: [
      {
        id: "site-reliability-engineering",
        name: "Site Reliability Engineering",
        author: "Google",
        topic: "Reliability",
        note: "Chapters 3, 4, 6, 14 and 15.",
        link: "https://sre.google/sre-book/table-of-contents/",
      },
      {
        id: "domain-driven-design",
        name: "Domain-Driven Design",
        author: "Eric Evans",
        topic: "System design",
        note: "Cover to cover; Chapter 1 done; currently reading Chapter 2, Communication and the Use of Language.",
      },
      {
        id: "transformative-tools-for-thought",
        name: "How can we develop transformative tools for thought?",
        author: "Andy Matuschak and Michael Nielsen",
        topic: "Tools for thought",
        note: "Free essay.",
        link: "https://numinous.productions/ttft/",
      },
      {
        id: "typescript-react-foundations",
        name: "TypeScript and React foundations",
        author: "Official docs",
        topic: "Web",
        note: "Three short official pieces, each under an hour.",
        links: [
          {
            label: "Thinking in React",
            url: "https://react.dev/learn/thinking-in-react",
          },
          {
            label: "TypeScript for JavaScript Programmers",
            url: "https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html",
          },
          {
            label: "Using TypeScript",
            url: "https://react.dev/learn/typescript",
          },
        ],
      },
    ],
  };
});
