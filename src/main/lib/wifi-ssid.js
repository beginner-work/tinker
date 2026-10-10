/* Read the current Wi-Fi SSID (macOS). Pure runner injection for tests.
 *
 * Uses `networksetup -getairportnetwork` for the common Wi-Fi device
 * names. Returns "" when offline, unsupported, or not on Wi-Fi.
 */
"use strict";

const { execFile } = require("child_process");

const WIFI_DEVICES = ["en0", "en1", "Wi-Fi"];

function parseAirportNetworkLine(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return "";
  // "You are not associated with an AirPort network."
  if (/not associated/i.test(text)) return "";
  // "Current Wi-Fi Network: MyHotspot"
  const m = text.match(/Current Wi-Fi Network:\s*(.+)$/i);
  if (m && m[1]) return String(m[1]).trim();
  return "";
}

function readSsidViaNetworksetup(execFileFn, device) {
  return new Promise((resolve) => {
    const run = execFileFn || execFile;
    run(
      "networksetup",
      ["-getairportnetwork", device],
      { timeout: 4000, encoding: "utf8" },
      (err, stdout) => {
        if (err) {
          resolve("");
          return;
        }
        resolve(parseAirportNetworkLine(stdout));
      }
    );
  });
}

/**
 * @param {object} [opts]
 * @param {typeof execFile} [opts.execFile]
 * @param {string[]} [opts.devices]
 * @param {() => string} [opts.platform] - defaults to process.platform
 */
async function getCurrentSsid(opts) {
  const options = opts || {};
  const platform = typeof options.platform === "function"
    ? options.platform()
    : (options.platform || process.platform);
  if (platform !== "darwin") return "";
  const devices = Array.isArray(options.devices) && options.devices.length
    ? options.devices
    : WIFI_DEVICES;
  const run = options.execFile || execFile;
  for (let i = 0; i < devices.length; i += 1) {
    const ssid = await readSsidViaNetworksetup(run, devices[i]);
    if (ssid) return ssid;
  }
  return "";
}

module.exports = {
  WIFI_DEVICES,
  parseAirportNetworkLine,
  getCurrentSsid,
};
