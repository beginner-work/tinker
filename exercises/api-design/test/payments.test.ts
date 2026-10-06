import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildApp } from "../src/app";
import { resetPaymentsStore } from "../src/payments";

afterEach(() => {
  resetPaymentsStore();
});

test("POST /payments creates a payment (happy path)", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/payments",
    headers: { "content-type": "application/json" },
    payload: {
      merchantId: "merch_123",
      amountCents: 2500,
      currency: "usd",
    },
  });

  assert.equal(res.statusCode, 201);
  const payment = res.json();
  assert.equal(payment.merchantId, "merch_123");
  assert.equal(payment.amountCents, 2500);
  assert.equal(payment.currency, "usd");
  assert.equal(payment.status, "pending");
  assert.equal(typeof payment.paymentId, "string");
  assert.ok(payment.paymentId.length > 0);
  assert.equal(typeof payment.createdAt, "string");
  assert.ok(payment.createdAt.length > 0);

  await app.close();
});

test("POST /payments rejects a non-positive amountCents with 400", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/payments",
    headers: { "content-type": "application/json" },
    payload: {
      merchantId: "merch_123",
      amountCents: 0,
      currency: "usd",
    },
  });

  assert.equal(res.statusCode, 400);
  const json = res.json();
  assert.equal(typeof json.error, "string");
  assert.ok(json.error.length > 0);

  await app.close();
});
