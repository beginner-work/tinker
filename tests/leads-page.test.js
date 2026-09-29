/* TYL-62 slice 2: /leads page structure. No drafts UI here (TYL-63). */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/leads/index.html"), "utf8");
const page = fs.readFileSync(path.join(root, "src/renderer/leads/leads.js"), "utf8");
const catalogSrc = fs.readFileSync(path.join(root, "src/renderer/leads/catalog.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "src/renderer/auth.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const store = require("../api/_lib/leads-store.js");

test("leads page wires sign-in, filters, import, and no drafts UI", () => {
  assert.match(html, /Keep every lead in one place/);
  assert.match(html, /Your assistant sends Gmail after you press Send/);
  assert.match(html, /id="leads-filter-stage"/);
  assert.match(html, /id="leads-filter-company"/);
  assert.match(html, /id="leads-import-text"/);
  assert.match(html, /id="leads-form"/);
  assert.match(html, /Draft messages live in Messages/);
  assert.match(html, /id="leads-drafts-link"/);
  assert.match(html, /leads__nav/);
  assert.match(html, /hairlines, no card-in-card/);
  assert.doesNotMatch(html, /\.leads__toolbar[^{]*\{[^}]*border-radius:\s*var\(--radius-card\)/);
  assert.match(html, /src="\/leads\/catalog\.js"/);
  assert.match(html, /src="\/leads\/leads\.js"/);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(page.includes("innerHTML"), false);
  assert.match(page, /textContent/);
  assert.match(page, /\/api\/leads\?action=/);
  assert.match(page, /sessionStorage.setItem\(RETURN_KEY, "\/leads"\)/);
  assert.match(page, /"import"/);
  assert.match(page, /"create"/);
  assert.match(page, /"edit"/);
  assert.equal(page.includes("approve"), false);
  assert.equal(page.includes("mark-sent"), false);
  assert.equal(page.includes("storyPartIds"), false);
  assert.doesNotMatch(html, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(page, /Tyler|tlindow|nanoengineering/i);
  assert.match(auth, /path !== "\/leads"/);
  assert.match(sw, /pathname === "\/leads"/);
  assert.match(vercel, /\/leads\/index\.html/);
});

test("catalog stages and sources match the store", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(catalogSrc, vm.createContext(sandbox));
  const catalog = sandbox.window.tinkerLeads;
  assert.equal(JSON.stringify(catalog.STAGES.map((item) => item.key)), JSON.stringify(store.STAGES));
  assert.equal(JSON.stringify(catalog.SOURCES.map((item) => item.key)), JSON.stringify(store.SOURCES));
  assert.equal(JSON.stringify(catalog.OUTCOMES.map((item) => item.key)), JSON.stringify(store.OUTCOMES));
});

test("signed-out /leads comes back to /leads after sign-in", () => {
  const map = {};
  const assigns = [];
  const sessionStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null; },
    setItem(key, value) { map[key] = String(value); },
    removeItem(key) { delete map[key]; },
  };
  const windowObj = { location: { assign(url) { assigns.push(String(url)); } } };
  vm.runInNewContext(page, vm.createContext({
    localStorage: { getItem() { return ""; }, setItem() {}, removeItem() {} },
    sessionStorage,
    document: { getElementById() { return {}; } },
    window: windowObj,
  }));
  assert.deepEqual(assigns, ["/"]);
  assert.equal(map.tinker_mcp_return, "/leads");

  const start = auth.indexOf("const MCP_RETURN_KEY");
  const call = "if (resumeMcpReturn()) return;";
  const end = auth.indexOf(call) + call.length;
  vm.runInNewContext(`(function () {\n${auth.slice(start, end)}\n})();`, vm.createContext({
    sessionStorage,
    window: windowObj,
    auth: { token: "signed-in-session" },
  }));
  assert.deepEqual(assigns, ["/", "/leads"]);
  assert.equal(map.tinker_mcp_return, undefined);

  function readBack(value) {
    map.tinker_mcp_return = value;
    const take = new Function(
      "sessionStorage",
      `${auth.slice(start, auth.indexOf("function resumeMcpReturn()"))}\nreturn takeMcpReturn;`,
    )(sessionStorage);
    return take();
  }
  assert.equal(readBack("/leads"), "/leads");
  assert.equal(readBack("/leads/extra"), "");
  assert.equal(readBack("//evil.example/leads"), "");
  assert.equal(readBack("/career"), "/career");
});
