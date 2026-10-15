/* Cursor Cloud Agents (v0) helpers for Tinker's in-flight view.
 *
 * Filters to titles starting with "Tinker:", "Learning:", or "Site:".
 * Hides archived agents. Derives a progress percent from status + PR link.
 * Never exposes CURSOR_API_KEY to callers beyond the server.
 */

"use strict";

const CURSOR_API_BASE = "https://api.cursor.com";
const TITLE_PREFIX_RE = /^(Tinker|Learning|Site):\s*/i;
const POLL_HINT_MS = 30000;

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

async function fetchAgentsPage({ limit = 100, cursor = "", fetchImpl } = {}) {
  const key = cursorApiKey();
  if (!key) return { agents: [], nextCursor: null, configured: false };

  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(100, Math.max(1, Number(limit) || 100))));
  if (cursor) params.set("cursor", String(cursor));

  const url = CURSOR_API_BASE + "/v0/agents?" + params.toString();
  const auth = Buffer.from(key + ":").toString("base64");
  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      Authorization: "Basic " + auth,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error("Cursor agents request failed.");
    err.status = res.status >= 500 ? 502 : 502;
    err.upstreamStatus = res.status;
    err.detail = text.slice(0, 200);
    throw err;
  }

  const body = await res.json();
  const agents = Array.isArray(body.agents)
    ? body.agents
    : (Array.isArray(body.items) ? body.items : []);
  return {
    agents,
    nextCursor: body.nextCursor || null,
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

  try {
    // Pull up to a few pages so title-filtered rows are not truncated.
    let cursor = "";
    let all = [];
    for (let page = 0; page < 3; page += 1) {
      const batch = await fetchAgentsPage({
        limit: 100,
        cursor,
        fetchImpl: options.fetchImpl,
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
    // Missing/invalid key or upstream hiccup: empty state, not a hard error page.
    return {
      configured: true,
      agents: [],
      pollMs: POLL_HINT_MS,
      warning: err && err.message ? String(err.message) : "Could not load agents.",
    };
  }
}

module.exports = {
  CURSOR_API_BASE,
  TITLE_PREFIX_RE,
  POLL_HINT_MS,
  cursorConfigured,
  titleMatches,
  isArchived,
  progressFor,
  presentAgent,
  filterInflight,
  fetchAgentsPage,
  listInflightAgents,
};
