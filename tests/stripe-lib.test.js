/* Smoke tests for api/_lib/stripe.js — the thin Stripe REST client.
 * We stub global.fetch so the test stays in-process and verify the
 * price-discovery → session-create call chain matches what Stripe
 * expects on the wire.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const PAYMENT_LINK_URL = "https://buy.stripe.com/bJe5kx8Owdx70nA9973F605";

function installFetchStub(handlers) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    for (const [matcher, payload] of handlers) {
      if (matcher(url, init)) {
        const body = typeof payload === "function" ? await payload(url, init) : payload;
        return {
          ok: body.__status ? body.__status < 400 : true,
          status: body.__status || 200,
          json: async () => body.__body || body,
        };
      }
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: { message: "no handler matched" } }),
    };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

function freshModule() {
  // The module caches the discovered price id at module scope. Wipe
  // the require cache so each test gets a fresh module instance.
  delete require.cache[require.resolve("../api/_lib/stripe.js")];
  return require("../api/_lib/stripe.js");
}

test("discovers the pre-seed price id by matching the payment link URL", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  const { calls, restore } = installFetchStub([
    [(u) => u.startsWith("https://api.stripe.com/v1/payment_links?"), {
      data: [
        { id: "plink_other", url: "https://buy.stripe.com/other" },
        { id: "plink_target", url: PAYMENT_LINK_URL },
      ],
    }],
    [(u) => u.startsWith("https://api.stripe.com/v1/payment_links/plink_target/line_items"), {
      data: [{ price: { id: "price_test_preseed" } }],
    }],
  ]);
  try {
    const stripe = freshModule();
    const priceId = await stripe.discoverPreseedPriceId();
    assert.equal(priceId, "price_test_preseed");
    // Cached: second call should not hit fetch again.
    const before = calls.length;
    await stripe.discoverPreseedPriceId();
    assert.equal(calls.length, before, "second call should hit cache");
  } finally {
    restore();
  }
});

test("createCheckoutSession POSTs subscription mode with the discovered price and client_reference_id", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  const { calls, restore } = installFetchStub([
    [(u) => u.startsWith("https://api.stripe.com/v1/payment_links?"), {
      data: [{ id: "plink_target", url: PAYMENT_LINK_URL }],
    }],
    [(u) => u.startsWith("https://api.stripe.com/v1/payment_links/plink_target/line_items"), {
      data: [{ price: { id: "price_test_preseed" } }],
    }],
    [(u) => u === "https://api.stripe.com/v1/checkout/sessions", { id: "cs_test_xyz", url: "https://checkout.stripe.com/c/pay/cs_test_xyz" }],
  ]);
  try {
    const stripe = freshModule();
    const session = await stripe.createCheckoutSession({
      userId: "user-stytch-xyz",
      successUrl: "https://app.example/?stripe_session_id={CHECKOUT_SESSION_ID}",
    });
    assert.equal(session.id, "cs_test_xyz");
    const createCall = calls.find((c) => c.url === "https://api.stripe.com/v1/checkout/sessions");
    assert.ok(createCall, "should POST to /checkout/sessions");
    assert.equal(createCall.init.method, "POST");
    const body = createCall.init.body;
    assert.match(body, /mode=subscription/);
    assert.match(body, /line_items%5B0%5D%5Bprice%5D=price_test_preseed/);
    assert.match(body, /client_reference_id=user-stytch-xyz/);
    assert.match(body, /success_url=https%3A%2F%2Fapp\.example%2F%3Fstripe_session_id%3D%7BCHECKOUT_SESSION_ID%7D/);
  } finally {
    restore();
  }
});

test("retrieveCheckoutSession GETs the session by id", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  const { calls, restore } = installFetchStub([
    [(u) => u === "https://api.stripe.com/v1/checkout/sessions/cs_test_abc", { id: "cs_test_abc", payment_status: "paid" }],
  ]);
  try {
    const stripe = freshModule();
    const s = await stripe.retrieveCheckoutSession("cs_test_abc");
    assert.equal(s.payment_status, "paid");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, undefined);
  } finally {
    restore();
  }
});

test("503s when STRIPE_SECRET_KEY is not set", async () => {
  delete process.env.STRIPE_SECRET_KEY;
  const stripe = freshModule();
  await assert.rejects(
    () => stripe.retrieveCheckoutSession("cs_test_abc"),
    (err) => err.status === 503,
  );
});

test("throws 500 if the payment link is not present in the Stripe account", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  const { restore } = installFetchStub([
    [(u) => u.startsWith("https://api.stripe.com/v1/payment_links?"), { data: [] }],
  ]);
  try {
    const stripe = freshModule();
    await assert.rejects(
      () => stripe.discoverPreseedPriceId(),
      (err) => err.status === 500,
    );
  } finally {
    restore();
  }
});
