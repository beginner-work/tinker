/* Business-day helpers (Mon–Fri). Weekends are skipped. */

"use strict";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n) {
  return String(n).padStart(2, "0");
}

function parseDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      0, 0, 0, 0,
    ));
  }
  const text = String(value || "").trim();
  const m = text.match(YMD);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0));
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function dayKey(value) {
  const d = parseDay(value);
  if (!d) return "";
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

function isWeekend(d) {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Add N business days to a date (skip Sat/Sun). N must be >= 0. */
function addBusinessDays(value, count) {
  const start = parseDay(value);
  if (!start) return "";
  let n = Number(count);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.floor(n);
  const d = new Date(start.getTime());
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) left -= 1;
  }
  // If the start itself was a weekend and count is 0, still return that day key.
  return dayKey(d);
}

module.exports = {
  dayKey,
  parseDay,
  isWeekend,
  addBusinessDays,
};
