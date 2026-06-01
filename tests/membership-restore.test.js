/* Regression test for the sidebar "Already subscribed? Restore" action
 * (src/renderer/membership.js → startReconcile).
 *
 * The bug: on a successful restore the client used to discard the reconcile
 * response and re-pull GET /api/membership/status. loadStatus collapses any
 * non-ok/stale/blipped read to null, and hydrate renders null as "Free plan" —
 * so a member whose subscription was just reconciled server-side got bounced
 * straight back to "Free plan" ("clicking restore still says free").
 *
 * The fix renders the row straight from the (authoritative, freshly-written)
 * reconcile response. This test drives the real click path against a fake DOM
 * with a status endpoint that always fails, and asserts the row still flips to
 * the pre-seed tier and hides the restore affordance.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "membership.js"),
  "utf8",
);

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeEl(id) {
  return {
    id,
    _attrs: {},
    _text: "",
    dataset: {},
    _listeners: {},
    _kids: {},
    querySelector(sel) { return this._kids[sel] || null; },
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
    getAttribute(k) { return this._attrs[k]; },
    hasAttribute(k) { return k in this._attrs; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((f) => f()); },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
  };
}

// Builds the sandbox + DOM and runs membership.js. `statusFails` makes every
// GET /api/membership/status come back non-ok (the flaky/stale case).
function setup({ statusFails }) {
  const nav = makeEl("nav-membership");
  nav._kids = {
    "[data-membership-tier]": makeEl("tier"),
    "[data-membership-sub]": makeEl("sub"),
    "[data-membership-cta]": makeEl("cta"),
  };
  const restore = makeEl("nav-membership-restore");
  const byId = { "nav-membership": nav, "nav-membership-restore": restore };

  const calls = [];
  function fakeFetch(url) {
    calls.push(url);
    if (url.indexOf("/api/membership/reconcile") >= 0) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          restored: true, active: true, tier: "pre-seed",
          status: "active", currentPeriodEnd: 1782880160,
        }),
      });
    }
    // GET /api/membership/status — optionally simulate a transient failure.
    return Promise.resolve({
      ok: !statusFails,
      json: () => Promise.resolve(
        statusFails ? null : { active: false, tier: null, status: null, currentPeriodEnd: null }
      ),
    });
  }

  const sandbox = {
    fetch: fakeFetch,
    setTimeout: () => {},
    localStorage: { getItem: () => "fake-token", setItem() {}, removeItem() {} },
    document: { readyState: "complete", getElementById: (id) => byId[id] || null, addEventListener() {} },
    window: {},
  };
  sandbox.window.addEventListener = () => {};
  sandbox.window.location = { pathname: "/", origin: "https://tinker.app" };
  // Profile email is on file, so the first reconcile succeeds without a prompt.
  sandbox.window.prompt = () => "";
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  return { nav, restore, calls };
}

test("a successful restore flips the row to the pre-seed tier even if the status re-read fails", async () => {
  const { nav, restore, calls } = setup({ statusFails: true });
  await tick(); // initial hydrate() → status fails → free view

  assert.equal(nav._kids["[data-membership-tier]"]._text, "Free plan", "starts on the free view");

  restore.click();
  await tick();
  await tick();

  assert.equal(
    nav._kids["[data-membership-tier]"]._text,
    "Pre-seed · $9/mo",
    "row reflects the restored tier from the reconcile response, not a flaky status read",
  );
  assert.equal(nav.dataset.active, "1", "row is marked active");
  assert.ok(restore.hasAttribute("hidden"), "restore affordance is hidden once active");
  // The success path must not depend on a post-restore /status round-trip.
  assert.ok(
    !calls.some((u, i) => i > 0 && u.indexOf("/api/membership/status") >= 0 && calls[i - 1].indexOf("reconcile") >= 0),
    "does not re-pull /status after a successful reconcile",
  );
});

test("restore also works when the status re-read would (misleadingly) report free", async () => {
  const { nav, restore } = setup({ statusFails: false });
  await tick();

  restore.click();
  await tick();
  await tick();

  assert.equal(nav._kids["[data-membership-tier]"]._text, "Pre-seed · $9/mo");
});
