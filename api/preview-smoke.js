/* POST /api/preview-smoke
 *
 * Called by .github/workflows/preview-smoke.yml on every successful
 * Vercel preview deployment_status event. The workflow POSTs to the
 * preview deploy's own URL — i.e. this function runs inside the same
 * deployment it's testing. That gives us native access to the
 * Browserbase keys from the Vercel project's preview env without
 * shuffling secrets to GitHub.
 *
 * Auth: a shared secret `PREVIEW_SMOKE_SECRET` must match between the
 * X-Smoke-Secret header and the env var. The caller also passes its
 * GITHUB_TOKEN via X-Github-Token so the function can upsert the
 * results comment back into the PR.
 *
 * Required Vercel project env (Preview scope):
 *   BROWSERBASE_API_KEY
 *   BROWSERBASE_PROJECT_ID
 *   PREVIEW_SMOKE_SECRET
 *
 * Request body (JSON):
 *   { previewUrl, sha, prNumber, repo }
 *
 * Response (200): { ok, sessionId, results, comment: { action, id } }
 * Response (4xx/5xx): { error }
 */

"use strict";

const path = require("path");

const {
  loadScenarios,
  runPreviewSmoke,
  renderComment,
  upsertComment,
} = require("./_lib/preview-smoke.js");

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const expectedSecret = process.env.PREVIEW_SMOKE_SECRET;
  if (!expectedSecret) {
    res.status(500).json({ error: "PREVIEW_SMOKE_SECRET not configured" });
    return;
  }
  const providedSecret = req.headers["x-smoke-secret"];
  if (!timingSafeEqual(String(providedSecret || ""), expectedSecret)) {
    res.status(401).json({ error: "bad smoke secret" });
    return;
  }

  const githubToken = req.headers["x-github-token"];
  if (!githubToken) {
    res.status(400).json({ error: "missing X-Github-Token header" });
    return;
  }

  const bbApiKey = process.env.BROWSERBASE_API_KEY;
  const bbProjectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!bbApiKey || !bbProjectId) {
    res.status(500).json({
      error: "BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID not configured",
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.status(400).json({ error: `invalid JSON body: ${err.message}` });
    return;
  }

  const { previewUrl, sha, prNumber, repo } = body || {};
  if (!previewUrl || !sha || !prNumber || !repo) {
    res.status(400).json({
      error: "body must include previewUrl, sha, prNumber, repo",
    });
    return;
  }

  // scenarios.json is bundled with the deployment because it sits inside
  // the repo. Vercel functions get a working directory under the project
  // root, so the relative path here resolves the same way as in the CLI.
  const scenariosPath = path.resolve(
    __dirname,
    "..",
    "tests",
    "preview",
    "scenarios.json",
  );
  const scenarios = loadScenarios(scenariosPath);
  if (scenarios.length === 0) {
    res.status(200).json({ ok: true, skipped: "no scenarios" });
    return;
  }

  let result;
  try {
    result = await runPreviewSmoke({
      previewUrl,
      scenarios,
      bbApiKey,
      bbProjectId,
      screenshotsDir: null,
    });
  } catch (err) {
    res.status(500).json({ error: `runPreviewSmoke failed: ${err.message}` });
    return;
  }

  const commentBody = renderComment({
    results: result.results,
    previewUrl,
    sha,
  });

  let comment;
  try {
    comment = await upsertComment({
      repo,
      prNumber,
      body: commentBody,
      token: githubToken,
    });
  } catch (err) {
    res.status(502).json({
      error: `upsertComment failed: ${err.message}`,
      sessionId: result.sessionId,
      results: result.results,
    });
    return;
  }

  res.status(200).json({
    ok: true,
    sessionId: result.sessionId,
    results: result.results.map(({ screenshotBase64, ...r }) => r),
    comment,
  });
};
