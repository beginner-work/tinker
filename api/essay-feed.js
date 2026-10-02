/* /api/essay-feed
 *
 * Private mobile essay feed. Auth: Bearer Stytch session (same as the
 * rest of tinker). Actions via ?action=:
 *   GET  list   → filtered essays + starred flags + audioEnabled
 *   POST star   → { essayId, starred } toggle; persists in TinkerUserData
 *                 kind "essay-feed-stars" (does not touch essays blob)
 *   GET  config → { audioEnabled }
 *   POST audio  → { essayId } generate-on-first-play, cache by essay+voice
 *
 * Never exposes essays without auth. No public URLs.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const prisma = require("./_lib/db.js");
const { withResponseLogging } = require("./_lib/log.js");
const feed = require("./_lib/essay-feed.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function actionOf(req) {
  const url = new URL(req.url || "/", "https://tinker.local");
  return (url.searchParams.get("action") || "list").trim().toLowerCase();
}

async function resolveUserId(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  const session = await authenticateSession(token);
  const userId =
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    "";
  if (!userId) {
    throw Object.assign(new Error("Session missing user id"), { status: 401 });
  }
  return userId;
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 64 * 1024) {
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

async function readEssays(userId) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: feed.ESSAYS_KIND } },
  });
  return row && Array.isArray(row.data) ? row.data : [];
}

async function readStarIds(userId) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: feed.STARS_KIND } },
  });
  return feed.normalizeStarIds(row ? row.data : null);
}

async function writeStarIds(userId, essayIds) {
  const data = { essayIds: feed.normalizeStarIds({ essayIds }) };
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: feed.STARS_KIND } },
    create: { userId, kind: feed.STARS_KIND, data },
    update: { data },
  });
  return data.essayIds;
}

async function handleList(userId, res) {
  const [essays, starredIds] = await Promise.all([
    readEssays(userId),
    readStarIds(userId),
  ]);
  const items = feed.buildFeedItems(essays, { starredIds });
  res.status(200).json({
    items,
    order: "newest_first",
    audioEnabled: feed.audioFeatureEnabled(),
    starredCount: starredIds.length,
  });
}

async function handleStar(userId, req, res) {
  const body = await readJsonBody(req);
  const essayId = String(body.essayId || "").trim();
  if (!essayId) {
    res.status(400).json({ error: "essayId is required" });
    return;
  }
  const starred = body.starred !== false && body.starred !== "false";
  const current = await readStarIds(userId);
  const next = feed.toggleStar(current, essayId, starred);
  await writeStarIds(userId, next);
  res.status(200).json({ ok: true, essayId, starred: next.includes(essayId), essayIds: next });
}

async function handleConfig(res) {
  res.status(200).json({
    audioEnabled: feed.audioFeatureEnabled(),
    // Never echo the key or voice id.
  });
}

async function handleAudio(userId, req, res) {
  if (!feed.audioFeatureEnabled()) {
    res.status(503).json({
      error: "Voice playback is not configured",
      audioEnabled: false,
    });
    return;
  }

  const body = await readJsonBody(req);
  const essayId = String(body.essayId || "").trim();
  if (!essayId) {
    res.status(400).json({ error: "essayId is required" });
    return;
  }

  const essays = await readEssays(userId);
  const essay = essays.find((e) => e && String(e.id) === essayId);
  if (!essay) {
    res.status(404).json({ error: "Essay not found" });
    return;
  }
  const text = feed.extractBodyText(essay);
  if (!text) {
    res.status(400).json({ error: "Essay has no readable text" });
    return;
  }

  const voiceId = feed.elevenLabsVoiceId();

  const result = await feed.getOrCreateAudio({
    essayId,
    voiceId,
    text,
    readCache: async (eid, vid) => {
      try {
        return await prisma.essayFeedAudioCache.findUnique({
          where: {
            userId_essayId_voiceId: { userId, essayId: eid, voiceId: vid },
          },
        });
      } catch (err) {
        // Table may not exist yet on a deploy before migrate — treat as miss.
        if (err && /essayFeedAudioCache|does not exist|P2021/i.test(String(err.message || err))) {
          return null;
        }
        throw err;
      }
    },
    writeCache: async ({ essayId: eid, voiceId: vid, audioBase64, contentType }) => {
      try {
        await prisma.essayFeedAudioCache.upsert({
          where: {
            userId_essayId_voiceId: { userId, essayId: eid, voiceId: vid },
          },
          create: {
            userId,
            essayId: eid,
            voiceId: vid,
            audioBase64,
            contentType: contentType || "audio/mpeg",
          },
          update: {
            audioBase64,
            contentType: contentType || "audio/mpeg",
          },
        });
      } catch (err) {
        if (err && /essayFeedAudioCache|does not exist|P2021/i.test(String(err.message || err))) {
          throw Object.assign(
            new Error("Audio cache table is missing — run prisma migrate deploy"),
            { status: 503 },
          );
        }
        throw err;
      }
    },
    generateFn: ({ text: prose, voiceId: vid }) =>
      feed.callElevenLabsTts({ text: prose, voiceId: vid }),
  });

  res.status(200).json({
    ok: true,
    cached: result.cached,
    essayId: result.essayId,
    voiceId: result.voiceId,
    contentType: result.contentType,
    audioBase64: result.audioBase64,
  });
}

module.exports = withResponseLogging(async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");

  const action = actionOf(req);
  const method = req.method || "GET";

  if (action === "config" && method === "GET") {
    // Config only reveals whether audio is enabled — still requires auth
    // so we don't advertise anything about the deployment to strangers.
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  try {
    if (action === "list" && method === "GET") {
      await handleList(userId, res);
      return;
    }
    if (action === "config" && method === "GET") {
      await handleConfig(res);
      return;
    }
    if (action === "star" && method === "POST") {
      await handleStar(userId, req, res);
      return;
    }
    if (action === "audio" && method === "POST") {
      await handleAudio(userId, req, res);
      return;
    }
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || "Internal error" });
  }
});

module.exports.__test__ = {
  actionOf,
  resolveUserId,
  readEssays,
  readStarIds,
  writeStarIds,
};
