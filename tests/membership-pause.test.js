/* Unit tests for pausing / resuming a pre-seed membership:
 *   - stripe-pause.js       the pause/resume update-param builder
 *   - stripe-reconcile.js   effectiveSubscriptionStatus + paused pick/mapping
 *   - membership.js         isPausedMembership predicate
 *   - stripe-webhook.js     a paused subscription maps to status "paused"
 *   - membership-reconcile  shouldAutoReconcile skips a known-paused row
 *   - membership.js (client) the sidebar's paused view + pause/resume action
 *
 * All pure functions, so no Stytch/Prisma/network stubbing needed.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { buildPauseParams } = require("../api/_lib/stripe-pause.js");
const {
  effectiveSubscriptionStatus,
  membershipFromSubscription,
  pickMembershipFromSubscriptions,
} = require("../api/_lib/stripe-reconcile.js");
const { isActiveMembership, isPausedMembership, PRESEED_TIER } = require("../api/_lib/membership.js");
const { membershipFromEvent } = require("../api/_lib/stripe-webhook.js");
const { shouldAutoReconcile } = require("../api/_lib/membership-reconcile.js");

// ── Pause param builder ─────────────────────────────────────────────────────

test("buildPauseParams pauses by setting pause_collection behavior=void", () => {
  const p = buildPauseParams({ resume: false });
  assert.equal(p.get("pause_collection[behavior]"), "void");
  assert.equal(p.get("pause_collection"), null);
});

test("buildPauseParams (no arg) defaults to pausing", () => {
  assert.equal(buildPauseParams().get("pause_collection[behavior]"), "void");
});

test("buildPauseParams resume clears pause_collection with an empty value", () => {
  const p = buildPauseParams({ resume: true });
  assert.equal(p.get("pause_collection"), "");
  assert.equal(p.get("pause_collection[behavior]"), null);
});

// ── effectiveSubscriptionStatus ─────────────────────────────────────────────

test("effectiveSubscriptionStatus surfaces paused when pause_collection is set", () => {
  // Stripe keeps a paused subscription's own status at "active".
  assert.equal(
    effectiveSubscriptionStatus({ status: "active", pause_collection: { behavior: "void" } }),
    "paused",
  );
});

test("effectiveSubscriptionStatus passes Stripe status through when not paused", () => {
  assert.equal(effectiveSubscriptionStatus({ status: "active", pause_collection: null }), "active");
  assert.equal(effectiveSubscriptionStatus({ status: "canceled" }), "canceled");
  assert.equal(effectiveSubscriptionStatus(null), null);
});

// ── Entitlement predicates ──────────────────────────────────────────────────

test("a paused membership is not entitling but is recognized as paused", () => {
  const paused = { tier: PRESEED_TIER, status: "paused" };
  assert.equal(isActiveMembership(paused), false);
  assert.equal(isPausedMembership(paused), true);
  assert.equal(isPausedMembership({ tier: PRESEED_TIER, status: "active" }), false);
  assert.equal(isPausedMembership({ status: "paused" }), false, "no tier = not a member");
  assert.equal(isPausedMembership(null), false);
});

// ── Subscription → blob mapping ─────────────────────────────────────────────

test("membershipFromSubscription records a paused sub as status paused", () => {
  const blob = membershipFromSubscription({
    id: "sub_p",
    customer: "cus_p",
    status: "active",
    pause_collection: { behavior: "void" },
    items: { data: [{ current_period_end: 1782880160 }] },
  });
  assert.deepEqual(blob, {
    tier: PRESEED_TIER,
    status: "paused",
    stripeCustomerId: "cus_p",
    stripeSubscriptionId: "sub_p",
    currentPeriodEnd: 1782880160,
  });
});

test("pickMembershipFromSubscriptions surfaces a lone paused sub so it can resume", () => {
  const blob = pickMembershipFromSubscriptions([
    { id: "sub_p", customer: "cus_p", status: "active", pause_collection: { behavior: "void" } },
  ]);
  assert.equal(blob.status, "paused");
  assert.equal(blob.stripeSubscriptionId, "sub_p");
});

test("pickMembershipFromSubscriptions prefers an active sub over a paused one", () => {
  const blob = pickMembershipFromSubscriptions([
    { id: "sub_p", customer: "c", status: "active", pause_collection: { behavior: "void" } },
    { id: "sub_a", customer: "c", status: "active", current_period_end: 100 },
  ]);
  assert.equal(blob.status, "active");
  assert.equal(blob.stripeSubscriptionId, "sub_a");
});

// ── Webhook mapping ─────────────────────────────────────────────────────────

test("subscription.updated with pause_collection records status paused", () => {
  const m = membershipFromEvent({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_9",
        customer: "cus_9",
        status: "active",
        pause_collection: { behavior: "void" },
        metadata: { userId: "user-9" },
        items: { data: [{ current_period_end: 1782880160 }] },
      },
    },
  });
  assert.equal(m.userId, "user-9");
  assert.equal(m.data.status, "paused");
  assert.equal(m.data.currentPeriodEnd, 1782880160);
});

test("subscription.updated clearing the pause records active again", () => {
  const m = membershipFromEvent({
    type: "customer.subscription.updated",
    data: {
      object: { id: "sub_9", customer: "cus_9", status: "active", pause_collection: null, metadata: { userId: "user-9" } },
    },
  });
  assert.equal(m.data.status, "active");
});

// ── Auto-reconcile throttle ─────────────────────────────────────────────────

test("shouldAutoReconcile skips a row already known to be paused", () => {
  // A paused row is the correct answer; bridging exists to recover MISSING
  // entitlement, not to re-probe a known-dormant subscription every load.
  assert.equal(shouldAutoReconcile({ tier: PRESEED_TIER, status: "paused" }, 0), false);
  // A genuinely free row still triggers a (cooldown-bounded) probe.
  assert.equal(shouldAutoReconcile({ tier: PRESEED_TIER, status: "canceled" }, 0), true);
});

// ── Client formatter ────────────────────────────────────────────────────────

function loadFormatter() {
  const SRC = fs.readFileSync(path.resolve(__dirname, "..", "src", "renderer", "membership.js"), "utf8");
  const sandbox = {
    window: {},
    document: { readyState: "complete", getElementById() { return null; }, addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  sandbox.window.addEventListener = () => {};
  sandbox.window.location = { pathname: "/", origin: "https://tinker.app" };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.tinkerMembership.formatMembership;
}

test("an active member is offered a pause action", () => {
  const view = loadFormatter()({ active: true, tier: "pre-seed", status: "active" });
  assert.equal(view.pause, "pause");
  assert.equal(view.restore, false);
});

test("a paused membership keeps its tier and offers resume, not upgrade", () => {
  const view = loadFormatter()({ active: false, tier: "pre-seed", status: "paused" });
  assert.equal(view.active, false);
  assert.equal(view.label, "Pre-seed · Paused");
  assert.equal(view.sub, "Billing paused — resume anytime");
  assert.equal(view.cta, "", "paused is not nudged to upgrade");
  assert.equal(view.restore, false);
  assert.equal(view.pause, "resume");
});

test("a free account has no pause action", () => {
  assert.equal(loadFormatter()({ active: false, tier: null, status: null }).pause, "");
});
