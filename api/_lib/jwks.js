/* JWKS-based verification for Stytch session JWTs.
 *
 * Stytch signs session JWTs with RS256 and exposes the public key set at
 *   https://{api|test}.stytch.com/v1/sessions/jwks/{project_id}
 *
 * We verify the signature using Node's built-in crypto (so this file ships
 * with zero external dependencies). The JWKS is cached in module scope for
 * 10 minutes, which is fine because Stytch rotates keys infrequently and
 * the cache lives only as long as a warm Vercel function container.
 *
 * Validated claims:
 *   - signature (RS256 over the b64url header.payload)
 *   - exp (with a small clock skew)
 *   - iss === stytch.com/{project_id}
 *   - aud contains project_id (Stytch sends an array)
 */

"use strict";

const crypto = require("crypto");
const { baseUrlFor } = require("./stytch.js");

const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 30;

const jwksCache = new Map(); // projectId → { keys, fetchedAt }

function b64urlToBuffer(input) {
  return Buffer.from(String(input), "base64url");
}

function b64urlJson(input) {
  return JSON.parse(b64urlToBuffer(input).toString("utf8"));
}

async function loadJwks(projectId) {
  const now = Date.now();
  const cached = jwksCache.get(projectId);
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }
  const url = `${baseUrlFor(projectId)}/v1/sessions/jwks/${projectId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw Object.assign(
      new Error(`Failed to fetch JWKS (${res.status})`),
      { status: 502 },
    );
  }
  const body = await res.json();
  const keys = Array.isArray(body && body.keys) ? body.keys : [];
  jwksCache.set(projectId, { keys, fetchedAt: now });
  return keys;
}

function findKey(keys, kid) {
  return keys.find((k) => k.kid === kid) || null;
}

async function verifyStytchJwt(token, projectId) {
  if (!token || typeof token !== "string") {
    throw Object.assign(new Error("Missing token."), { status: 401 });
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw Object.assign(new Error("Malformed token."), { status: 401 });
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header;
  try {
    header = b64urlJson(headerB64);
  } catch {
    throw Object.assign(new Error("Malformed token header."), { status: 401 });
  }
  if (header.alg !== "RS256") {
    throw Object.assign(new Error("Unsupported token algorithm."), {
      status: 401,
    });
  }

  const keys = await loadJwks(projectId);
  let jwk = findKey(keys, header.kid);
  if (!jwk) {
    // Could be a rotation we haven't seen — bust the cache once and retry.
    jwksCache.delete(projectId);
    const refreshed = await loadJwks(projectId);
    jwk = findKey(refreshed, header.kid);
  }
  if (!jwk) {
    throw Object.assign(new Error("Token signed by unknown key."), {
      status: 401,
    });
  }

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const signature = b64urlToBuffer(sigB64);
  const ok = crypto.verify("RSA-SHA256", signingInput, publicKey, signature);
  if (!ok) {
    throw Object.assign(new Error("Bad signature."), { status: 401 });
  }

  let payload;
  try {
    payload = b64urlJson(payloadB64);
  } catch {
    throw Object.assign(new Error("Malformed token payload."), { status: 401 });
  }

  const nowS = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && nowS > payload.exp + CLOCK_SKEW_S) {
    throw Object.assign(new Error("Token expired."), { status: 401 });
  }
  if (payload.iss !== `stytch.com/${projectId}`) {
    throw Object.assign(new Error("Token issuer mismatch."), { status: 401 });
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(projectId)) {
    throw Object.assign(new Error("Token audience mismatch."), { status: 401 });
  }

  return payload;
}

module.exports = { verifyStytchJwt };
