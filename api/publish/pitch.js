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
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");
const { renderDeck, DECK_HEADINGS } = require("../_lib/deck-template.js");

const MAX_BYTES = 64 * 1024;
const MAX_TITLE_LEN = 24;
const MAX_PHRASES_PER_HEADING = 6;
const MAX_PHRASE_LEN = 600;

// The daily-beginner reader lives on the beginner repo. In production
// it's served from beginner.work; in Vercel preview deploys we want
// the matching beginner preview for the same git branch so the founder
// can test publish-then-view end-to-end inside a single PR.
//
// Resolution order:
//   1. BEGINNER_PUBLIC_URL env override (any env — handy for local dev).
//   2. Production tinker deploy → https://beginner.work.
//   3. Preview deploy → Vercel REST API lookup: find the latest READY
//      preview for the beginner project on the same githubCommitRef.
//      Requires VERCEL_TOKEN + VERCEL_TEAM_ID on the tinker Vercel
//      project. This is the verification step — it confirms a beginner
//      preview actually exists for this branch before handing back a
//      URL.
//   4. Fallback: swap the leading "tinker-git-" for "beginner-git-" in
//      VERCEL_BRANCH_URL (the stable branch alias — NOT VERCEL_URL,
//      which is a unique deployment hash that won't exist on the
//      beginner project).
//   5. Last resort: production beginner.work.
async function lookupBeginnerPreviewViaApi(ref) {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const projectId = process.env.BEGINNER_VERCEL_PROJECT || "beginner";
  if (!token || !teamId || !ref) return "";
  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("app", projectId);
  url.searchParams.set("target", "preview");
  url.searchParams.set("state", "READY");
  url.searchParams.set("meta-githubCommitRef", ref);
  url.searchParams.set("limit", "1");
  url.searchParams.set("teamId", teamId);
  let resp;
  try {
    resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return "";
  }
  if (!resp.ok) return "";
  let json;
  try { json = await resp.json(); }
  catch { return ""; }
  const dep = json && Array.isArray(json.deployments) ? json.deployments[0] : null;
  if (!dep) return "";
  const alias = dep.meta && dep.meta.branchAlias;
  if (alias) return `https://${alias}`;
  if (dep.url) return `https://${dep.url}`;
  return "";
}

function swapBranchAlias() {
  const branchUrl = process.env.VERCEL_BRANCH_URL || "";
  if (branchUrl.startsWith("tinker-git-")) {
    return `https://beginner-git-${branchUrl.slice("tinker-git-".length)}`;
  }
  return "";
}

async function readerHost() {
  const override = process.env.BEGINNER_PUBLIC_URL;
  if (override) return override.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production") return "https://beginner.work";
  if (process.env.VERCEL_ENV === "preview") {
    const ref = process.env.VERCEL_GIT_COMMIT_REF || "";
    const fromApi = await lookupBeginnerPreviewViaApi(ref);
    if (fromApi) return fromApi;
    const fromSwap = swapBranchAlias();
    if (fromSwap) return fromSwap;
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
    const readerUrl = `${await readerHost()}/daily/?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(parsed.slug)}`;
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
module.exports._lookupBeginnerPreviewViaApi = lookupBeginnerPreviewViaApi;
module.exports._swapBranchAlias = swapBranchAlias;
