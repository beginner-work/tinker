/* /inflight - Notion-like list of in-flight Cursor cloud agents.
 *
 * Mobile: first screen when anything is in flight; otherwise bounce to /repo.
 * Desktop: optional entry; stays on this page even when empty (shows empty state).
 */
(function () {
  "use strict";

  var POLL_DEFAULT_MS = 30000;
  var TOKEN_KEY = "tinker_jwt";
  var timer = null;
  var els = {};

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }

  function isMobileFront() {
    try {
      return window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
    } catch (e) {
      return false;
    }
  }

  function wantsForceList() {
    try {
      return /(?:^|[?&])stay=1(?:&|$)/.test(window.location.search || "");
    } catch (e) {
      return false;
    }
  }

  function goWriting() {
    try { window.location.assign("/repo"); }
    catch (e) { window.location.href = "/repo"; }
  }

  function goSignIn() {
    try { window.location.assign("/?signin=1"); }
    catch (e) { window.location.href = "/?signin=1"; }
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    var t = Date.parse(iso);
    if (!t) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(t));
    } catch (e) {
      return String(iso);
    }
  }

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  function renderEmpty(configured) {
    setHidden(els.list, true);
    setHidden(els.empty, false);
    if (!configured) {
      els.empty.textContent =
        "No Cursor API key is set on this deploy. In-flight agents show here once CURSOR_API_KEY is configured.";
    } else {
      els.empty.textContent = "Nothing in flight right now.";
    }
  }

  function renderRows(agents) {
    setHidden(els.empty, true);
    setHidden(els.list, false);
    els.list.innerHTML = "";
    agents.forEach(function (agent) {
      var li = document.createElement("li");
      li.className = "inflight__row";
      li.setAttribute("data-agent-id", agent.id || "");

      var title = document.createElement("h2");
      title.className = "inflight__title";
      title.textContent = agent.title || "Untitled agent";

      var state = document.createElement("div");
      state.className = "inflight__state";
      state.textContent = agent.stateLabel || agent.state || "";

      var meta = document.createElement("div");
      meta.className = "inflight__meta";
      if (agent.repo) {
        var repo = document.createElement("span");
        repo.textContent = agent.repo;
        meta.appendChild(repo);
      }
      if (agent.prUrl) {
        var pr = document.createElement("a");
        pr.className = "inflight__pr";
        pr.href = agent.prUrl;
        pr.target = "_blank";
        pr.rel = "noopener noreferrer";
        pr.textContent = "Pull request";
        meta.appendChild(pr);
      }
      var when = fmtWhen(agent.updatedAt || agent.createdAt);
      if (when) {
        var updated = document.createElement("span");
        updated.textContent = when;
        meta.appendChild(updated);
      }

      var bar = document.createElement("div");
      bar.className = "inflight__bar";
      bar.setAttribute("data-state", agent.state || "");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      var pct = Math.max(0, Math.min(100, Number(agent.progress) || 0));
      bar.setAttribute("aria-valuenow", String(pct));
      var fill = document.createElement("span");
      fill.style.width = pct + "%";
      bar.appendChild(fill);

      li.appendChild(title);
      li.appendChild(state);
      li.appendChild(meta);
      li.appendChild(bar);
      els.list.appendChild(li);
    });
  }

  function applyPayload(payload) {
    var configured = !!(payload && payload.configured);
    var agents = payload && Array.isArray(payload.agents) ? payload.agents : [];
    setHidden(els.status, true);

    if (!agents.length) {
      if (isMobileFront() && configured && !wantsForceList()) {
        goWriting();
        return;
      }
      renderEmpty(configured);
      return;
    }
    renderRows(agents);
  }

  function fetchInflight() {
    var t = token();
    if (!t) {
      goSignIn();
      return Promise.resolve(null);
    }
    return fetch("/api/inflight", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + t,
      },
      cache: "no-store",
    }).then(function (res) {
      if (res.status === 401) {
        goSignIn();
        return null;
      }
      if (!res.ok) {
        // Soft empty state: never block the writing surface with a hard error.
        applyPayload({ configured: true, agents: [] });
        return null;
      }
      return res.json();
    }).then(function (body) {
      if (!body) return null;
      applyPayload(body);
      return body;
    }).catch(function () {
      applyPayload({ configured: true, agents: [] });
      return null;
    });
  }

  function schedulePoll(ms) {
    if (timer) clearInterval(timer);
    var every = Math.max(10000, Number(ms) || POLL_DEFAULT_MS);
    timer = setInterval(function () {
      if (document.hidden) return;
      fetchInflight();
    }, every);
  }

  function boot() {
    els.list = document.getElementById("inflight-list");
    els.empty = document.getElementById("inflight-empty");
    els.status = document.getElementById("inflight-status");
    els.write = document.getElementById("inflight-write");

    if (els.write) {
      els.write.addEventListener("click", function (event) {
        event.preventDefault();
        goWriting();
      });
    }

    if (!token()) {
      goSignIn();
      return;
    }

    if (els.status) {
      els.status.textContent = "Loading in-flight work…";
      setHidden(els.status, false);
    }

    fetchInflight().then(function (body) {
      schedulePoll(body && body.pollMs ? body.pollMs : POLL_DEFAULT_MS);
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) fetchInflight();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
