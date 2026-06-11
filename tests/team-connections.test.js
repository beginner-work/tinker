/* Unit tests for /api/team/connections' state derivation.
 *
 * The connection is the mutual $9 handshake: sending someone $9 is the
 * request, sending $9 back is the accept. Beginner's webhook writes the
 * edges; this endpoint folds MY row into per-founder states.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/team/connections.js");
const { deriveStates } = __test__;

test("$9 both ways is connected; one way is waiting or incoming", () => {
  const states = deriveStates({
    sent: [
      { to: "user-connected", intentId: "pi_1", at: 100 },
      { to: "user-waiting", intentId: "pi_2", at: 200 },
    ],
    received: [
      { from: "user-connected", intentId: "pi_3", at: 300 },
      { from: "user-incoming", intentId: "pi_4", at: 400 },
    ],
  });
  const byId = Object.fromEntries(states.map((s) => [s.userId, s.state]));
  assert.equal(byId["user-connected"], "connected", "$9 each way");
  assert.equal(byId["user-waiting"], "waiting", "I sent; no reply yet");
  assert.equal(byId["user-incoming"], "incoming", "they sent; my move");
});

test("incoming requests sort first — they're waiting on you", () => {
  const states = deriveStates({
    sent: [{ to: "user-waiting", intentId: "pi_1", at: 999 }],
    received: [{ from: "user-incoming", intentId: "pi_2", at: 1 }],
  });
  assert.deepEqual(states.map((s) => s.state), ["incoming", "waiting"]);
});

test("malformed rows and edges degrade to empty, never throw", () => {
  assert.deepEqual(deriveStates(null), []);
  assert.deepEqual(deriveStates({ sent: "nope", received: 42 }), []);
  assert.deepEqual(
    deriveStates({ sent: [null, { intentId: "pi_x" }], received: [{}] }),
    [],
    "edges without a counterparty id are skipped",
  );
});

test("repeat sends to the same founder collapse to one state with the latest timestamp", () => {
  const states = deriveStates({
    sent: [
      { to: "user-b", intentId: "pi_1", at: 100 },
      { to: "user-b", intentId: "pi_2", at: 900 },
    ],
    received: [],
  });
  assert.equal(states.length, 1);
  assert.equal(states[0].state, "waiting");
  assert.equal(states[0].at, 900);
});
