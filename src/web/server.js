/* tinker — web host (static)
 *
 * Serves the renderer (the same files Electron and Capacitor load) over
 * plain HTTP. The auth + search endpoints live as Vercel serverless
 * functions under `api/*` and are NOT served by this host — use
 * `vercel dev` instead of `npm run web` when you need them locally.
 *
 * Everything under / is the static renderer bundle. There is no build
 * step — the same plain HTML/CSS/JS that runs inside Electron also runs
 * here.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const RENDERER_DIR = path.join(__dirname, "..", "renderer");

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

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`tinker web → http://localhost:${PORT}`);
  console.log("  (static only; run `vercel dev` for auth + search)");
});
