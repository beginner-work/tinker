#!/usr/bin/env node
/* Tiny example host proxy for @tinker/sdk.
 *
 *   TINKER_SERVICE_TOKEN=… node server.mjs
 *
 * Serves index.html and proxies:
 *   POST /api/tinker/transcribe  → Tinker /api/transcribe
 *   POST /api/tinker/ask         → Tinker /api/ask
 *
 * The browser only talks to this origin. The service token never leaves Node.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTinkerClient } = require("../../dist/server/index.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const token = String(process.env.TINKER_SERVICE_TOKEN || "").trim();
if (!token) {
  console.error("Set TINKER_SERVICE_TOKEN before starting the example host.");
  process.exit(1);
}

const client = createTinkerClient({
  baseUrl: process.env.TINKER_BASE_URL || "https://tinker.beginner.work",
  serviceToken: token,
  caller: process.env.TINKER_CALLER || "sdk-example",
});

function send(res, status, body, headers = {}) {
  const isString = typeof body === "string";
  const payload = isString ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": isString ? "text/html; charset=utf-8" : "application/json",
    ...headers,
  });
  res.end(payload);
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function indexOf(haystack, needle, from = 0) {
  return haystack.indexOf(needle, from);
}

/** Minimal multipart extractor for field name=audio|file. */
function parseMultipartAudio(buffer, contentType) {
  const m = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!m) throw Object.assign(new Error("Missing multipart boundary"), { status: 400 });
  const boundary = m[1] || m[2];
  const delim = Buffer.from(`--${boundary}`);
  let start = indexOf(buffer, delim, 0);
  if (start < 0) throw Object.assign(new Error("Invalid multipart body"), { status: 400 });
  start += delim.length;
  while (start < buffer.length) {
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;
    if (buffer[start] === 0x0d) start += 1;
    if (buffer[start] === 0x0a) start += 1;
    const next = indexOf(buffer, delim, start);
    if (next < 0) break;
    let partEnd = next;
    if (partEnd >= 2 && buffer[partEnd - 2] === 0x0d && buffer[partEnd - 1] === 0x0a) partEnd -= 2;
    else if (partEnd >= 1 && buffer[partEnd - 1] === 0x0a) partEnd -= 1;
    const part = buffer.subarray(start, partEnd);
    const headerEnd = indexOf(part, Buffer.from("\r\n\r\n"), 0);
    if (headerEnd >= 0) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      const body = part.subarray(headerEnd + 4);
      const nameMatch = headerText.match(/name="([^"]+)"/i);
      const filenameMatch = headerText.match(/filename="([^"]*)"/i);
      const typeMatch = headerText.match(/Content-Type:\s*([^\r\n;]+)/i);
      const name = nameMatch ? nameMatch[1] : "";
      const filename = filenameMatch ? filenameMatch[1] : "";
      let mime = typeMatch ? typeMatch[1].trim().toLowerCase() : "";
      if (filename || name === "audio" || name === "file") {
        if (!mime && filename) {
          const lower = filename.toLowerCase();
          if (lower.endsWith(".webm")) mime = "audio/webm";
          else if (lower.endsWith(".ogg")) mime = "audio/ogg";
          else if (lower.endsWith(".mp4") || lower.endsWith(".m4a")) mime = "audio/mp4";
          else if (lower.endsWith(".wav")) mime = "audio/wav";
          else if (lower.endsWith(".mp3")) mime = "audio/mpeg";
        }
        return { buffer: body, mimeType: mime || "audio/webm" };
      }
    }
    start = next + delim.length;
  }
  throw Object.assign(new Error("Expected an audio file field (audio or file)"), { status: 400 });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(__dirname, "index.html"), "utf8"));
  }

  // Serve the built browser bundle for the demo page (CJS → thin ESM shim).
  if (req.method === "GET" && url.pathname === "/tinker-ask.js") {
    const browserPath = path.join(__dirname, "../../dist/browser/index.js");
    if (!fs.existsSync(browserPath)) {
      return send(res, 500, {
        error: "Build the SDK first: npm run build --prefix packages/tinker-sdk",
      });
    }
    // Wrap CJS in a tiny ESM-compatible blob via data URL is awkward; instead
    // serve a page-local bootstrap that expects window globals from a UMD-ish
    // eval. For the demo we inline a fetch-based fallback in index.html and
    // keep this route for hosts that bundle the package themselves.
    return send(
      res,
      200,
      `/* Bundle @tinker/sdk/browser into your host app (Vite/webpack/esbuild).
 * This demo page uses the fetch-based fallback in index.html so it runs
 * without a bundler. Production: import { TinkerAsk } from "@tinker/sdk/browser" */
export {};
`,
      { "Content-Type": "text/javascript; charset=utf-8" },
    );
  }

  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/tinker/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    if (req.method === "POST" && url.pathname === "/api/tinker/transcribe") {
      const raw = await readRaw(req);
      const contentType = String(req.headers["content-type"] || "");
      let audio;
      let mimeType;
      if (/multipart\/form-data/i.test(contentType)) {
        const parsed = parseMultipartAudio(raw, contentType);
        audio = parsed.buffer;
        mimeType = parsed.mimeType;
      } else {
        audio = raw;
        mimeType = contentType.split(";")[0] || "audio/webm";
      }
      const result = await client.transcribe({ audio, mimeType });
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/tinker/ask") {
      const raw = await readRaw(req);
      const body = JSON.parse(raw.toString("utf8") || "{}");
      const result = await client.ask({
        question: body.question,
        input: body.input,
        sourceId: body.sourceId,
        rawTranscript: body.rawTranscript,
        position: body.position,
        context: body.context,
      });
      return send(res, 200, result);
    }

    send(res, 404, { error: "Not found" });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    send(res, status, { error: (err && err.message) || "Proxy failed" });
  }
});

server.listen(PORT, () => {
  console.log(`Tinker SDK example host on http://localhost:${PORT}`);
  console.log(`Open ${pathToFileURL(path.join(__dirname, "index.html"))} via that origin.`);
});
