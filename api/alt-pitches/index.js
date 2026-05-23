/* POST /api/alt-pitches
 *
 * Authorization: Bearer <stytch session_token>
 *
 * Two modes (mode field in body, defaults to "cluster"):
 *
 *   mode: "cluster"
 *     Body:  { writings: [{ id, snippet }], existingPitchTitles?: [string] }
 *     Reply: {
 *       pitches: [{
 *         title: string,
 *         writings: [{
 *           id: string,
 *           deckHeading: string | null,
 *           phrase: { writingId, offset, length } | null
 *         }]
 *       }]
 *     }
 *
 *     Groups the founder's stray "doesn't fit" writings into 1–4 named
 *     pitches and, for each writing inside each pitch, picks one of
 *     the eleven universal deck headings plus a verbatim phrase to
 *     show under that heading. Server validates phraseText → offset
 *     using the same resolver as /api/classify.
 *
 *     existingPitchTitles is a hint — the model may re-use one of
 *     these as a cluster title when an off-pitch writing belongs with
 *     a pitch that already exists.
 *
 *   mode: "name"
 *     Body:  { writings: [{ id, snippet }] }
 *     Reply: { pitches: [{ title, writings: [{ id, deckHeading: null, phrase: null }] }] }
 *
 *     Returns a single one-word title that captures the throughline
 *     of the input writings. Used by older clients to auto-name a
 *     pitch after the legacy tree migration.
 *
 * This endpoint is the client-orchestrated round-trip. The newer
 * server-driven backend job at /api/pitches/organize calls the same
 * helpers in api/_lib/pitches-clusterer.js end-to-end, so the contract
 * is identical. Both endpoints stay live during the transition.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");
const {
  DECK_HEADINGS,
  HEADING_DESCRIPTIONS,
  MAX_WRITINGS,
  MAX_BUCKETS,
  validateTitle,
  validateHeading,
  fallbackPhrase,
  fallbackHeading,
  resolvePhraseText,
  parseClassifierJson,
  normalizeInputs,
  reconcileClusters,
  buildClusterPrompt,
  buildNamePrompt,
  clusterWritings,
  nameWritings,
} = require("../_lib/pitches-clusterer.js");

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(typeof req.body === "string" ? req.body : "{}");
  } catch {
    return null;
  }
}

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

async function handleCluster(req, res, body) {
  const writings = normalizeInputs(body.writings);
  if (writings.length === 0) {
    res.status(200).json({ pitches: [] });
    return;
  }

  const existingPitchTitles = Array.isArray(body.existingPitchTitles)
    ? body.existingPitchTitles.filter((t) => typeof t === "string").slice(0, 8)
    : [];
  const isPreview = process.env.VERCEL_ENV === "preview";

  let pitches;
  try {
    pitches = await clusterWritings({
      writings,
      existingPitchTitles,
      log: isPreview
        ? (attempt, raw) => {
            try { console.log(`[alt-pitches.cluster] attempt=${attempt} raw=${String(raw).slice(0, 400)}`); }
            catch { /* ignore */ }
          }
        : null,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
    return;
  }

  res.status(200).json({ pitches });
}

async function handleName(req, res, body) {
  const writings = normalizeInputs(body.writings);
  if (writings.length === 0) {
    res.status(200).json({ pitches: [] });
    return;
  }

  const isPreview = process.env.VERCEL_ENV === "preview";
  let title;
  try {
    title = await nameWritings({
      writings,
      log: isPreview
        ? (attempt, raw) => {
            try { console.log(`[alt-pitches.name] attempt=${attempt} raw=${String(raw).slice(0, 200)}`); }
            catch { /* ignore */ }
          }
        : null,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
    return;
  }
  if (!title) title = "Untitled";

  res.status(200).json({
    pitches: [{
      title,
      writings: writings.map((w) => ({ id: w.id, deckHeading: null, phrase: null })),
    }],
  });
}

const handler = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  try {
    await authenticateSession(token);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const mode = typeof body.mode === "string" ? body.mode : "cluster";
  if (mode === "name") {
    await handleName(req, res, body);
    return;
  }
  await handleCluster(req, res, body);
});

module.exports = handler;
module.exports.__test__ = {
  DECK_HEADINGS,
  HEADING_DESCRIPTIONS,
  MAX_WRITINGS,
  MAX_BUCKETS,
  validateTitle,
  validateHeading,
  reconcileClusters,
  parseClassifierJson,
  normalizeInputs,
  resolvePhraseText,
  fallbackPhrase,
  fallbackHeading,
  buildClusterPrompt,
  buildNamePrompt,
};
