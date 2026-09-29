/* TYL-64 /schedule page structure. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/schedule/index.html"), "utf8");
const page = fs.readFileSync(path.join(root, "src/renderer/schedule/schedule.js"), "utf8");
const catalogSrc = fs.readFileSync(path.join(root, "src/renderer/schedule/catalog.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "src/renderer/auth.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const store = require("../api/_lib/outreach-schedule-store.js");

test("schedule page wires week view, filters, and generic copy", () => {
  assert.match(html, /See which companies you reach out to when/);
  assert.match(html, /Tinker never sends a message for you/);
  assert.match(html, /id="schedule-week"/);
  assert.match(html, /id="schedule-filter-company"/);
  assert.match(html, /id="schedule-filter-touch"/);
  assert.match(html, /id="schedule-north-star"/);
  assert.match(html, /id="schedule-missing"/);
  assert.match(html, /id="schedule-session-form"/);
  assert.match(html, /id="schedule-touch-form"/);
  assert.match(html, /id="schedule-curriculum-name"/);
  assert.match(html, /id="schedule-export-ics"/);
  assert.match(page, /Add to Google Calendar/);
  assert.match(page, /action=export/);
  assert.match(page, /busyEvents/);
  assert.match(page, /event\.label \|\| event\.title/);
  assert.match(html, /schedule__block--busy/);
  assert.doesNotMatch(page, /GOOGLE_CALENDAR|accounts\.google\.com\/o\/oauth/);
  assert.doesNotMatch(html, /GOOGLE_CALENDAR|Connect Google/);
  assert.match(html, /src="\/schedule\/catalog\.js"/);
  assert.match(html, /src="\/schedule\/schedule\.js"/);
  assert.match(html, /@media \(max-width: 900px\)/);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(page.includes("innerHTML"), false);
  assert.match(page, /textContent/);
  assert.match(page, /\/api\/schedule\?action=/);
  assert.match(page, /sessionStorage.setItem\(RETURN_KEY, "\/schedule"\)/);
  assert.doesNotMatch(html, /Tyler|tlindow|Formation system design curriculum/i);
  assert.doesNotMatch(page, /Tyler|tlindow|nanoengineering/i);
  assert.match(auth, /path !== "\/schedule"/);
  assert.match(sw, /pathname === "\/schedule"/);
  assert.match(vercel, /\/schedule\/index\.html/);
});

test("schedule page layout stays flat without nested panels", () => {
  assert.doesNotMatch(html, /--schedule-band|linear-gradient/);
  assert.match(html, /\.schedule__toolbar,\s*\.schedule__panel,\s*\.schedule__pin,\s*\.schedule__missing\s*\{[^}]*border:\s*0/s);
  assert.match(html, /\.schedule__day\s*\{[^}]*border:\s*0/s);
  assert.match(html, /\.schedule__block\s*\{[^}]*background:\s*transparent/s);
  assert.match(html, /border-right:\s*1px solid var\(--schedule-line\)/);
  assert.match(html, /schedule__settings/);
});

test("catalog keys match the schedule store", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(catalogSrc, vm.createContext(sandbox));
  const catalog = sandbox.window.tinkerSchedule;
  assert.equal(JSON.stringify(catalog.TOUCH_TYPES.map((item) => item.key)), JSON.stringify(store.TOUCH_TYPES));
  assert.equal(JSON.stringify(catalog.TOUCH_STATUSES.map((item) => item.key)), JSON.stringify(store.TOUCH_STATUSES));
  assert.equal(JSON.stringify(catalog.SESSION_TYPES.map((item) => item.key)), JSON.stringify(store.SESSION_TYPES));
});

test("signed-out /schedule comes back to /schedule after sign-in", () => {
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
  assert.equal(map.tinker_mcp_return, "/schedule");

  const start = auth.indexOf("const MCP_RETURN_KEY");
  const call = "if (resumeMcpReturn()) return;";
  const end = auth.indexOf(call) + call.length;
  vm.runInNewContext(`(function () {\n${auth.slice(start, end)}\n})();`, vm.createContext({
    sessionStorage,
    window: windowObj,
    auth: { token: "session" },
  }));
  assert.equal(assigns[assigns.length - 1], "/schedule");
});
