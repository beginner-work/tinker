/* Local static + mock API host for /schedule screenshots. Not for production. */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5179);
const ROOT = path.join(__dirname, "..", "src", "renderer");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const week = {
  weekStart: "2026-09-28T00:00:00.000Z",
  weekEnd: "2026-10-02T23:59:59.999Z",
  curriculumName: "My system design track",
  northStar: { id: "c1", name: "Acme", domain: "acme.com", northStar: true, status: "active", totalComp: 250000, totalCompSource: "levels", createdAt: null, updatedAt: null },
  companiesMissingTouch: [{ id: "c2", name: "Orbit", domain: "orbit.dev", northStar: false, status: "active", totalComp: null, totalCompSource: "", createdAt: null, updatedAt: null }],
  sessions: [
    {
      session: { id: "s1", type: "company", title: "Tinker on Acme: recruiter note", startsAt: "2026-09-29T16:00:00.000Z", endsAt: "2026-09-29T17:00:00.000Z", productArea: "", concept: "", curriculumRef: "", createdAt: null, updatedAt: null },
      touches: [{ touch: { id: "t1", companyId: "c1", touchType: "recruiter_outreach", date: "2026-09-29T00:00:00.000Z", windowStart: "09:00", windowEnd: "11:00", leadId: null, status: "planned", draftId: null, sessionId: "s1", createdAt: null, updatedAt: null }, company: { id: "c1", name: "Acme", northStar: true, status: "active" } }],
      googleCalendarUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Tinker+on+Acme",
    },
    {
      session: { id: "s2", type: "skill", title: "Build auth sessions", startsAt: "2026-09-30T15:00:00.000Z", endsAt: "2026-09-30T17:00:00.000Z", productArea: "auth", concept: "sessions", curriculumRef: "My system design track / week 3", createdAt: null, updatedAt: null },
      touches: [],
      googleCalendarUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Build+auth+sessions",
    },
  ],
  unscheduledTouches: [
    { touch: { id: "t2", companyId: "c1", touchType: "application", date: "2026-10-01T00:00:00.000Z", windowStart: "", windowEnd: "", leadId: null, status: "planned", draftId: null, sessionId: null, createdAt: null, updatedAt: null }, company: { id: "c1", name: "Acme", northStar: true, status: "active" } },
  ],
  busyEvents: [
    { label: "Interview loop", title: "Interview loop", startsAt: "2026-09-29T18:00:00.000Z", endsAt: "2026-09-29T19:00:00.000Z" },
    { label: "Team sync", title: "Team sync", startsAt: "2026-09-30T16:00:00.000Z", endsAt: "2026-09-30T16:30:00.000Z" },
  ],
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendFile(filePath, res) {
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/schedule")) {
    const action = url.searchParams.get("action") || "";
    if (req.method === "GET" && (action === "week" || action === "")) return sendJson(res, 200, week);
    if (req.method === "POST") return sendJson(res, 201, { ok: true });
    return sendJson(res, 400, { error: "Unknown action." });
  }
  if (url.pathname.startsWith("/api/leads")) {
    const action = url.searchParams.get("action") || "";
    if (action === "companies") {
      return sendJson(res, 200, { companies: [week.northStar, week.companiesMissingTouch[0]] });
    }
    if (action === "settings") return sendJson(res, 200, { settings: { curriculumName: week.curriculumName, defaultFromAddress: "", minTotalComp: null } });
    return sendJson(res, 400, { error: "Unknown action." });
  }
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  if (rel === "/schedule" || rel === "/schedule/") rel = "/schedule/index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  sendFile(filePath, res);
});

server.listen(PORT, () => {
  console.log("schedule demo on http://127.0.0.1:" + PORT + "/schedule");
});
