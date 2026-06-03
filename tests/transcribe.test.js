/* /api/transcribe pure-helper contract.
 *
 * The route forwards audio to a Whisper provider, which we don't exercise
 * here. The pieces it holds the request to — provider resolution from the
 * env, the multipart filename derived from the recording's Content-Type, the
 * bearer extractor, and the size-capped body reader — are the contract.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { extractBearer, pickProvider, filenameForType, readRawBody, MAX_BYTES } =
  require("../api/transcribe.js").__test__;

test("extractBearer pulls the token out of the header", () => {
  assert.equal(extractBearer("Bearer sess_abc"), "sess_abc");
  assert.equal(extractBearer("bearer sess_abc"), "sess_abc");
  assert.equal(extractBearer("Basic xyz"), "");
  assert.equal(extractBearer(undefined), "");
});

test("pickProvider returns null when no key is set", () => {
  assert.equal(pickProvider({}), null);
});

test("pickProvider defaults to Groq's hosted Whisper", () => {
  const p = pickProvider({ GROQ_API_KEY: "gsk_x" });
  assert.equal(p.key, "gsk_x");
  assert.match(p.url, /groq\.com/);
  assert.match(p.model, /whisper/);
});

test("pickProvider honours explicit overrides and key precedence", () => {
  const p = pickProvider({
    TRANSCRIBE_API_KEY: "primary",
    GROQ_API_KEY: "secondary",
    TRANSCRIBE_URL: "https://example.com/v1/audio/transcriptions",
    TRANSCRIBE_MODEL: "whisper-1",
  });
  assert.equal(p.key, "primary");
  assert.equal(p.url, "https://example.com/v1/audio/transcriptions");
  assert.equal(p.model, "whisper-1");
});

test("filenameForType maps the recording's Content-Type to a plausible name", () => {
  assert.equal(filenameForType("audio/mp4"), "audio.m4a");
  assert.equal(filenameForType("audio/webm;codecs=opus"), "audio.webm");
  assert.equal(filenameForType("audio/ogg"), "audio.ogg");
  assert.equal(filenameForType("audio/wav"), "audio.wav");
  assert.equal(filenameForType(""), "audio.webm");
});

test("readRawBody concatenates the stream into a buffer", async () => {
  const req = Readable.from([Buffer.from("ab"), Buffer.from("cd")]);
  const buf = await readRawBody(req, MAX_BYTES);
  assert.equal(buf.toString(), "abcd");
});

test("readRawBody rejects a body over the limit with 413", async () => {
  const req = Readable.from([Buffer.alloc(10), Buffer.alloc(10)]);
  await assert.rejects(
    () => readRawBody(req, 12),
    (err) => err.status === 413
  );
});
