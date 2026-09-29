/* Read-side calendar helpers: .ics export and Add-to-Google links. No Google writes. */
"use strict";

function pad(n) { return String(n).padStart(2, "0"); }
function icsUtc(value) {
  const d = new Date(value);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function escapeText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function fold(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length) {
    out += `\r\n ${rest.slice(0, 74)}`;
    rest = rest.slice(74);
  }
  return out;
}
function sessionDescription(session, touches) {
  const parts = [];
  if (session.type === "skill") {
    parts.push(`Product area: ${session.productArea}`);
    parts.push(`Concept: ${session.concept}`);
    parts.push(`Curriculum: ${session.curriculumRef}`);
  } else {
    parts.push("Company craft session");
  }
  for (const item of touches || []) {
    const name = item.company && item.company.name ? item.company.name : "Company";
    parts.push(`${name}: ${item.touch.touchType} (${item.touch.status})`);
  }
  parts.push("Tinker never sends messages.");
  return parts.join("\n");
}
function googleEventUrl(session, touches) {
  const start = icsUtc(session.startsAt).replace(/Z$/, "");
  const end = icsUtc(session.endsAt).replace(/Z$/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: session.title || "Tinker session",
    dates: `${start}/${end}`,
    details: sessionDescription(session, touches),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
function buildIcs(sessions) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//tinker//outreach-schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const entry of sessions || []) {
    const session = entry.session;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${session.id}@tinker.schedule`);
    lines.push(`DTSTAMP:${icsUtc(new Date())}`);
    lines.push(`DTSTART:${icsUtc(session.startsAt)}`);
    lines.push(`DTEND:${icsUtc(session.endsAt)}`);
    lines.push(fold(`SUMMARY:${escapeText(session.title)}`));
    lines.push(fold(`DESCRIPTION:${escapeText(sessionDescription(session, entry.touches))}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

module.exports = {
  buildIcs, googleEventUrl, sessionDescription, icsUtc,
};
