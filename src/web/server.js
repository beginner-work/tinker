/* tinker — web host
 *
 * Serves the renderer (the same files Electron and Capacitor load) over HTTP,
 * and proxies a small set of routes to the beginner API so the browser never
 * touches the upstream Anthropic API directly:
 *
 *   POST /api/auth/phone/request  → POST {API_BASE}/claude/auth/phone/request
 *   POST /api/auth/phone/verify   → POST {API_BASE}/claude/auth/phone/verify
 *   POST /api/search              → POST {API_BASE}/claude/chat   (auth required)
 *
 * Everything else under / is the static renderer bundle. There is no build
 * step — the same plain HTML/CSS/JS that runs inside Electron also runs here.
 */

"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const API_BASE = (process.env.TINKER_API_BASE || "http://localhost:4000").replace(/\/$/, "");
const RENDERER_DIR = path.join(__dirname, "..", "renderer");

// The search system prompt we want the proxy to use. Mirrors the prompt in
// src/main/main.js / src/renderer/platform-mobile.js — keep all three in sync.
const SEARCH_SYSTEM_PROMPT = `You are the search engine for the tinker web browser — a quiet alternative to ad-driven search.

When you receive a query, write a calm, conversational answer in three to five short paragraphs that helps the reader understand the topic and where to go next. Embed Markdown links to specific, well-known websites — Wikipedia, official organisation sites, established publications, .gov pages — where the reader can read more or take action. Format links exactly as [label](https://example.com).

Voice: warm, plainspoken, calm. Address the reader as "you" where natural. No headings, no bulleted lists — just flowing prose, with short paragraphs separated by blank lines.

Only include links to sources you'd actually recommend and that you are confident exist. Do not invent URLs. If you are uncertain about a specific URL, omit the link rather than guess. It is better to write a confident paragraph with no link than to fabricate one.`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buf.length,
  });
  res.end(buf);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      // 128 KB cap — we only ever forward { phone, pin } / { query }.
      if (total > 128 * 1024) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function callApi(pathname, { method = "POST", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + pathname);
    const lib = url.protocol === "https:" ? https : http;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": payload.length } : {}),
          ...headers,
        },
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
          resolve({ status: resp.statusCode || 0, body: json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Read once Anthropic-stream-style SSE result back into a single string.
// We collect text_delta events and concatenate them. /claude/chat already
// streams; for the search use case we don't need streaming, so we buffer.
function readClaudeStream(claudeResp) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let text = "";
    claudeResp.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
              text += evt.delta.text || "";
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    });
    claudeResp.on("end", () => resolve(text));
    claudeResp.on("error", reject);
  });
}

function streamApi(pathname, { method = "POST", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + pathname);
    const lib = url.protocol === "https:" ? https : http;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": payload.length } : {}),
          ...headers,
        },
      },
      (resp) => resolve(resp),
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Static file serving ─────────────────────────────────────────────────────

function safeJoin(root, urlPath) {
  // Strip query string + decode + normalize, then make sure the resolved
  // path is still inside the renderer directory.
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = clean === "/" ? "/index.html" : clean;
  const resolved = path.normalize(path.join(root, rel));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function serveStatic(req, res) {
  const target = safeJoin(RENDERER_DIR, req.url);
  if (!target) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(target).pipe(res);
  });
}

// ── Route handlers ──────────────────────────────────────────────────────────

async function handleAuthRequest(req, res) {
  const body = await readJsonBody(req);
  const upstream = await callApi("/claude/auth/phone/request", { body });
  sendJson(res, upstream.status, upstream.body);
}

async function handleAuthVerify(req, res) {
  const body = await readJsonBody(req);
  const upstream = await callApi("/claude/auth/phone/verify", { body });
  sendJson(res, upstream.status, upstream.body);
}

async function handleSearch(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    sendJson(res, 401, { error: "Missing token" });
    return;
  }
  const body = await readJsonBody(req);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    sendJson(res, 400, { error: "query is required" });
    return;
  }

  const claudeResp = await streamApi("/claude/chat", {
    headers: { Authorization: auth },
    body: {
      model: "claude-haiku-4-5",
      messages: [
        { role: "user", content: `${SEARCH_SYSTEM_PROMPT}\n\nQuery: ${query}` },
      ],
    },
  });

  if (claudeResp.statusCode && claudeResp.statusCode >= 400) {
    let raw = "";
    claudeResp.on("data", (c) => (raw += c.toString("utf8")));
    claudeResp.on("end", () => {
      try { sendJson(res, claudeResp.statusCode, JSON.parse(raw)); }
      catch { sendJson(res, claudeResp.statusCode, { error: raw || "Upstream error" }); }
    });
    return;
  }

  try {
    const text = await readClaudeStream(claudeResp);
    sendJson(res, 200, { text });
  } catch (err) {
    sendJson(res, 502, { error: err.message || "Upstream stream failed" });
  }
}

// ── Server ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";

  try {
    if (req.method === "POST" && url === "/api/auth/phone/request") {
      await handleAuthRequest(req, res);
      return;
    }
    if (req.method === "POST" && url === "/api/auth/phone/verify") {
      await handleAuthVerify(req, res);
      return;
    }
    if (req.method === "POST" && url === "/api/search") {
      await handleSearch(req, res);
      return;
    }
    if (url === "/api/config" && req.method === "GET") {
      sendJson(res, 200, { web: true });
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res);
      return;
    }
    res.writeHead(405);
    res.end("Method Not Allowed");
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Internal error" });
  }
});

server.listen(PORT, () => {
  console.log(`tinker web → http://localhost:${PORT}`);
  console.log(`  proxying /api/* → ${API_BASE}/claude/*`);
});
