/* Calendar dates for due dates / touch dates.
 * Date-only values (YYYY-MM-DD) are stored as UTC midnight and presented
 * back as plain YYYY-MM-DD so Pacific (and other) local TZ never shifts the day.
 */
"use strict";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const YMD_MIDNIGHT_Z = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0{1,3})?Z)?$/;

function pad(n) {
  return String(n).padStart(2, "0");
}

function ymdFromUtcParts(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function isUtcMidnight(d) {
  return d instanceof Date
    && !Number.isNaN(d.getTime())
    && d.getUTCHours() === 0
    && d.getUTCMinutes() === 0
    && d.getUTCSeconds() === 0
    && d.getUTCMilliseconds() === 0;
}

/** Parse a date field. Date-only strings become UTC midnight Date. */
function readCalendarDate(value, label, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw Object.assign(new Error(`${label} is required.`), { status: 400 });
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") {
    throw Object.assign(new Error(`${label} must be a date.`), { status: 400 });
  }
  const text = value.trim();
  const ymd = text.match(YMD);
  if (ymd) {
    return new Date(Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3], 0, 0, 0, 0));
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error(`${label} must be a date.`), { status: 400 });
  }
  return parsed;
}

/**
 * Present a stored date for API clients.
 * UTC-midnight / date-only values → YYYY-MM-DD; timed values → ISO.
 */
function presentCalendarDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const m = value.trim().match(YMD_MIDNIGHT_Z);
    if (m) return m[1];
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime()) && isUtcMidnight(parsed)) return ymdFromUtcParts(parsed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return value.trim();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    if (isUtcMidnight(value)) return ymdFromUtcParts(value);
    return value.toISOString();
  }
  return null;
}

/** Extract YYYY-MM-DD for display without local TZ shift. */
function calendarDayKey(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const m = value.trim().match(YMD_MIDNIGHT_Z);
    if (m) return m[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  if (isUtcMidnight(d) || (typeof value === "string" && YMD.test(value.trim()))) {
    return ymdFromUtcParts(d);
  }
  // Timed values: still use UTC day for schedule keys (existing behavior).
  return ymdFromUtcParts(d);
}

module.exports = {
  readCalendarDate,
  presentCalendarDate,
  calendarDayKey,
  isUtcMidnight,
};
