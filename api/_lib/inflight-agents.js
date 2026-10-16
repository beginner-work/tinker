/* Cursor Cloud Agents (v0) helpers for Tinker's in-flight view.
 *
 * Filters to titles starting with "Tinker:", "Learning:", or "Site:".
 * Hides archived agents. Derives a progress percent from status + PR link.
 * Never exposes CURSOR_API_KEY to callers beyond the server.
 *
 * Auth: Cursor Cloud Agents API accepts Basic (API key as username, empty
 * password) or Bearer; this module uses Basic per the v0 docs.
 * Upstream fetches abort after FETCH_TIMEOUT_MS so /api/inflight cannot hang.
 */

"use strict";

const CURSOR_API_BASE = "https://api.cursor.com";
const TITLE_PREFIX_RE = /^(Tinker|Learning|Site):\s*/i;
const POLL_HINT_MS = 30000;
/** Cap Cursor list calls so the PWA never waits forever on /inflight. */
const FETCH_TIMEOUT_MS = 8000;
const MAX_PAGES = 3;

function cursorApiKey() {
  return String(process.env.CURSOR_API_KEY || "").trim();
}

function cursorConfigured() {
  return !!cursorApiKey();
}

function titleMatches(name) {
  return TITLE_PREFIX_RE.test(String(name || "").trim());
}

function isArchived(agent) {
  if (!agent || typeof agent !== "object") return true;
  if (agent.archived === true || agent.isArchived === true) return true;
  const status = String(agent.status || "").toUpperCase();
  if (status === "ARCHIVED" || status === "EXPIRED") return true;
  return false;
}

function repoLabel(agent) {
  const repo =
    (agent.source && (agent.source.repository || agent.source.repo))
    || agent.repository
    || "";
  const raw = String(repo || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    if (parts.length >= 2) return parts[0] + "/" + parts[1].replace(/\.git$/, "");
  } catch {
    /* plain slug */
  }
  return raw.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
}

function progressFor(agent) {
  const status = String(agent && agent.status || "").toUpperCase();
  const prUrl = agent && agent.target && agent.target.prUrl
    ? String(agent.target.prUrl).trim()
    : "";
  const prMerged = !!(agent && agent.target && (
    agent.target.prMerged === true
    || agent.target.merged === true
    || String(agent.target.prState || "").toLowerCase() === "merged"
  ));

  if (status === "CREATING" || status === "NOT_YET_STARTED") {
    return { percent: 15, label: "Creating", state: "creating" };
  }
  if (status === "RUNNING" || status === "ACTIVE" || status === "WAITING_FOR_BACKGROUND_WORK") {
    return { percent: 55, label: "Running", state: "running" };
  }
  if (status === "ERROR") {
    return { percent: 100, label: "Stopped", state: "error" };
  }
  if (status === "FINISHED" || status === "IDLE") {
    if (prMerged) {
      return { percent: 100, label: "PR merged", state: "merged" };
    }
    if (prUrl) {
      return { percent: 90, label: "PR open", state: "pr_open" };
    }
    return { percent: 80, label: "Finished", state: "finished" };
  }
  return { percent: 40, label: status || "Working", state: "unknown" };
}

function presentAgent(agent) {
  const progress = progressFor(agent);
  const prUrl = agent && agent.target && agent.target.prUrl
    ? String(agent.target.prUrl).trim()
    : "";
  const updatedAt =
    agent.updatedAt
    || agent.completedAt
    || agent.createdAt
    || null;
  return {
    id: String(agent.id || ""),
    title: String(agent.name || "").trim(),
    repo: repoLabel(agent),
    state: progress.state,
    stateLabel: progress.label,
    progress: progress.percent,
    prUrl: prUrl || null,
    agentUrl: (agent.target && agent.target.url) || agent.url || null,
    updatedAt,
    createdAt: agent.createdAt || null,
    status: String(agent.status || ""),
  };
}

function filterInflight(agents) {
  const list = Array.isArray(agents) ? agents : [];
  return list
    .filter((a) => a && titleMatches(a.name) && !isArchived(a))
    .map(presentAgent)
    .sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
      const tb = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
      return tb - ta;
    });
}

function timeoutError(message) {
  const err = new Error(message || "Cursor agents request timed out.");
  err.status = 504;
  err.code = "timeout";
  return err;
}

function isAbortError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  if (err.code === "ABORT_ERR") return true;
  return /aborted|AbortError/i.test(String(err.message || ""));
}

async function fetchWithTimeout(fetchFn, url, init, timeoutMs) {
  const ms = Math.max(1, Number(timeoutMs) || FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch { /* ignore */ }
  }, ms);
  try {
    const opts = Object.assign({}, init || {}, { signal: controller.signal });
    return await fetchFn(url, opts);
  } catch (err) {
    if (isAbortError(err) || (controller.signal && controller.signal.aborted)) {
      throw timeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAgentsPage({
  limit = 100,
  cursor = "",
  fetchImpl,
  timeoutMs = FETCH_TIMEOUT_MS,
  signal,
} = {}) {
  const key = cursorApiKey();
  if (!key) return { agents: [], nextCursor: null, configured: false };

  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(100, Math.max(1, Number(limit) || 100))));
  if (cursor) params.set("cursor", String(cursor));

  const url = CURSOR_API_BASE + "/v0/agents?" + params.toString();
  // Basic auth: API key as username, empty password (Cursor v0 Cloud Agents).
  const auth = Buffer.from(key + ":").toString("base64");
  const headers = {
    Authorization: "Basic " + auth,
    Accept: "application/json",
  };

  let res;
  if (signal) {
    try {
      res = await fetchFn(url, { method: "GET", headers, signal });
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw timeoutError();
      throw err;
    }
  } else {
    res = await fetchWithTimeout(fetchFn, url, { method: "GET", headers }, timeoutMs);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error("Cursor agents request failed.");
    err.status = 502;
    err.upstreamStatus = res.status;
    err.detail = text.slice(0, 200);
    throw err;
  }

  const body = await res.json();
  const agents = Array.isArray(body.agents)
    ? body.agents
    : (Array.isArray(body.items) ? body.items : []);
  const nextCursor = body.nextCursor || body.next_cursor || null;
  return {
    agents,
    nextCursor: nextCursor ? String(nextCursor) : null,
    configured: true,
  };
}

async function listInflightAgents(opts) {
  const options = opts || {};
  if (!cursorConfigured()) {
    return {
      configured: false,
      agents: [],
      pollMs: POLL_HINT_MS,
    };
  }

  const budgetMs = Math.max(1, Number(options.timeoutMs) || FETCH_TIMEOUT_MS);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch { /* ignore */ }
  }, budgetMs);

  try {
    // Pull up to a few pages so title-filtered rows are not truncated.
    // Stop early when the shared deadline is nearly spent.
    let cursor = "";
    let all = [];
    const seenCursors = new Set();
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const remaining = budgetMs - (Date.now() - started);
      if (remaining <= 50) throw timeoutError();
      if (cursor) {
        if (seenCursors.has(cursor)) break;
        seenCursors.add(cursor);
      }
      const batch = await fetchAgentsPage({
        limit: 100,
        cursor,
        fetchImpl: options.fetchImpl,
        signal: controller.signal,
        timeoutMs: remaining,
      });
      all = all.concat(batch.agents || []);
      if (!batch.nextCursor) break;
      cursor = batch.nextCursor;
    }
    return {
      configured: true,
      agents: filterInflight(all),
      pollMs: POLL_HINT_MS,
    };
  } catch (err) {
    if (isAbortError(err) || (controller.signal && controller.signal.aborted)) {
      throw timeoutError();
    }
    // Propagate timeout / upstream failures so the client can show Retry
    // instead of hanging or bouncing to an empty writing surface.
    if (err && (err.code === "timeout" || err.status === 504 || err.status === 502)) {
      throw err;
    }
    const wrapped = new Error(
      err && err.message ? String(err.message) : "Could not load agents."
    );
    wrapped.status = 502;
    wrapped.cause = err;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  CURSOR_API_BASE,
  TITLE_PREFIX_RE,
  POLL_HINT_MS,
  FETCH_TIMEOUT_MS,
  MAX_PAGES,
  cursorConfigured,
  titleMatches,
  isArchived,
  progressFor,
  presentAgent,
  filterInflight,
  fetchAgentsPage,
  listInflightAgents,
  timeoutError,
  isAbortError,
};
