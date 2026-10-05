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
    readings: [
      {
        id: "domain-driven-design",
        name: "Domain-Driven Design",
        author: "Eric Evans",
        topic: "System design",
        status: "In progress",
        note: "Chapter 1 done; now on Chapter 2, Communication and the Use of Language.",
      },
      {
        id: "designing-data-intensive-applications",
        name: "Designing Data-Intensive Applications",
        author: "Martin Kleppmann",
        topic: "System design",
        status: "Not started",
        note: "",
      },
      {
        id: "payments-systems-us",
        name: "Payments Systems in the U.S.",
        author: "Glenbrook Partners",
        topic: "Payments",
        status: "Not started",
        note: "",
      },
    ],
  };
});
