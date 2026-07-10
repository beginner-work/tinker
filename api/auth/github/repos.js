/* GET/PUT /api/auth/github/repos — the repo picker's backend.
 *
 * GET  → { repos: [{ id, fullName, private, description, updatedAt }],
 *          selected: ["owner/name", ...] }
 * PUT  → body { repos: ["owner/name", ...] } → { ok, selected }
 *
 * Auth: Bearer session token, re-validated against Stytch on every call
 * (same pattern as /api/user-data/*). The GitHub access token stored by
 * the OAuth callback is read server-side to list repositories; it never
 * leaves this function. The saved selection is tinker's own scope —
 * features that touch GitHub read `selectedRepos` and ignore everything
 * else, even though the OAuth grant is broader.
 */

"use strict";

const { resolveUserId, readJsonBody } = require("../../_lib/user-data.js");
const prisma = require("../../_lib/db.js");
const { listRepos } = require("../../_lib/github.js");
const { withResponseLogging } = require("../../_lib/log.js");

const GITHUB_KIND = "github";
// Sanity cap — nobody hand-picks more repos than this in a UI.
const MAX_SELECTED = 500;

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
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
    const row = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: GITHUB_KIND } },
    });
    const conn = row && row.data && typeof row.data === "object" ? row.data : null;
    if (!conn || !conn.accessToken) {
      res.status(409).json({
        error: "No GitHub account is connected — sign in with GitHub first.",
      });
      return;
    }

    if (req.method === "GET") {
      const repos = await listRepos(conn.accessToken);
      res.status(200).json({
        repos,
        selected: Array.isArray(conn.selectedRepos) ? conn.selectedRepos : [],
      });
      return;
    }

    const body = await readJsonBody(req);
    const repos = body && body.repos;
    if (!Array.isArray(repos) || repos.some((r) => typeof r !== "string")) {
      res.status(400).json({
        error: "Body must include a `repos` array of \"owner/name\" strings.",
      });
      return;
    }
    const selectedRepos = [
      ...new Set(repos.map((r) => r.trim()).filter(Boolean)),
    ].slice(0, MAX_SELECTED);

    const data = { ...conn, selectedRepos };
    await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: GITHUB_KIND } },
      create: { userId, kind: GITHUB_KIND, data },
      update: { data },
    });
    res.status(200).json({ ok: true, selected: selectedRepos });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || "Internal error" });
  }
});
