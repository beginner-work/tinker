/* Hotspot Wi-Fi trigger: fire once per join during work hours, with snooze.
 *
 * Pure helpers for Node tests. Electron main injects the clock and SSID
 * reader. Calendar-block awareness is a follow-up (not in this module).
 */
"use strict";

const DEFAULT_TIMEZONE = "America/Los_Angeles";

/** Default: Tue–Thu 9–20, Fri 9–15 (end hour exclusive), America/Los_Angeles. */
const DEFAULT_WINDOWS = [
  { days: [2, 3, 4], startHour: 9, endHour: 20 },
  { days: [5], startHour: 9, endHour: 15 },
];

function normalizeWindow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const days = Array.isArray(raw.days)
    ? raw.days.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
    : [];
  const startHour = Number(raw.startHour);
  const endHour = Number(raw.endHour);
  if (!days.length) return null;
  if (!Number.isFinite(startHour) || startHour < 0 || startHour > 23) return null;
  if (!Number.isFinite(endHour) || endHour < 0 || endHour > 24) return null;
  if (endHour <= startHour) return null;
  return {
    days: days.slice(),
    startHour: Math.floor(startHour),
    endHour: Math.floor(endHour),
  };
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const windows = Array.isArray(src.windows)
    ? src.windows.map(normalizeWindow).filter(Boolean)
    : [];
  return {
    enabled: !!src.enabled,
    ssid: String(src.ssid == null ? "" : src.ssid).trim(),
    timezone: String(src.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
    windows: windows.length ? windows : DEFAULT_WINDOWS.map((w) => ({
      days: w.days.slice(),
      startHour: w.startHour,
      endHour: w.endHour,
    })),
    snoozeUntil: src.snoozeUntil ? String(src.snoozeUntil) : null,
    // Runtime (persisted so a relaunch mid-connection does not re-fire):
    lastSeenSsid: src.lastSeenSsid == null ? "" : String(src.lastSeenSsid),
    firedForSsid: src.firedForSsid == null ? "" : String(src.firedForSsid),
  };
}

/**
 * Parts of `date` in `timeZone` (IANA). Falls back to local if Intl fails.
 */
function zonedParts(date, timeZone) {
  const d = date instanceof Date ? date : new Date(date);
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
      minute: "numeric",
    });
    const parts = fmt.formatToParts(d);
    const map = {};
    parts.forEach((p) => {
      if (p.type !== "literal") map[p.type] = p.value;
    });
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = weekdayMap[map.weekday];
    const hour = Number(map.hour);
    const minute = Number(map.minute);
    return {
      day: Number.isFinite(day) ? day : d.getDay(),
      hour: Number.isFinite(hour) ? hour : d.getHours(),
      minute: Number.isFinite(minute) ? minute : d.getMinutes(),
    };
  } catch {
    return { day: d.getDay(), hour: d.getHours(), minute: d.getMinutes() };
  }
}

function isWithinWorkHours(settings, now) {
  const cfg = normalizeSettings(settings);
  const parts = zonedParts(now || new Date(), cfg.timezone);
  for (let i = 0; i < cfg.windows.length; i += 1) {
    const w = cfg.windows[i];
    if (w.days.indexOf(parts.day) === -1) continue;
    if (parts.hour >= w.startHour && parts.hour < w.endHour) return true;
  }
  return false;
}

function isSnoozed(settings, now) {
  const cfg = normalizeSettings(settings);
  if (!cfg.snoozeUntil) return false;
  const until = Date.parse(cfg.snoozeUntil);
  if (!Number.isFinite(until)) return false;
  const t = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  return t < until;
}

/**
 * Evaluate an SSID sample. Returns { fire, settings } where settings is the
 * next persisted runtime state. Fires at most once per continuous presence
 * on the target SSID (leave + rejoin arms again).
 */
function evaluateWifiSample(settings, currentSsid, now) {
  const cfg = normalizeSettings(settings);
  const ssid = String(currentSsid == null ? "" : currentSsid).trim();
  const target = cfg.ssid;
  const next = Object.assign({}, cfg, { lastSeenSsid: ssid });

  if (!cfg.enabled || !target) {
    if (ssid !== cfg.firedForSsid) next.firedForSsid = "";
    return { fire: false, reason: "disabled", settings: next };
  }

  if (ssid !== target) {
    // Left the hotspot — arm for the next join.
    next.firedForSsid = "";
    return { fire: false, reason: "wrong-ssid", settings: next };
  }

  if (cfg.firedForSsid === target) {
    return { fire: false, reason: "already-fired", settings: next };
  }

  if (isSnoozed(cfg, now)) {
    return { fire: false, reason: "snoozed", settings: next };
  }

  if (!isWithinWorkHours(cfg, now)) {
    return { fire: false, reason: "outside-hours", settings: next };
  }

  next.firedForSsid = target;
  return { fire: true, reason: "join", settings: next };
}

function snoozeForMs(settings, ms, now) {
  const cfg = normalizeSettings(settings);
  const t = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  const duration = Number(ms);
  const until = Number.isFinite(duration) && duration > 0 ? t + duration : t;
  return Object.assign({}, cfg, { snoozeUntil: new Date(until).toISOString() });
}

function clearSnooze(settings) {
  const cfg = normalizeSettings(settings);
  return Object.assign({}, cfg, { snoozeUntil: null });
}

module.exports = {
  DEFAULT_TIMEZONE,
  DEFAULT_WINDOWS,
  normalizeSettings,
  normalizeWindow,
  zonedParts,
  isWithinWorkHours,
  isSnoozed,
  evaluateWifiSample,
  snoozeForMs,
  clearSnooze,
};
