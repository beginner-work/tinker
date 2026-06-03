/* POST /api/transcribe
 *
 * Authorization: Bearer <stytch session_token>
 * Body: the raw audio clip (Content-Type: audio/webm, audio/mp4, …)
 * Reply: { text: string }
 *
 * The voice-to-text fallback for browsers where the Web Speech API doesn't
 * work (Safari). The renderer records a short clip (MediaRecorder) and POSTs
 * the bytes here; we forward them to a Whisper transcription API and return
 * the text. The provider key stays server-side, and the founder's session is
 * required so the endpoint isn't an open transcription proxy.
 *
 * Provider is OpenAI-compatible (multipart /audio/transcriptions) and
 * configurable, defaulting to Groq's free, fast hosted Whisper:
 *   TRANSCRIBE_API_KEY   (or GROQ_API_KEY / OPENAI_API_KEY)
 *   TRANSCRIBE_URL       (default https://api.groq.com/openai/v1/audio/transcriptions)
 *   TRANSCRIBE_MODEL     (default whisper-large-v3-turbo)
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { withResponseLogging } = require("./_lib/log.js");

// Cap the upload so a stray/abusive request can't hand the provider a huge
// file. ~25MB is the common provider limit; we stay well under for short
// dictation (a minute of audio is well under a megabyte).
const MAX_BYTES = 8 * 1024 * 1024;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

// Resolve the transcription provider from the environment, or null when none
// is configured (so the route can answer a clean 503 instead of guessing).
function pickProvider(env) {
  env = env || {};
  const key =
    env.TRANSCRIBE_API_KEY || env.GROQ_API_KEY || env.OPENAI_API_KEY || "";
  if (!key) return null;
  return {
    key: key,
    url: env.TRANSCRIBE_URL || "https://api.groq.com/openai/v1/audio/transcriptions",
    model: env.TRANSCRIBE_MODEL || "whisper-large-v3-turbo",
  };
}

// Pick a filename + extension for the multipart part from the recording's
// Content-Type. Providers sniff the extension, so this has to be plausible.
function filenameForType(contentType) {
  const t = (contentType || "").toLowerCase();
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "audio.m4a";
  if (t.includes("mpeg") || t.includes("mp3")) return "audio.mp3";
  if (t.includes("ogg")) return "audio.ogg";
  if (t.includes("wav")) return "audio.wav";
  return "audio.webm";
}

function readRawBody(req, limit) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Recording is too large."), { status: 413 }));
        try { req.destroy(); } catch (e) { /* ignore */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

const handler = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await authenticateSession(extractBearer(req.headers && req.headers.authorization));
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  const provider = pickProvider(process.env);
  if (!provider) {
    console.error("[transcribe] Misconfigured: no TRANSCRIBE_API_KEY / GROQ_API_KEY set");
    res.status(503).json({
      error: "Voice transcription isn't set up yet.",
      detail: "TRANSCRIBE_API_KEY is not configured",
    });
    return;
  }

  let audio;
  try {
    audio = await readRawBody(req, MAX_BYTES);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Could not read the recording." });
    return;
  }
  if (!audio || audio.length === 0) {
    res.status(400).json({ error: "Empty recording." });
    return;
  }

  const contentType = (req.headers && req.headers["content-type"]) || "audio/webm";
  let upstream;
  try {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: contentType }), filenameForType(contentType));
    form.append("model", provider.model);
    form.append("response_format", "json");
    upstream = await fetch(provider.url, {
      method: "POST",
      headers: { Authorization: "Bearer " + provider.key },
      body: form,
    });
  } catch (err) {
    res.status(502).json({ error: "Transcription service is unreachable." });
    return;
  }

  const data = await upstream.json().catch(function () {
    return null;
  });
  if (!upstream.ok) {
    const message = (data && (data.error?.message || data.error)) || "Transcription failed (" + upstream.status + ")";
    res.status(502).json({ error: typeof message === "string" ? message : "Transcription failed." });
    return;
  }

  res.status(200).json({ text: (data && typeof data.text === "string" ? data.text : "").trim() });
});

module.exports = handler;
module.exports.__test__ = {
  MAX_BYTES,
  extractBearer,
  pickProvider,
  filenameForType,
  readRawBody,
};
