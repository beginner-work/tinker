/* POST /api/publish/booklet
 *
 * Authorization: Bearer <stytch session_token>
 *
 * Body:
 *   {
 *     pitches: [
 *       {
 *         title:   string,                 // pitch display title
 *         slug?:   string,                 // stable slug; derived if absent
 *         stories: [ { title?: string, body: string }, ... ]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Reply:
 *   { ok: true, count, storyCount, storiesUrl, updatedAt }
 *
 * Side effect:
 *   Upserts ONE row into TinkerUserData keyed by (userId, "booklets").
 *   The stored blob is { pitches: [...], generatedAt }.
 *
 * The model: tinker stays private. A founder picks which of their
 * pitches to surface publicly, and the full essays behind each chosen
 * pitch are published as a "booklet" to their public beginner profile
 * page. Beginner is the public-facing service — it reads this row back
 * through the public /api/publish/booklets endpoint and renders the
 * booklet on /tyler-lindow (the founder's profile). Re-publishing
 * replaces the whole booklet (whole-document semantics), so unchecking
 * a pitch in tinker removes it from the public profile on the next
 * publish.
 *
 * Database topology note: tinker and beginner share the production Neon
 * endpoint via TinkerUserData, but beginner preview deploys read from an
 * auto-branched preview database, so a tinker-preview → beginner-preview
 * round-trip won't find the row. Verify on prod after merge. See
 * README.md → "Shared database with the beginner repo".
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

const KIND = "booklets";
const MAX_BYTES = 512 * 1024;
const MAX_PITCHES = 24;
const MAX_STORIES_PER_PITCH = 64;
const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 100 * 1024;

// The booklet renders on the founder's beginner profile. Production
// tinker → https://beginner.work. Preview tinker → beginner's main
// preview alias. VERCEL_ENV is auto-injected by Vercel. Kept identical
// to api/publish/pitch.js so every publish flow resolves the same host.
function readerHost() {
  if (process.env.VERCEL_ENV === "preview") {
    return "https://beginner-git-main-beginner-work.vercel.app";
  }
  return "https://beginner.work";
}

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

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

function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isSlug(s) {
  return typeof s === "string"
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)
    && s.length <= 64;
}

function validateBody(body) {
  if (!body || typeof body !== "object") {
    throw Object.assign(new Error("Body must be a JSON object"), { status: 400 });
  }
  const rawPitches = Array.isArray(body.pitches) ? body.pitches : null;
  if (!rawPitches) {
    throw Object.assign(new Error("pitches is required"), { status: 400 });
  }

  const pitches = [];
  const usedSlugs = new Set();
  let storyCount = 0;

  for (const raw of rawPitches.slice(0, MAX_PITCHES)) {
    if (!raw || typeof raw !== "object") continue;

    let title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (title.length > MAX_TITLE_LEN) title = title.slice(0, MAX_TITLE_LEN).trim();
    if (!title) title = "Untitled";

    // Resolve the stories first — a pitch with no usable stories is
    // dropped, so the public booklet never shows an empty chapter.
    const rawStories = Array.isArray(raw.stories) ? raw.stories : [];
    const stories = [];
    for (const s of rawStories.slice(0, MAX_STORIES_PER_PITCH)) {
      if (!s || typeof s !== "object") continue;
      const sBody = typeof s.body === "string" ? s.body.trim() : "";
      if (!sBody) continue;
      let sTitle = typeof s.title === "string" ? s.title.trim() : "";
      if (sTitle.length > MAX_TITLE_LEN) sTitle = sTitle.slice(0, MAX_TITLE_LEN).trim();
      stories.push({
        title: sTitle,
        body: sBody.length > MAX_BODY_LEN ? sBody.slice(0, MAX_BODY_LEN) : sBody,
      });
    }
    if (!stories.length) continue;

    // Stable, collision-free slug. Prefer a client slug of the right
    // shape; otherwise derive from the title. Disambiguate duplicates so
    // two pitches named the same don't overwrite each other in the URL.
    let base = isSlug(raw.slug) ? raw.slug : slugify(title);
    if (!base) base = "pitch";
    if (base.length > 64) base = base.slice(0, 64).replace(/-+$/g, "");
    let slug = base;
    let n = 2;
    while (usedSlugs.has(slug)) {
      const suffix = `-${n++}`;
      slug = base.slice(0, 64 - suffix.length).replace(/-+$/g, "") + suffix;
    }
    usedSlugs.add(slug);

    pitches.push({ title, slug, stories });
    storyCount += stories.length;
  }

  if (!pitches.length) {
    throw Object.assign(new Error("at least one pitch must have a story"), { status: 400 });
  }

  return { pitches, storyCount };
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    const token = extractBearer(req.headers && req.headers.authorization);
    const session = await authenticateSession(token);
    userId =
      (session && session.session && session.session.user_id) ||
      (session && session.user && session.user.user_id) ||
      "";
    if (!userId) {
      throw Object.assign(new Error("Session missing user id"), { status: 401 });
    }
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  let parsed;
  try {
    const body = await readJsonBody(req);
    parsed = validateBody(body);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Bad request" });
    return;
  }

  const data = { pitches: parsed.pitches, generatedAt: Date.now() };

  try {
    const saved = await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: KIND } },
      create: { userId, kind: KIND, data },
      update: { data },
    });
    // The founder shares their profile with this id so a logged-out
    // customer can read the booklet without being the page's owner.
    const storiesUrl = `${readerHost()}/tyler-lindow?u=${encodeURIComponent(userId)}#stories`;
    res.status(200).json({
      ok: true,
      count: parsed.pitches.length,
      storyCount: parsed.storyCount,
      updatedAt: saved.updatedAt,
      storiesUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = withResponseLogging(handler);
// Exported for unit tests that don't want the logging wrapper.
module.exports._raw = handler;
module.exports._slugify = slugify;
module.exports._isSlug = isSlug;
module.exports._validateBody = validateBody;
module.exports._readerHost = readerHost;
