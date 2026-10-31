#!/usr/bin/env node
/* Local demo host for reading-widget screenshots.
 * Serves src/renderer static files and mocks /api/reading actions.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "src", "renderer");
const PORT = Number(process.env.PORT || 8791);

const SAMPLE_TEXT = [
  "Tyler Lindow built Tinker as a quiet writing surface.",
  "This sample essay is first-party demo copy for the reading agent milestone.",
  "The reader fetches a public URL at runtime, speaks the page aloud, and answers interrupt questions grounded in the article.",
  "When a question needs a linked source, Claude can fetch that outbound link, then resume where the listener left off.",
  "Attribution always points back to the original article and its author.",
].join(" ");

const WORDS = SAMPLE_TEXT.split(/\s+/);

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
  // Minimal valid-ish MPEG frame placeholder; browsers may no-op play.
  return Buffer.from([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]).toString("base64");
}

const sessions = new Map();

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith("/api/reading")) {
    const action = url.searchParams.get("action") || "";
    try {
      if (action === "session" && req.method === "POST") {
        const body = await readBody(req);
        const id = `rs_demo_${Date.now()}`;
        sessions.set(id, { wordIndex: 0, url: body.url || "" });
        return send(res, 200, {
          sessionId: id,
          sourceUrl: body.url || "https://lindowlabs.dev/essays/demo",
          title: "Sample essay for the reading agent",
          author: "Tyler Lindow",
          wordCount: WORDS.length,
          companyHost: "lindowlabs.dev",
          linkCount: 1,
          voiceId: "ogwqBH5bbF03DSbNiRNN",
          preview: SAMPLE_TEXT.slice(0, 180),
          attribution: "Sample essay for the reading agent by Tyler Lindow",
          latencyMs: 12,
        });
      }
      if (action === "speak" && req.method === "POST") {
        const body = await readBody(req);
        const from = Number(body.fromWordIndex) || 0;
        const to = Math.min(WORDS.length, from + 18);
        const chunk = WORDS.slice(from, to).join(" ");
        const done = to >= WORDS.length;
        return send(res, 200, {
          sessionId: body.sessionId,
          audio: silentMp3Base64(),
          contentType: "audio/mpeg",
          voiceId: "ogwqBH5bbF03DSbNiRNN",
          fromWordIndex: from,
          toWordIndex: to,
          done,
          wordCount: WORDS.length,
          chunkText: chunk,
          sourceUrl: "https://lindowlabs.dev/essays/demo",
          title: "Sample essay for the reading agent",
          author: "Tyler Lindow",
          attribution: "Sample essay for the reading agent by Tyler Lindow",
        });
      }
      if (action === "ask" && req.method === "POST") {
        const body = await readBody(req);
        const resume =
          body.position && typeof body.position.wordIndex === "number"
            ? body.position.wordIndex
            : 18;
        return send(res, 200, {
          answerText:
            "In this sample, the reading agent answers from the page itself. It attributes the claim to Tyler and will resume at your interrupt point.",
          audio: silentMp3Base64(),
          requestId: "demo_ask_1",
          latencyMs: 220,
          sessionId: body.sessionId,
          resumeWordIndex: resume,
          fetchedSource: false,
          fetchedSourceUrl: "",
          sourceUrl: "https://lindowlabs.dev/essays/demo",
          title: "Sample essay for the reading agent",
          author: "Tyler Lindow",
          attribution: "Sample essay for the reading agent by Tyler Lindow",
          linkedInUrl: "https://www.linkedin.com/in/tlindow",
          emailUrl: "mailto:tyler@lindowlabs.dev",
        });
      }
      if (action === "event" && req.method === "POST") {
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: "unknown action" });
    } catch (err) {
      return send(res, 500, { error: String(err && err.message) });
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
  console.log(`reading-widget demo on http://127.0.0.1:${PORT}/reading-widget/?url=${encodeURIComponent("https://lindowlabs.dev/essays/demo")}`);
});
