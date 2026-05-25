/* POST /api/publish/pitch
 *
 * Authorization: Bearer <stytch session_token>
 *
 * Body:
 *   {
 *     title:   string,           // one capitalized word, 1–24 chars
 *     slides: { [heading]: string[] }   // verbatim phrases per beat
 *   }
 *
 * Reply:
 *   { ok: true, slug, updatedAt, beatCount, readerPath }
 *
 * Side effect:
 *   Upserts a row into TinkerUserData keyed by
 *   (userId, "published:" + slug). The stored blob is
 *   { title, slug, markdown, beatCount, generatedAt }.
 *
 * "Publish" means "render the founder's current pitch into a daily-
 * beginner post, save it, and let the reader fetch it from the public
 * /api/publish/read endpoint over in the beginner repo." The styling
 * is owned server-side (frontmatter pulled from pitch-deck.md); the
 * body is whatever the client just sent for each beat.
 *
 * Database topology note: tinker and beginner share the production
 * Neon endpoint via TinkerUserData, but beginner preview deploys read
 * from an auto-branched preview database. A tinker-preview → beginner-
 * preview round-trip therefore won't find the row; verify on prod
 * after merge. See README.md → "Shared database with the beginner
 * repo" for the full picture.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");
const { renderDeck, DECK_HEADINGS } = require("../_lib/deck-template.js");

const MAX_BYTES = 64 * 1024;
const MAX_TITLE_LEN = 24;
const MAX_PHRASES_PER_HEADING = 1;
const MAX_PHRASE_LEN = 600;

// The daily-beginner reader lives on the beginner repo. Production
// tinker → https://beginner.work. Preview tinker → beginner's main
// preview alias (always the latest deploy of beginner's `main`),
// because tinker preview branches rarely have a matching beginner
// branch and the per-branch swap 404s in that case.
//
// VERCEL_ENV is auto-injected by Vercel — no new env vars to configure.
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
  // Lowercase ASCII letters and digits; everything else collapses to a
  // single hyphen; leading/trailing hyphens stripped. The pitches UI
  // already caps titles at one-word-capitalized so the slug is almost
  // always identical to the lowercased title.
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateBody(body) {
  if (!body || typeof body !== "object") {
    throw Object.assign(new Error("Body must be a JSON object"), { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    throw Object.assign(new Error("title is required"), { status: 400 });
  }
  if (title.length > MAX_TITLE_LEN) {
    throw Object.assign(new Error("title is too long"), { status: 400 });
  }
  const slug = slugify(title);
  if (!slug) {
    throw Object.assign(new Error("title has no slug-safe characters"), { status: 400 });
  }

  const rawSlides = body.slides && typeof body.slides === "object" ? body.slides : null;
  if (!rawSlides) {
    throw Object.assign(new Error("slides is required"), { status: 400 });
  }

  const slides = {};
  let totalPhrases = 0;
  for (const heading of DECK_HEADINGS) {
    const list = Array.isArray(rawSlides[heading]) ? rawSlides[heading] : [];
    const kept = [];
    for (const item of list) {
      if (typeof item !== "string") continue;
      const t = item.trim();
      if (!t) continue;
      if (t.length > MAX_PHRASE_LEN) continue;
      kept.push(t);
      if (kept.length >= MAX_PHRASES_PER_HEADING) break;
    }
    if (kept.length) {
      slides[heading] = kept;
      totalPhrases += kept.length;
    }
  }
  if (totalPhrases === 0) {
    throw Object.assign(new Error("at least one beat must have a phrase"), { status: 400 });
  }

  return { title, slug, slides };
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

  let rendered;
  try {
    rendered = renderDeck({
      title: parsed.title,
      slides: parsed.slides,
      generatedAt: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Render failed" });
    return;
  }

  const kind = `published:${parsed.slug}`;
  const data = {
    title: parsed.title,
    slug: parsed.slug,
    markdown: rendered.markdown,
    beatCount: rendered.beatCount,
    generatedAt: Date.now(),
  };

  try {
    const saved = await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind } },
      create: { userId, kind, data },
      update: { data },
    });
    const readerUrl = `${readerHost()}/daily/?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(parsed.slug)}`;
    res.status(200).json({
      ok: true,
      slug: parsed.slug,
      beatCount: rendered.beatCount,
      updatedAt: saved.updatedAt,
      readerUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = withResponseLogging(handler);
// Exported for unit tests that don't want the logging wrapper.
module.exports._raw = handler;
module.exports._slugify = slugify;
module.exports._validateBody = validateBody;
module.exports._readerHost = readerHost;
