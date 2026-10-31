#!/usr/bin/env node
/* Local demo host for reading-widget screenshots.
 * Serves src/renderer static files and mocks /api/reading speak/ask/event,
 * but session create fetches a real public article (default: Sierra eng blog).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { fetchPage } = require("../api/_lib/fetch-page.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "src", "renderer");
const PORT = Number(process.env.PORT || 8791);
const DEFAULT_SIERRA_URL =
  process.env.READING_DEMO_ARTICLE_URL ||
  "https://sierra.ai/blog/gardening-week-evergreen-engineering";

const sessions = new Map();

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type":
      typeof body === "string"
        ? headers["Content-Type"] || "text/html; charset=utf-8"
        : "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function contentType(filePath) {
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function silentMp3Base64() {
  return Buffer.from([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]).toString("base64");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function companyHostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith("/api/reading")) {
    const action = url.searchParams.get("action") || "";
    try {
      if (action === "session" && req.method === "POST") {
        const body = await readBody(req);
        const articleUrl = String(body.url || DEFAULT_SIERRA_URL).trim() || DEFAULT_SIERRA_URL;
        const page = await fetchPage(articleUrl);
        const id = `rs_demo_${Date.now()}`;
        const words = String(page.text || "").split(/\s+/).filter(Boolean);
        sessions.set(id, {
          wordIndex: 0,
          url: page.sourceUrl,
          words,
          title: page.title,
          author: page.author,
          attribution: page.attribution,
        });
        return send(res, 200, {
          sessionId: id,
          sourceUrl: page.sourceUrl,
          title: page.title,
          author: page.author,
          siteName: page.siteName || "",
          wordCount: page.wordCount,
          companyHost: companyHostFromUrl(page.sourceUrl),
          linkCount: (page.links || []).length,
          voiceId: "ogwqBH5bbF03DSbNiRNN",
          preview: (page.paragraphs || []).slice(0, 2).join("\n\n").slice(0, 480),
          attribution: page.attribution,
          latencyMs: 12,
        });
      }
      if (action === "speak" && req.method === "POST") {
        const body = await readBody(req);
        const session = sessions.get(body.sessionId) || { words: [], url: DEFAULT_SIERRA_URL };
        const words = session.words || [];
        const from = Number(body.fromWordIndex) || 0;
        const to = Math.min(words.length, from + 18);
        const chunk = words.slice(from, to).join(" ");
        const done = to >= words.length;
        return send(res, 200, {
          sessionId: body.sessionId,
          audio: silentMp3Base64(),
          contentType: "audio/mpeg",
          voiceId: "ogwqBH5bbF03DSbNiRNN",
          fromWordIndex: from,
          toWordIndex: to,
          done,
          wordCount: words.length,
          chunkText: chunk,
          sourceUrl: session.url,
          title: session.title,
          author: session.author,
          attribution: session.attribution,
        });
      }
      if (action === "ask" && req.method === "POST") {
        const body = await readBody(req);
        const session = sessions.get(body.sessionId) || {
          url: DEFAULT_SIERRA_URL,
          title: "Gardening Week: Evergreen Engineering",
          author: "Mihai Parparita",
          attribution:
            "Gardening Week: Evergreen Engineering by Mihai Parparita (Sierra)",
        };
        const resume =
          body.position && typeof body.position.wordIndex === "number"
            ? body.position.wordIndex
            : 18;
        const answerText =
          "Sierra's Gardening Week is a dedicated stretch for evergreen engineering work between milestones. " +
          "Mihai Parparita describes investing in long-term codebase quality while keeping shipping speed. " +
          "Read the original on sierra.ai.";
        return send(res, 200, {
          answerText,
          audio: silentMp3Base64(),
          requestId: "demo_ask_1",
          latencyMs: 220,
          sessionId: body.sessionId,
          resumeWordIndex: resume,
          fetchedSource: false,
          fetchedSourceUrl: "",
          sourceUrl: session.url,
          title: session.title,
          author: session.author,
          attribution: session.attribution,
          linkedInUrl: "https://www.linkedin.com/in/tlindow",
          emailUrl: "mailto:tyler@lindowlabs.dev",
        });
      }
      if (action === "event" && req.method === "POST") {
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: "unknown action" });
    } catch (err) {
      return send(res, (err && err.status) || 500, {
        error: String(err && err.message) || "demo error",
      });
    }
  }

  let rel = url.pathname === "/" ? "/reading-widget/index.html" : url.pathname;
  if (rel === "/reading-widget" || rel === "/reading-widget/") {
    rel = "/reading-widget/index.html";
  }
  const filePath = path.join(ROOT, rel.replace(/^\//, ""));
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, "Not found");
  }
  return send(res, 200, fs.readFileSync(filePath, "utf8"), {
    "Content-Type": contentType(filePath),
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `reading-widget demo on http://127.0.0.1:${PORT}/reading-widget/?url=${encodeURIComponent(DEFAULT_SIERRA_URL)}`,
  );
});
