/* GET/PUT/DELETE /api/pitch-deck
 *
 * A founder's uploaded pitch deck, rendered client-side (pdf.js) into slide
 * images for the "Practice your pitch" slideshow. Stored as one
 * TinkerUserData row (kind "pitchDeck") keyed by Stytch user_id — same auth
 * as /api/user-data/<kind>, but with a larger body cap because a deck's
 * slide images don't fit the 256 KB whole-blob limit that the generic
 * user-data handler enforces.
 *
 *   GET    → { data: { name, slides:[dataURL...], aspect, updatedAt } | null }
 *   PUT    body { data } → { ok, updatedAt }
 *   DELETE → { ok }
 *
 * Fetched on demand (it is intentionally NOT part of the bulk sync in
 * src/renderer/sync.js), so the slide images never bloat a normal hydrate.
 */

"use strict";

const { resolveUserId } = require("./_lib/user-data.js");
const prisma = require("./_lib/db.js");
const { withResponseLogging } = require("./_lib/log.js");

const KIND = "pitchDeck";
// Slide images for a deck are larger than the 256 KB whole-blob cap but well
// under Vercel's platform request limit. 4 MB is plenty for a downscaled,
// JPEG-encoded deck and still bounded.
const MAX_BYTES = 4 * 1024 * 1024;

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
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

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PUT" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, PUT, DELETE");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  try {
    if (req.method === "GET") {
      const row = await prisma.tinkerUserData.findUnique({
        where: { userId_kind: { userId, kind: KIND } },
      });
      res.status(200).json({ data: row ? row.data : null, updatedAt: row ? row.updatedAt : null });
      return;
    }

    if (req.method === "DELETE") {
      await prisma.tinkerUserData.deleteMany({ where: { userId, kind: KIND } });
      res.status(200).json({ ok: true });
      return;
    }

    const body = await readJsonBody(req);
    if (!body || !Object.prototype.hasOwnProperty.call(body, "data")) {
      res.status(400).json({ error: "Body must include a `data` field" });
      return;
    }

    const saved = await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: KIND } },
      create: { userId, kind: KIND, data: body.data },
      update: { data: body.data },
    });
    res.status(200).json({ ok: true, updatedAt: saved.updatedAt });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
