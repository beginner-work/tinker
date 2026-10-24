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
        id: "vercel-ai-mcp",
        name: "Scaling agents (AI SDK + MCP)",
        description:
          "45-minute Tinker drill: diff baseline vs better agent files. Move from one-at-a-time stub LLM and MCP tools to a concurrent queue. Run node check.mjs.",
        topic: "Agents",
        status: "Not started",
        path: "exercises/vercel-ai-mcp",
        tags: [
          "vercel ai sdk",
          "mcp",
          "agents",
          "queue",
          "evals",
          "baseline",
          "better",
        ],
      },
      {
        id: "stripe",
        name: "Stripe webhooks at scale",
        description:
          "45-minute Tinker drill: diff baseline vs better webhook handlers. Add an idempotency ledger, retries, and a dead-letter queue. Run node check.mjs.",
        topic: "Payments",
        status: "Not started",
        path: "exercises/stripe",
        tags: [
          "stripe",
          "webhooks",
          "idempotency",
          "dead letter queue",
          "baseline",
          "better",
        ],
      },
      {
        id: "postgres",
        name: "Scaling Postgres",
        description:
          "45-minute Tinker drill: diff baseline vs better DB access. Replace connect-per-request with an in-process pool under fake load. Run node check.mjs.",
        topic: "Databases",
        status: "Not started",
        path: "exercises/postgres",
        tags: [
          "postgres",
          "connection pool",
          "baseline",
          "better",
        ],
      },
      {
        id: "optimizely",
        name: "Optimizely at the edge",
        description:
          "45-minute Tinker drill: diff baseline vs better flag decide. Replace a fake network hop with local datafile evaluation. Run node check.mjs.",
        topic: "Experimentation",
        status: "Not started",
        path: "exercises/optimizely",
        tags: [
          "optimizely",
          "feature flags",
          "datafile",
          "edge",
          "baseline",
          "better",
        ],
      },
      {
        id: "prometheus-grafana",
        name: "Metrics cardinality under load",
        description:
          "45-minute Tinker drill: diff baseline vs better metrics. Drop high-cardinality labels so series stay bounded. Run node check.mjs.",
        topic: "Reliability",
        status: "Not started",
        path: "exercises/prometheus-grafana",
        tags: [
          "prometheus",
          "grafana",
          "cardinality",
          "slo",
          "baseline",
          "better",
        ],
      },
      {
        id: "redis",
        name: "Redis cache at scale",
        description:
          "45-minute Tinker drill: diff baseline vs better reads. Add in-process cache-aside with a TTL on a hot key. Run node check.mjs.",
        topic: "Caching",
        status: "Not started",
        path: "exercises/redis",
        tags: [
          "redis",
          "cache-aside",
          "ttl",
          "baseline",
          "better",
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
