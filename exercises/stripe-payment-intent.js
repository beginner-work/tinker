/* Practice rep: Learn from docs - Stripe payments quickstart (test mode).
 * Spec + empty editor seed + hints only. Tests use a checked-in fixture (no network).
 */
(function (root) {
  "use strict";

  var rep = {
    id: "stripe-payment-intent",
    title: "Learn from docs: Stripe PaymentIntent (test mode)",
    summary: "Turn the Stripe payments quickstart into a small helper that reads a PaymentIntent create response - using a saved fixture, never a live API key.",
    tags: ["learn-from-docs", "stripe"],
    sourceNote: "Docs-to-rep demo from the Stripe payments quickstart (test mode). Fixture: practice/fixtures/stripe-payment-intent-create.json.",
    learnFromDocs: true,
    docsSource: "https://github.com/stripe/stripe-dotnet / Stripe API reference - PaymentIntents (prefer GitHub-published docs over scraping).",
    spec: [
      "Stripe's payments quickstart (test mode) creates a PaymentIntent and",
      "hands the browser a client_secret so Elements can confirm the payment.",
      "",
      "In Practice we never call Stripe. A sample create-response JSON is",
      "checked into the repo as a fixture. Your job is to read the fields",
      "the quickstart cares about.",
      "",
      "Write from scratch (pseudocode first is fine):",
      "",
      "  readPaymentIntentClient(fixture)",
      "    Input: fixture - the PaymentIntent create-response object",
      "    Output: an object with:",
      "      - clientSecret  ← fixture.client_secret",
      "      - amountCents  ← fixture.amount   (integer cents)",
      "      - currency     ← fixture.currency",
      "      - livemode     ← fixture.livemode (false for this test fixture)",
      "",
      "Export it so the tests can call it:",
      "  module.exports = { readPaymentIntentClient };",
      "",
      "Do not call fetch. Do not invent secrets. Use only the fixture object.",
    ].join("\n"),
    emptyPrompt: "// write readPaymentIntentClient(fixture)\n",
    hints: [
      "Stripe's PaymentIntent JSON uses snake_case: client_secret, not secret.",
      "amount is already integer cents (1099 means $10.99). There is no amount_dollars field on the create response.",
      "currency is a lowercase string like \"usd\". livemode is a boolean; the practice fixture is test mode (false).",
    ],
    tests: [
      {
        name: "reads client_secret from the fixture",
        body: [
          "var out = api.readPaymentIntentClient(fixtures.paymentIntent);",
          "assert.equal(out.clientSecret, fixtures.paymentIntent.client_secret);",
        ].join("\n"),
      },
      {
        name: "reads amount as integer cents",
        body: [
          "var out = api.readPaymentIntentClient(fixtures.paymentIntent);",
          "assert.equal(out.amountCents, 1099);",
        ].join("\n"),
      },
      {
        name: "reads currency and test-mode livemode",
        body: [
          "var out = api.readPaymentIntentClient(fixtures.paymentIntent);",
          "assert.equal(out.currency, \"usd\");",
          "assert.equal(out.livemode, false);",
        ].join("\n"),
      },
      {
        name: "fixture stays offline (no network fields required)",
        body: [
          "assert.equal(fixtures.paymentIntent.object, \"payment_intent\");",
          "assert.equal(fixtures.paymentIntent.livemode, false);",
          "assert.ok(String(fixtures.paymentIntent.id).indexOf(\"pi_\") === 0);",
        ].join("\n"),
      },
    ],
    fixtureUrl: "/practice/fixtures/stripe-payment-intent-create.json",
    fixtures: null,
  };

  root.TINKER_PRACTICE_REPS = root.TINKER_PRACTICE_REPS || [];
  root.TINKER_PRACTICE_REPS.push(rep);
})(typeof window !== "undefined" ? window : globalThis);
