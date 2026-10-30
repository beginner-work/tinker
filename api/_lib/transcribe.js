/* ElevenLabs Speech-to-Text helpers for POST /api/transcribe.
 *
 * Auth and HTTP handling live in the route. This module owns:
 *   - multipart / raw audio body parsing
 *   - the ElevenLabs Scribe call (ELEVENLABS_API_KEY stays server-side)
 *   - response shaping and usage-row writes
 *
 * fetchFn / prismaClient are injectable for tests.
 */

"use strict";

const crypto = require("node:crypto");

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/x-m4a",
  "video/webm",
  "video/mp4",
  "application/ogg",
]);

const EXT_BY_MIME = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "mp4",
  "video/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
};

function elevenLabsApiKey() {
  const key = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY || "";
  return typeof key === "string" ? key.trim() : "";
}

function sttModelId() {
  const raw = process.env.ELEVENLABS_STT_MODEL || "scribe_v2";
  return String(raw).trim() || "scribe_v2";
}

function serviceToken() {
  return String(process.env.TINKER_SERVICE_TOKEN || "").trim();
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function newRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function normalizeMime(raw) {
  const base = String(raw || "").split(";")[0].trim().toLowerCase();
  if (!base) return "";
  if (base === "audio/x-mp3") return "audio/mpeg";
  return base;
}

function isAllowedMime(mime) {
  return ALLOWED_MIME.has(normalizeMime(mime));
}

function filenameForMime(mime) {
  const ext = EXT_BY_MIME[normalizeMime(mime)] || "bin";
  return `audio.${ext}`;
}

function readRawBuffer(req, maxBytes) {
  const limit = maxBytes || MAX_AUDIO_BYTES;
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > limit) {
      return Promise.reject(Object.assign(new Error("Audio too large"), { status: 413 }));
    }
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") {
    const buf = Buffer.from(req.body, "binary");
    if (buf.length > limit) {
      return Promise.reject(Object.assign(new Error("Audio too large"), { status: 413 }));
    }
    return Promise.resolve(buf);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error("Audio too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const ct = String(contentType || "");
  const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundaryMatch) {
    throw Object.assign(new Error("Missing multipart boundary"), { status: 400 });
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = indexOf(buffer, delim, 0);
  if (start < 0) {
    throw Object.assign(new Error("Invalid multipart body"), { status: 400 });
  }
  start += delim.length;
  while (start < buffer.length) {
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break; // --
    if (buffer[start] === 0x0d) start += 1;
    if (buffer[start] === 0x0a) start += 1;
    const next = indexOf(buffer, delim, start);
    if (next < 0) break;
    let partEnd = next;
    if (partEnd >= 2 && buffer[partEnd - 2] === 0x0d && buffer[partEnd - 1] === 0x0a) {
      partEnd -= 2;
    } else if (partEnd >= 1 && buffer[partEnd - 1] === 0x0a) {
      partEnd -= 1;
    }
    parts.push(buffer.subarray(start, partEnd));
    start = next + delim.length;
  }

  let file = null;
  for (const part of parts) {
    const headerEnd = indexOf(part, Buffer.from("\r\n\r\n"), 0);
    if (headerEnd < 0) continue;
    const headerText = part.subarray(0, headerEnd).toString("utf8");
    const body = part.subarray(headerEnd + 4);
    const nameMatch = headerText.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
    const typeMatch = headerText.match(/Content-Type:\s*([^\r\n;]+)/i);
    const name = nameMatch ? nameMatch[1] : "";
    const filename = filenameMatch ? filenameMatch[1] : "";
    const mime = typeMatch ? normalizeMime(typeMatch[1]) : "";
    if (filename || name === "audio" || name === "file") {
      file = { name, filename, mime, buffer: body };
      break;
    }
  }
  if (!file || !file.buffer || !file.buffer.length) {
    throw Object.assign(new Error("Expected an audio file field (audio or file)"), { status: 400 });
  }
  return file;
}

function indexOf(haystack, needle, from) {
  return haystack.indexOf(needle, from);
}

async function parseAudioUpload(req) {
  const contentType = String(
    (req.headers && (req.headers["content-type"] || req.headers["Content-Type"])) || "",
  );
  const raw = await readRawBuffer(req, MAX_AUDIO_BYTES);
  if (!raw.length) {
    throw Object.assign(new Error("Empty body"), { status: 400 });
  }

  if (/multipart\/form-data/i.test(contentType)) {
    const part = parseMultipart(raw, contentType);
    let mime = normalizeMime(part.mime);
    if (!mime && part.filename) {
      const lower = part.filename.toLowerCase();
      if (lower.endsWith(".webm")) mime = "audio/webm";
      else if (lower.endsWith(".ogg") || lower.endsWith(".oga")) mime = "audio/ogg";
      else if (lower.endsWith(".mp4") || lower.endsWith(".m4a")) mime = "audio/mp4";
      else if (lower.endsWith(".wav")) mime = "audio/wav";
      else if (lower.endsWith(".mp3")) mime = "audio/mpeg";
    }
    if (!isAllowedMime(mime)) {
      throw Object.assign(
        new Error("Unsupported audio type. Use webm, ogg, mp4, wav, or mp3."),
        { status: 415 },
      );
    }
    return { buffer: part.buffer, mimeType: mime, byteLength: part.buffer.length };
  }

  const mime = normalizeMime(contentType);
  if (!isAllowedMime(mime)) {
    throw Object.assign(
      new Error("Unsupported Content-Type. Use multipart/form-data or audio/webm|ogg|mp4|wav."),
      { status: 415 },
    );
  }
  return { buffer: raw, mimeType: mime, byteLength: raw.length };
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .map((w) => {
      if (!w || typeof w !== "object") return null;
      const text = typeof w.text === "string" ? w.text : "";
      const start = typeof w.start === "number" ? w.start : null;
      const end = typeof w.end === "number" ? w.end : null;
      const type = typeof w.type === "string" ? w.type : undefined;
      const out = { text, start, end };
      if (type) out.type = type;
      return out;
    })
    .filter(Boolean);
}

function durationMsFromWords(words) {
  let maxEnd = 0;
  for (const w of words || []) {
    if (typeof w.end === "number" && w.end > maxEnd) maxEnd = w.end;
  }
  if (maxEnd <= 0) return null;
  return Math.round(maxEnd * 1000);
}

async function callElevenLabsStt({ buffer, mimeType, apiKey, modelId, fetchFn }) {
  const key = apiKey || elevenLabsApiKey();
  const model = modelId || sttModelId();
  const doFetch = fetchFn || fetch;
  if (!key) {
    throw Object.assign(new Error("ELEVENLABS_API_KEY is not configured"), { status: 503 });
  }

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  form.append("file", blob, filenameForMime(mimeType));
  form.append("model_id", model);
  form.append("timestamps_granularity", "word");

  const res = await doFetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });

  const requestIdHeader =
    (res.headers && typeof res.headers.get === "function" && (res.headers.get("request-id") || res.headers.get("x-request-id"))) ||
    "";

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail =
      (payload && (payload.detail || payload.message || payload.error)) ||
      `ElevenLabs STT ${res.status}`;
    const message = typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 200);
    throw Object.assign(new Error(message), {
      status: res.status === 401 || res.status === 403 ? 502 : res.status >= 500 ? 502 : 400,
      elevenLabsRequestId: requestIdHeader,
    });
  }

  const text = payload && typeof payload.text === "string" ? payload.text : "";
  const words = normalizeWords(payload && payload.words);
  return {
    text,
    words,
    durationMs: durationMsFromWords(words),
    elevenLabsRequestId: requestIdHeader || "",
    languageCode: payload && payload.language_code ? String(payload.language_code) : "",
  };
}

async function logTranscription(prismaClient, row) {
  if (!prismaClient || typeof prismaClient.transcriptionRequest?.create !== "function") {
    return null;
  }
  try {
    return await prismaClient.transcriptionRequest.create({
      data: {
        id: row.id,
        caller: row.caller || "unknown",
        status: row.status || "error",
        latencyMs: row.latencyMs || 0,
        durationMs: row.durationMs == null ? null : row.durationMs,
        mimeType: row.mimeType || "",
        byteLength: row.byteLength || 0,
        text: row.text || "",
        words: row.words || [],
        error: row.error || "",
        elevenLabsRequestId: row.elevenLabsRequestId || "",
      },
    });
  } catch (err) {
    console.error("[transcribe] failed to persist TranscriptionRequest", err && err.message);
    return null;
  }
}

module.exports = {
  MAX_AUDIO_BYTES,
  ALLOWED_MIME,
  elevenLabsApiKey,
  sttModelId,
  serviceToken,
  timingSafeEqual,
  extractBearer,
  newRequestId,
  normalizeMime,
  isAllowedMime,
  parseAudioUpload,
  parseMultipart,
  normalizeWords,
  durationMsFromWords,
  callElevenLabsStt,
  logTranscription,
};
