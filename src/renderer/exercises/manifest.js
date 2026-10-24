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
      {
        id: "postgres",
        name: "Scaling Postgres",
        description:
          "45-minute drill: survive k6 by putting Postgres behind PgBouncer. Stretch covers a read replica and partitioning.",
        topic: "Databases",
        status: "Not started",
        path: "exercises/postgres",
        tags: [
          "postgres",
          "pgbouncer",
          "read replica",
          "partitioning",
          "k6",
          "explain analyze",
        ],
      },
      {
        id: "optimizely",
        name: "Optimizely at the edge",
        description:
          "45-minute drill: replace per-request network flag decisions with local Optimizely datafile evaluation and compare k6 latency.",
        topic: "Experimentation",
        status: "Not started",
        path: "exercises/optimizely",
        tags: [
          "optimizely",
          "feature flags",
          "a/b tests",
          "edge",
          "datafile",
          "k6",
        ],
      },
      {
        id: "vercel-ai-mcp",
        name: "Scaling agents (AI SDK + MCP)",
        description:
          "45-minute drill: move a single-flight AI SDK + MCP agent onto a concurrent job queue under k6. Stretch covers rate limits, caching, and parallel evals.",
        topic: "Agents",
        status: "Not started",
        path: "exercises/vercel-ai-mcp",
        tags: [
          "vercel ai sdk",
          "mcp",
          "agents",
          "queue",
          "rate limit",
          "evals",
          "k6",
        ],
      },
      {
        id: "prometheus-grafana",
        name: "Prometheus + Grafana under load",
        description:
          "45-minute drill: stop high-cardinality labels from exploding under k6. Stretch covers recording rules and SLO burn-rate alerts.",
        topic: "Reliability",
        status: "Not started",
        path: "exercises/prometheus-grafana",
        tags: [
          "prometheus",
          "grafana",
          "slo",
          "burn rate",
          "cardinality",
          "k6",
        ],
      },
      {
        id: "stripe",
        name: "Stripe webhooks at scale",
        description:
          "45-minute drill: stop Stripe webhook double processing with an idempotency ledger under burst replay. Stretch covers retries and a dead-letter queue.",
        topic: "Payments",
        status: "Not started",
        path: "exercises/stripe",
        tags: [
          "stripe",
          "webhooks",
          "idempotency",
          "dead letter queue",
          "stripe-mock",
          "k6",
        ],
      },
      {
        id: "redis",
        name: "Redis cache at scale",
        description:
          "45-minute drill: add Redis cache-aside with a TTL to a slow Postgres endpoint and compare k6 latency. Stretch covers invalidation and stampede protection.",
        topic: "Caching",
        status: "Not started",
        path: "exercises/redis",
        tags: [
          "redis",
          "cache-aside",
          "ttl",
          "invalidation",
          "stampede",
          "postgres",
          "k6",
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
