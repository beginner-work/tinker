/* AES-256-GCM for per-owner secrets. Key: TINKER_SECRETS_KEY || STYTCH_SECRET. */
"use strict";
const crypto = require("crypto");
function keyBytes() {
  const raw = process.env.TINKER_SECRETS_KEY || process.env.STYTCH_SECRET || "tinker-dev-secrets";
  return crypto.createHash("sha256").update(String(raw)).digest();
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
function decrypt(blob) {
  const buf = Buffer.from(String(blob || ""), "base64");
  if (buf.length < 29) throw Object.assign(new Error("Invalid ciphertext."), { status: 500 });
  const d = crypto.createDecipheriv("aes-256-gcm", keyBytes(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
function maskSecret(value) {
  const s = String(value == null ? "" : value);
  if (!s) return "";
  return s.length <= 4 ? "••••" : "••••" + s.slice(-4);
}
module.exports = { encrypt, decrypt, maskSecret };
