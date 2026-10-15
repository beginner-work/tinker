/* Checked-in list of learning exercise modules for Tinker Exercises.
 *
 * Coding modules open from tlindow/lindowlabs under exercises/<id>.
 * Keep ids identical to that folder name. External-only modules set
 * externalUrl and omit path.
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
    repo: "tlindow/lindowlabs",
    branch: "main",
    exercisesRoot: "exercises",
    modules: [
      {
        id: "api-design",
        name: "OpenAPI by hand (payments)",
        description:
          "Write an OpenAPI contract for a small payments API: PaymentIntent, Capture, Refund, and WebhookEvent. Steps 00 through 07, plain English then YAML.",
        topic: "API design",
        status: "Not started",
        path: "exercises/api-design",
        tags: [
          "api design",
          "openapi",
          "payments",
          "payment intent",
          "capture",
          "refund",
          "webhook",
          "yaml",
        ],
      },
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
        note: "Essay.",
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
