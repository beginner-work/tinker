/* Hotspot Wi-Fi trigger: work hours, once-per-join, snooze. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const hotspot = require("../src/main/lib/hotspot-trigger.js");
const wifi = require("../src/main/lib/wifi-ssid.js");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
const settingsHtml = fs.readFileSync(
  path.join(root, "src/renderer/settings/index.html"),
  "utf8"
);
const settingsJs = fs.readFileSync(
  path.join(root, "src/renderer/settings/settings.js"),
  "utf8"
);

/** Tuesday 2026-10-06 10:00 America/Los_Angeles */
function tueMorning() {
  return new Date("2026-10-06T17:00:00.000Z");
}

/** Friday 2026-10-09 10:00 America/Los_Angeles */
function friMorning() {
  return new Date("2026-10-09T17:00:00.000Z");
}

/** Friday 2026-10-09 16:00 America/Los_Angeles (after 3pm) */
function friAfternoon() {
  return new Date("2026-10-09T23:00:00.000Z");
}

/** Saturday 2026-10-10 10:00 America/Los_Angeles */
function satMorning() {
  return new Date("2026-10-10T17:00:00.000Z");
}

test("default windows are Tue-Thu 9-20 and Fri 9-15 PT", () => {
  const cfg = hotspot.normalizeSettings({});
  assert.equal(cfg.timezone, "America/Los_Angeles");
  assert.deepEqual(cfg.windows, hotspot.DEFAULT_WINDOWS);
  assert.equal(hotspot.isWithinWorkHours(cfg, tueMorning()), true);
  assert.equal(hotspot.isWithinWorkHours(cfg, friMorning()), true);
  assert.equal(hotspot.isWithinWorkHours(cfg, friAfternoon()), false);
  assert.equal(hotspot.isWithinWorkHours(cfg, satMorning()), false);
});

test("fires once per join on matching SSID during work hours", () => {
  let state = hotspot.normalizeSettings({
    enabled: true,
    ssid: "TylerHotspot",
  });
  const first = hotspot.evaluateWifiSample(state, "TylerHotspot", tueMorning());
  assert.equal(first.fire, true);
  assert.equal(first.reason, "join");
  state = first.settings;

  const again = hotspot.evaluateWifiSample(state, "TylerHotspot", tueMorning());
  assert.equal(again.fire, false);
  assert.equal(again.reason, "already-fired");

  const left = hotspot.evaluateWifiSample(again.settings, "CoffeeShop", tueMorning());
  assert.equal(left.fire, false);
  assert.equal(left.settings.firedForSsid, "");

  const rejoined = hotspot.evaluateWifiSample(left.settings, "TylerHotspot", tueMorning());
  assert.equal(rejoined.fire, true);
});

test("does not fire when disabled, wrong SSID, snoozed, or outside hours", () => {
  const base = { enabled: true, ssid: "TylerHotspot" };
  assert.equal(
    hotspot.evaluateWifiSample({ enabled: false, ssid: "TylerHotspot" }, "TylerHotspot", tueMorning()).fire,
    false
  );
  assert.equal(
    hotspot.evaluateWifiSample(base, "OtherNet", tueMorning()).fire,
    false
  );
  assert.equal(
    hotspot.evaluateWifiSample(base, "TylerHotspot", friAfternoon()).fire,
    false
  );
  const snoozed = hotspot.snoozeForMs(base, 60 * 60 * 1000, tueMorning());
  assert.equal(
    hotspot.evaluateWifiSample(snoozed, "TylerHotspot", tueMorning()).fire,
    false
  );
  assert.equal(hotspot.isSnoozed(snoozed, tueMorning()), true);
  const cleared = hotspot.clearSnooze(snoozed);
  assert.equal(hotspot.isSnoozed(cleared, tueMorning()), false);
});

test("wifi SSID parser understands networksetup output", () => {
  assert.equal(
    wifi.parseAirportNetworkLine("Current Wi-Fi Network: TylerHotspot"),
    "TylerHotspot"
  );
  assert.equal(
    wifi.parseAirportNetworkLine("You are not associated with an AirPort network."),
    ""
  );
});

test("wifi getter returns empty on non-darwin", async () => {
  const ssid = await wifi.getCurrentSsid({ platform: () => "linux" });
  assert.equal(ssid, "");
});

test("desktop shell wires hotspot IPC, poll, and /next lock-in navigation", () => {
  assert.match(mainJs, /hotspot-trigger\.js/);
  assert.match(mainJs, /startHotspotWatcher/);
  assert.match(mainJs, /hotspot:getSettings/);
  assert.match(mainJs, /hotspot:setSettings/);
  assert.match(mainJs, /hotspot:snooze/);
  assert.match(mainJs, /\/next\?lockin=1/);
  assert.match(mainJs, /Calendar-block awareness is a follow-up/);
  assert.match(mainJs, /app:setFullScreen/);
  assert.match(preloadJs, /getHotspotSettings/);
  assert.match(preloadJs, /setFullScreen/);
  assert.match(preloadJs, /snoozeHotspot/);
});

test("settings page exposes hotspot SSID field and snooze", () => {
  assert.match(settingsHtml, /settings-hotspot/);
  assert.match(settingsHtml, /Start my next exercise when I join Wi-Fi/);
  assert.match(settingsHtml, /data-hotspot-ssid/);
  assert.match(settingsHtml, /data-hotspot-enabled/);
  assert.match(settingsHtml, /data-hotspot-snooze/);
  assert.match(settingsHtml, /Calendar-block awareness is a follow-up/);
  assert.match(settingsJs, /getHotspotSettings/);
  assert.match(settingsJs, /snoozeHotspot/);
  assert.match(settingsJs, /loadHotspot/);
});
