/* GitHub-backed polished exercise goals (not attempts).
 *
 * When GitHub is connected with Allow writes and the owner confirms once,
 * create a private `tinker-exercises` repo. Opus-rebuilt exercises publish
 * only the polished goal file + a short README. Attempts stay in Tinker.
 */

"use strict";

const prisma = require("./db.js");
const connectionStore = require("./mcp-connection-store.js");

const META_KIND = "github_exercise_repo";
const DEFAULT_REPO = "tinker-exercises";
const CONNECTOR_ID = "github";

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function clamp(text, max) {
  const s = text == null ? "" : String(text);
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function sanitizePath(rel) {
  return String(rel || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\\/g, "/")
    .replace(/\.\./g, "")
    .trim();
}

async function readMeta(userId) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: META_KIND } },
  });
  const data = (row && row.data) || {};
  return {
    confirmed: !!data.confirmed,
    confirmedAt: data.confirmedAt || null,
    owner: data.owner || null,
    repo: data.repo || DEFAULT_REPO,
    htmlUrl: data.htmlUrl || null,
  };
}

async function writeMeta(userId, data) {
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: META_KIND } },
    create: { userId, kind: META_KIND, data },
    update: { data },
  });
  return data;
}

async function githubFetch(accessToken, path, { method, body, fetchImpl } = {}) {
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn("https://api.github.com" + path, {
    method: method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + accessToken,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tinker-exercises",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function requireGithubToken(userId, fetchImpl, { needWrite } = {}) {
  const live = await connectionStore.getValidAccessToken({
    userId,
    connectorId: CONNECTOR_ID,
    fetchImpl,
  });
  if (!live || !live.accessToken) {
    throw fail(400, "Connect GitHub in Settings > Connections first.", "github_not_connected");
  }
  if (needWrite && !live.writeAccess) {
    throw fail(
      403,
      "Allow writes on GitHub in Connections before saving exercises.",
      "github_writes_off"
    );
  }
  return live;
}

async function requireGithubWrite(userId, fetchImpl) {
  return requireGithubToken(userId, fetchImpl, { needWrite: true });
}

function goalPaths(progress) {
  const dir = goalDir(progress);
  const practicePath = sanitizePath(progress && progress.practicePath) || "goal.md";
  const fileName = practicePath.split("/").pop() || "goal.md";
  return {
    dir,
    fileName,
    goalPath: dir + "/" + fileName,
    readmePath: dir + "/README.md",
  };
}

/**
 * Confirm once, then create private tinker-exercises if missing.
 */
async function confirmAndEnsureRepo({ userId, confirmed, fetchImpl } = {}) {
  const uid = String(userId || "").trim();
  if (!uid) throw fail(401, "Sign in required.");
  if (!confirmed) {
    throw fail(400, "Confirm creating a private tinker-exercises repo first.", "needs_confirm");
  }
  const live = await requireGithubWrite(uid, fetchImpl);
  const me = await githubFetch(live.accessToken, "/user", { fetchImpl });
  if (!me.ok || !me.json || !me.json.login) {
    throw fail(502, "Could not read GitHub user.", "github_user_failed");
  }
  const owner = String(me.json.login);
  const repoName = DEFAULT_REPO;
  let htmlUrl = null;
  const existing = await githubFetch(
    live.accessToken,
    "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repoName),
    { fetchImpl }
  );
  if (existing.status === 404) {
    const created = await githubFetch(live.accessToken, "/user/repos", {
      method: "POST",
      fetchImpl,
      body: {
        name: repoName,
        private: true,
        description: "Polished Tinker coding exercise goals (no attempts).",
        auto_init: true,
      },
    });
    if (!created.ok) {
      throw fail(
        502,
        (created.json && created.json.message) || "Could not create tinker-exercises.",
        "github_create_failed"
      );
    }
    htmlUrl = created.json && created.json.html_url;
  } else if (existing.ok) {
    htmlUrl = existing.json && existing.json.html_url;
  } else {
    throw fail(502, "Could not check tinker-exercises repo.", "github_repo_failed");
  }

  const meta = await writeMeta(uid, {
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    owner,
    repo: repoName,
    htmlUrl: htmlUrl || null,
  });
  return { ok: true, meta };
}

function goalDir(progress) {
  const goalId = clamp(progress && progress.goalId, 80).trim() || "exercise";
  const safe = goalId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "exercise";
  return "exercises/" + safe;
}

function readmeFor(progress) {
  const title = clamp((progress && progress.goalTitle) || "Coding exercise", 200);
  const prompt = clamp((progress && progress.currentPrompt) || "", 600);
  const source = clamp((progress && progress.sourceEssayTitle) || "", 200);
  const lines = ["# " + title, ""];
  if (source) lines.push("From essay: " + source, "");
  if (prompt) lines.push(prompt, "");
  lines.push(
    "This repo holds only the polished goal code for each exercise.",
    "Attempts stay in Tinker."
  );
  return lines.join("\n") + "\n";
}

async function putFile({
  accessToken,
  owner,
  repo,
  path,
  content,
  message,
  fetchImpl,
}) {
  const encPath = String(path)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const apiPath =
    "/repos/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(repo) +
    "/contents/" +
    encPath;
  const existing = await githubFetch(accessToken, apiPath, { fetchImpl });
  const body = {
    message: message || "Update exercise goal",
    content: Buffer.from(content == null ? "" : String(content), "utf8").toString(
      "base64"
    ),
  };
  if (existing.ok && existing.json && existing.json.sha) {
    body.sha = existing.json.sha;
  }
  const put = await githubFetch(accessToken, apiPath, {
    method: "PUT",
    body,
    fetchImpl,
  });
  if (!put.ok) {
    throw fail(
      502,
      (put.json && put.json.message) || "Could not write GitHub file.",
      "github_put_failed"
    );
  }
  return put.json;
}

/**
 * Publish polished goal only (never attempts / intermediate drafts).
 */
async function publishPolishedGoal({
  userId,
  progress,
  polishedContent,
  fetchImpl,
} = {}) {
  const uid = String(userId || "").trim();
  if (!uid) throw fail(401, "Sign in required.");
  const meta = await readMeta(uid);
  if (!meta.confirmed || !meta.owner || !meta.repo) {
    return { ok: false, skipped: true, reason: "not_confirmed" };
  }
  const live = await requireGithubWrite(uid, fetchImpl);
  const { goalPath, readmePath } = goalPaths(progress);
  const content = polishedContent == null ? "" : String(polishedContent);
  // Reject instructional scaffolds in published goal code.
  if (
    /<!--\s*(Document|TODO|Write|Type your|ask\s*=|send\s*=|return\s*=)/i.test(content) ||
    /^\/\/\s*(TODO|Write your|Implement|Your task)/im.test(content) ||
    /^#\s*(TODO|Type your|Re-type your|Do not paste)\b/im.test(content) ||
    /headings below map/i.test(content)
  ) {
    throw fail(
      400,
      "Polished goal code must not include instructional scaffolds.",
      "scaffold_rejected"
    );
  }
  await putFile({
    accessToken: live.accessToken,
    owner: meta.owner,
    repo: meta.repo,
    path: readmePath,
    content: readmeFor(progress),
    message: "docs: goal README for " + (progress && progress.goalId),
    fetchImpl,
  });
  await putFile({
    accessToken: live.accessToken,
    owner: meta.owner,
    repo: meta.repo,
    path: goalPath,
    content,
    message: "goal: polished " + (progress && progress.goalId),
    fetchImpl,
  });
  return {
    ok: true,
    skipped: false,
    owner: meta.owner,
    repo: meta.repo,
    goalPath,
    readmePath,
    htmlUrl: meta.htmlUrl,
  };
}

/**
 * Load polished goal from GitHub for desktop. Read-only (no Allow writes).
 * Callers fall back to Tinker storage when skipped / missing.
 */
async function loadPolishedGoal({ userId, progress, fetchImpl } = {}) {
  const uid = String(userId || "").trim();
  if (!uid) throw fail(401, "Sign in required.");
  const meta = await readMeta(uid);
  if (!meta.confirmed || !meta.owner || !meta.repo) {
    return { ok: false, skipped: true, reason: "not_confirmed", fallback: "tinker" };
  }
  let live;
  try {
    live = await requireGithubToken(uid, fetchImpl, { needWrite: false });
  } catch (err) {
    if (err && err.code === "github_not_connected") {
      return { ok: false, skipped: true, reason: "github_not_connected", fallback: "tinker" };
    }
    throw err;
  }
  const { goalPath } = goalPaths(progress);
  const apiPath =
    "/repos/" +
    encodeURIComponent(meta.owner) +
    "/" +
    encodeURIComponent(meta.repo) +
    "/contents/" +
    goalPath
      .split("/")
      .map(encodeURIComponent)
      .join("/");
  const got = await githubFetch(live.accessToken, apiPath, { fetchImpl });
  if (got.status === 404) {
    return {
      ok: false,
      skipped: true,
      reason: "missing",
      fallback: "tinker",
      goalPath,
    };
  }
  if (!got.ok || !got.json) {
    return {
      ok: false,
      skipped: true,
      reason: "github_read_failed",
      fallback: "tinker",
      error: (got.json && got.json.message) || "Could not read goal from GitHub.",
    };
  }
  let content = "";
  if (got.json.encoding === "base64" && got.json.content) {
    content = Buffer.from(String(got.json.content).replace(/\s+/g, ""), "base64").toString(
      "utf8"
    );
  } else if (typeof got.json.content === "string") {
    content = got.json.content;
  }
  return {
    ok: true,
    skipped: false,
    source: "github",
    content,
    goalPath,
    owner: meta.owner,
    repo: meta.repo,
    htmlUrl: meta.htmlUrl,
    fallback: "tinker",
  };
}

async function status({ userId, fetchImpl } = {}) {
  const uid = String(userId || "").trim();
  if (!uid) throw fail(401, "Sign in required.");
  const meta = await readMeta(uid);
  let connected = false;
  let writeAccess = false;
  try {
    const live = await connectionStore.getValidAccessToken({
      userId: uid,
      connectorId: CONNECTOR_ID,
      fetchImpl,
    });
    connected = !!(live && live.accessToken);
    writeAccess = !!(live && live.writeAccess);
  } catch {
    connected = false;
  }
  return {
    connected,
    writeAccess,
    confirmed: !!meta.confirmed,
    owner: meta.owner,
    repo: meta.repo,
    htmlUrl: meta.htmlUrl,
    fallback: "tinker",
  };
}

module.exports = {
  META_KIND,
  DEFAULT_REPO,
  CONNECTOR_ID,
  readMeta,
  writeMeta,
  confirmAndEnsureRepo,
  publishPolishedGoal,
  loadPolishedGoal,
  status,
  goalDir,
  goalPaths,
  readmeFor,
  sanitizePath,
};
