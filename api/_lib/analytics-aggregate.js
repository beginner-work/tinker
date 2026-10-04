/* Aggregate first-party analytics events into the owner /metrics view.
 *
 * Pure functions over in-memory event rows so tests do not need Postgres.
 * Grouping for "top sources": utm_source first, then referrer host, then
 * "direct". Campaigns nest under each source.
 */

"use strict";

const FUNNEL_STEPS = [
  "page_view",
  "signin_gate_shown",
  "signup_completed",
  "first_words_typed",
  "keep_crafting_tapped",
  "this_is_everything_tapped",
  "save_succeeded",
];

function dayKey(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function subjectKey(ev) {
  const userId = ev && ev.userId ? String(ev.userId).trim() : "";
  if (userId) return "u:" + userId;
  const anon = ev && ev.anonymousId ? String(ev.anonymousId).trim() : "";
  return anon ? "a:" + anon : "";
}

function sourceLabel(ev) {
  const utm = ev && ev.utmSource ? String(ev.utmSource).trim().toLowerCase() : "";
  if (utm) return utm;
  const host = ev && ev.referrerHost ? String(ev.referrerHost).trim().toLowerCase() : "";
  if (host) return host;
  return "direct";
}

function campaignLabel(ev) {
  const c = ev && ev.utmCampaign ? String(ev.utmCampaign).trim().toLowerCase() : "";
  return c || "(none)";
}

function filterSince(events, days) {
  const n = Math.max(1, Number(days) || 7);
  const since = Date.now() - n * 24 * 60 * 60 * 1000;
  return (events || []).filter((ev) => {
    const t = ev && ev.ts instanceof Date ? ev.ts.getTime() : Date.parse(ev && ev.ts);
    return Number.isFinite(t) && t >= since;
  });
}

function funnelCounts(events, days) {
  const rows = filterSince(events, days);
  return FUNNEL_STEPS.map((name) => {
    const subjects = new Set();
    for (const ev of rows) {
      if (ev.name !== name) continue;
      const key = subjectKey(ev);
      if (key) subjects.add(key);
    }
    return { name, unique: subjects.size, total: rows.filter((e) => e.name === name).length };
  });
}

function dailyActiveWriters(events, days) {
  const rows = filterSince(events, days).filter((ev) =>
    ev.name === "first_words_typed"
    || ev.name === "writing_session_ended"
    || ev.name === "keep_crafting_tapped"
    || ev.name === "this_is_everything_tapped"
    || ev.name === "save_succeeded"
  );
  const byDay = new Map();
  for (const ev of rows) {
    const day = dayKey(ev.ts);
    if (!day) continue;
    const key = subjectKey(ev);
    if (!key) continue;
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day).add(key);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, set]) => ({ day, writers: set.size }));
}

/** Day-2 return: share of subjects with a page_view on day D who also
 *  had a page_view on day D+1 within the window. */
function day2ReturnRate(events, days) {
  const rows = filterSince(events, days).filter((ev) => ev.name === "page_view");
  const daysBySubject = new Map();
  for (const ev of rows) {
    const key = subjectKey(ev);
    const day = dayKey(ev.ts);
    if (!key || !day) continue;
    if (!daysBySubject.has(key)) daysBySubject.set(key, new Set());
    daysBySubject.get(key).add(day);
  }
  let eligible = 0;
  let returned = 0;
  for (const set of daysBySubject.values()) {
    const sorted = Array.from(set).sort();
    for (let i = 0; i < sorted.length; i++) {
      const d0 = sorted[i];
      const next = new Date(d0 + "T00:00:00.000Z");
      next.setUTCDate(next.getUTCDate() + 1);
      const d1 = next.toISOString().slice(0, 10);
      // Only count D when D+1 is still inside the observation window for
      // this cohort (i.e. the subject could have returned).
      const windowEnd = filterSince(events, days);
      const maxDay = windowEnd.reduce((m, ev) => {
        const k = dayKey(ev.ts);
        return k && k > m ? k : m;
      }, "");
      if (d1 > maxDay) continue;
      eligible += 1;
      if (set.has(d1)) returned += 1;
    }
  }
  return {
    eligible,
    returned,
    rate: eligible === 0 ? 0 : returned / eligible,
  };
}

function deviceSplit(events, days) {
  const rows = filterSince(events, days).filter((ev) => ev.name === "page_view");
  const counts = { phone: 0, tablet: 0, desktop: 0 };
  const subjects = {
    phone: new Set(),
    tablet: new Set(),
    desktop: new Set(),
  };
  for (const ev of rows) {
    const device = ev.deviceType === "phone" || ev.deviceType === "tablet" ? ev.deviceType : "desktop";
    counts[device] += 1;
    const key = subjectKey(ev);
    if (key) subjects[device].add(key);
  }
  return {
    phone: { total: counts.phone, unique: subjects.phone.size },
    tablet: { total: counts.tablet, unique: subjects.tablet.size },
    desktop: { total: counts.desktop, unique: subjects.desktop.size },
  };
}

function topSources(events, days) {
  // Prefer first-touch on the subject's earliest page_view in-window.
  const rows = filterSince(events, days)
    .filter((ev) => ev.name === "page_view")
    .slice()
    .sort((a, b) => {
      const ta = a.ts instanceof Date ? a.ts.getTime() : Date.parse(a.ts);
      const tb = b.ts instanceof Date ? b.ts.getTime() : Date.parse(b.ts);
      return ta - tb;
    });
  const firstBySubject = new Map();
  for (const ev of rows) {
    const key = subjectKey(ev);
    if (!key || firstBySubject.has(key)) continue;
    firstBySubject.set(key, ev);
  }
  const bySource = new Map();
  for (const ev of firstBySubject.values()) {
    const source = sourceLabel(ev);
    const campaign = campaignLabel(ev);
    if (!bySource.has(source)) {
      bySource.set(source, { source, subjects: 0, campaigns: new Map() });
    }
    const row = bySource.get(source);
    row.subjects += 1;
    row.campaigns.set(campaign, (row.campaigns.get(campaign) || 0) + 1);
  }
  return Array.from(bySource.values())
    .sort((a, b) => b.subjects - a.subjects)
    .map((row) => ({
      source: row.source,
      subjects: row.subjects,
      campaigns: Array.from(row.campaigns.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([campaign, subjects]) => ({ campaign, subjects })),
    }));
}

function summarize(events, days) {
  return {
    days: Math.max(1, Number(days) || 7),
    funnel: funnelCounts(events, days),
    dailyActiveWriters: dailyActiveWriters(events, days),
    day2Return: day2ReturnRate(events, days),
    deviceSplit: deviceSplit(events, days),
    topSources: topSources(events, days),
  };
}

module.exports = {
  FUNNEL_STEPS,
  filterSince,
  funnelCounts,
  dailyActiveWriters,
  day2ReturnRate,
  deviceSplit,
  topSources,
  sourceLabel,
  campaignLabel,
  subjectKey,
  summarize,
};
