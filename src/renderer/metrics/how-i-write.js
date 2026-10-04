/* /metrics/how-i-write — owner-only learning view from edit logs. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var sortKey = "startedAt";
  var sortDir = "desc";
  var sessions = [];

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function authHeaders() {
    return { Authorization: "Bearer " + token(), Accept: "application/json" };
  }
  function setStatus(msg, isError) {
    var el = document.getElementById("hiw-status");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "var(--color-danger, #b42318)" : "var(--color-muted)";
  }
  function fmtMs(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (n < 1000) return Math.round(n) + " ms";
    if (n < 60000) return (Math.round(n / 100) / 10) + " s";
    return (Math.round(n / 6000) / 10) + " m";
  }
  function fmtPct(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    return Math.round(n * 1000) / 10 + "%";
  }
  function fmtNum(n, digits) {
    if (n == null || !Number.isFinite(n)) return "—";
    var d = digits == null ? 1 : digits;
    return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
  }

  function lineChart(values, label) {
    var wrap = document.createElement("div");
    wrap.className = "how-i-write__chart";
    var title = document.createElement("p");
    title.className = "how-i-write__chart-title";
    title.textContent = label;
    wrap.appendChild(title);
    var nums = (values || []).map(function (v) {
      return v == null || !Number.isFinite(v) ? null : v;
    });
    var present = nums.filter(function (v) { return v != null; });
    if (present.length < 2) {
      var empty = document.createElement("p");
      empty.className = "how-i-write__chart-empty";
      empty.textContent = present.length ? "Need another week to draw a line." : "No data yet.";
      wrap.appendChild(empty);
      return wrap;
    }
    var min = Math.min.apply(null, present);
    var max = Math.max.apply(null, present);
    if (min === max) { min -= 1; max += 1; }
    var w = 240;
    var h = 72;
    var pad = 6;
    var pts = [];
    for (var i = 0; i < nums.length; i++) {
      if (nums[i] == null) continue;
      var x = pad + (i / Math.max(1, nums.length - 1)) * (w - pad * 2);
      var y = h - pad - ((nums[i] - min) / (max - min)) * (h - pad * 2);
      pts.push(x.toFixed(1) + "," + y.toFixed(1));
    }
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    var poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", "currentColor");
    poly.setAttribute("stroke-width", "2");
    poly.setAttribute("stroke-linejoin", "round");
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("points", pts.join(" "));
    svg.appendChild(poly);
    wrap.appendChild(svg);
    return wrap;
  }

  function renderCharts(trends) {
    var root = document.getElementById("hiw-charts");
    if (!root) return;
    root.innerHTML = "";
    var rows = trends || [];
    var charts = [
      ["Flow minutes", rows.map(function (r) { return r.flowMinutes; })],
      ["Longest stretch (ms)", rows.map(function (r) { return r.longestStretchMs; })],
      ["Time to first word", rows.map(function (r) { return r.timeToFirstWordMs; })],
      ["Typing pace (chars/min)", rows.map(function (r) { return r.typingPace; })],
      ["Share of time paused", rows.map(function (r) { return r.pauseShare; })],
      ["Pauses over 10s / session", rows.map(function (r) { return r.pausesOver10s; })],
      ["Revision ratio", rows.map(function (r) { return r.revisionRatio; })],
      ["Early-edit share", rows.map(function (r) { return r.earlyEditShare; })],
      ["Keep crafting rounds", rows.map(function (r) { return r.keepCraftingRounds; })],
      ["Session length", rows.map(function (r) { return r.sessionLengthMs; })],
      ["Words kept", rows.map(function (r) { return r.wordsKept; })],
    ];
    charts.forEach(function (pair) {
      root.appendChild(lineChart(pair[1], pair[0]));
    });
  }

  function sortedSessions() {
    var rows = sessions.slice();
    rows.sort(function (a, b) {
      var av = a[sortKey];
      var bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }

  function renderSessions() {
    var el = document.getElementById("hiw-sessions");
    if (!el) return;
    var rows = sortedSessions();
    if (!rows.length) {
      el.innerHTML = '<p class="metrics__muted">No owner sessions recorded yet. Writing from this release forward fills this in.</p>';
      return;
    }
    var cols = [
      ["startedAt", "Started"],
      ["contextTag", "Tag"],
      ["flowMinutes", "Flow min"],
      ["timeToFirstWordMs", "First word"],
      ["typingPace", "Pace"],
      ["pauseShare", "Paused"],
      ["revisionRatio", "Revise"],
      ["keepCraftingRounds", "KC"],
      ["wordsKept", "Words"],
    ];
    var html = '<table class="metrics__table"><thead><tr>';
    cols.forEach(function (c) {
      var dir = sortKey === c[0] ? sortDir : "";
      html += '<th><button type="button" class="how-i-write__th-btn" data-sort="' + c[0] + '"' +
        (dir ? ' data-dir="' + dir + '"' : "") + ">" + c[1] + "</button></th>";
    });
    html += "<th></th></tr></thead><tbody>";
    rows.forEach(function (s) {
      var when = s.startedDay
        || (s.startedAt ? new Date(s.startedAt).toISOString().slice(0, 10) : "—");
      html += "<tr>" +
        "<td>" + when + "</td>" +
        "<td>" + (s.contextTag || "—") + "</td>" +
        "<td>" + fmtNum(s.flowMinutes, 1) + "</td>" +
        "<td>" + fmtMs(s.timeToFirstWordMs) + "</td>" +
        "<td>" + fmtNum(s.typingPace, 0) + "</td>" +
        "<td>" + fmtPct(s.pauseShare) + "</td>" +
        "<td>" + fmtPct(s.revisionRatio) + "</td>" +
        "<td>" + fmtNum(s.keepCraftingRounds, 1) + "</td>" +
        "<td>" + (s.wordsKept != null ? s.wordsKept : "—") + "</td>" +
        '<td><button type="button" data-session="' + s.sessionId + '">Open</button></td>' +
        "</tr>";
    });
    html += "</tbody></table>";
    el.innerHTML = html;
    el.querySelectorAll("[data-sort]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-sort");
        if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortKey = key; sortDir = key === "startedAt" ? "desc" : "desc"; }
        renderSessions();
      });
    });
    el.querySelectorAll("[data-session]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        loadDetail(btn.getAttribute("data-session"));
      });
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderDetail(detail) {
    var section = document.getElementById("hiw-detail-section");
    var label = document.getElementById("hiw-detail-label");
    var root = document.getElementById("hiw-detail");
    if (!section || !root || !label) return;
    section.hidden = false;
    label.textContent = (detail.startedAt
      ? new Date(detail.startedAt).toISOString().replace("T", " ").slice(0, 19)
      : "Session") + " · " + detail.wordsKept + " words kept · " +
      fmtPct(detail.revisionRatio) + " revised";

    var html = '<div class="how-i-write__detail-grid">';

    html += "<div><h3 class=\"metrics__subhead\">Revisions by paragraph</h3>";
    if (!detail.revisionsByParagraph || !detail.revisionsByParagraph.length) {
      html += '<p class="metrics__muted">No paragraph revisions.</p>';
    } else {
      html += '<table class="metrics__table"><thead><tr><th>Paragraph</th><th>Deleted chars</th></tr></thead><tbody>';
      detail.revisionsByParagraph.forEach(function (r) {
        html += "<tr><td>" + r.paragraph + "</td><td>" + r.deletedChars + "</td></tr>";
      });
      html += "</tbody></table>";
    }
    html += "</div>";

    html += "<div><h3 class=\"metrics__subhead\">Longest pauses</h3>";
    if (!detail.longestPauses || !detail.longestPauses.length) {
      html += '<p class="metrics__muted">No long pauses.</p>';
    } else {
      html += '<table class="metrics__table"><thead><tr><th>At</th><th>Duration</th><th>Doc position</th></tr></thead><tbody>';
      detail.longestPauses.forEach(function (p) {
        html += "<tr><td>" + fmtMs(p.t) + "</td><td>" + fmtMs(p.durationMs) +
          "</td><td>" + p.pos + " / " + p.docLen + "</td></tr>";
      });
      html += "</tbody></table>";
    }
    html += "</div>";

    html += "<div><h3 class=\"metrics__subhead\">Most-revised passages</h3>";
    if (!detail.mostRevisedPassages || !detail.mostRevisedPassages.length) {
      html += '<p class="metrics__muted">No revised passages yet.</p>';
    } else {
      detail.mostRevisedPassages.forEach(function (p) {
        html += '<p class="metrics__muted">Deleted ' + p.dels + " chars near position " + p.pos + "</p>";
        html += '<pre class="how-i-write__diff"><del>' + escapeHtml(p.before) +
          "</del>\n---\n<ins>" + escapeHtml(p.after) + "</ins></pre>";
      });
    }
    html += "</div>";

    html += "<div><h3 class=\"metrics__subhead\">Flow stretches</h3>";
    if (!detail.flowStretches || !detail.flowStretches.length) {
      html += '<p class="metrics__muted">No 3+ minute flow stretches (30s pause rule).</p>';
    } else {
      html += '<table class="metrics__table"><thead><tr><th>Start</th><th>Length</th><th>Started by</th><th>Ended by</th></tr></thead><tbody>';
      detail.flowStretches.forEach(function (s) {
        html += "<tr><td>" + fmtMs(s.startMs) + "</td><td>" + fmtMs(s.lengthMs) +
          "</td><td>" + escapeHtml(s.startCause) +
          (s.startPromptId ? " · " + escapeHtml(s.startPromptId) : "") +
          (s.startSurfaceId ? " · " + escapeHtml(s.startSurfaceId) : "") +
          "</td><td>" + escapeHtml(s.endCause) +
          (s.endPromptId ? " · " + escapeHtml(s.endPromptId) : "") +
          (s.endSurfaceId ? " · " + escapeHtml(s.endSurfaceId) : "") +
          "</td></tr>";
      });
      html += "</tbody></table>";
    }
    html += "</div></div>";
    root.innerHTML = html;
    try { section.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { /* ignore */ }
  }

  function renderTiming(timing) {
    var root = document.getElementById("hiw-timing");
    if (!root) return;
    if (!timing) {
      root.innerHTML = '<p class="metrics__muted">No flow timing yet.</p>';
      return;
    }
    var dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var html = '<p class="metrics__muted">Timezone: ' + escapeHtml(timing.timeZone || "America/Los_Angeles") + "</p>";
    html += '<div class="how-i-write__bars"><h3 class="metrics__subhead">By hour</h3><ul>';
    (timing.flowMinutesByHour || []).forEach(function (v, i) {
      if (!v) return;
      html += "<li><span>" + i + ":00</span> <strong>" + fmtNum(v, 1) + " min</strong></li>";
    });
    html += '</ul></div><div class="how-i-write__bars"><h3 class="metrics__subhead">By weekday</h3><ul>';
    (timing.flowMinutesByDow || []).forEach(function (v, i) {
      if (!v) return;
      html += "<li><span>" + dow[i] + "</span> <strong>" + fmtNum(v, 1) + " min</strong></li>";
    });
    html += "</ul></div>";
    root.innerHTML = html;
  }

  function renderRankings(rankings) {
    var root = document.getElementById("hiw-rankings");
    if (!root) return;
    if (!rankings) {
      root.innerHTML = '<p class="metrics__muted">No surface/prompt rankings yet.</p>';
      return;
    }
    function table(title, rows, idKey) {
      var h = "<div><h3 class=\"metrics__subhead\">" + title + "</h3>";
      if (!rows || !rows.length) {
        h += '<p class="metrics__muted">None yet.</p></div>';
        return h;
      }
      h += '<table class="metrics__table"><thead><tr><th>Id</th><th>Starts flow</th><th>Breaks flow</th></tr></thead><tbody>';
      rows.slice(0, 12).forEach(function (r) {
        h += "<tr><td>" + escapeHtml(r[idKey] || (r.promptId + "::" + r.variantId)) +
          "</td><td>" + r.startsFlow + "</td><td>" + r.breaksFlow + "</td></tr>";
      });
      h += "</tbody></table></div>";
      return h;
    }
    root.innerHTML =
      '<div class="how-i-write__rank-grid">' +
      table("Surfaces", rankings.surfaces, "surfaceId") +
      table("Prompts", rankings.prompts, "promptId") +
      table("Prompt variants", rankings.promptVariants, "promptId") +
      "</div>";
  }

  function renderTags(rows) {
    var root = document.getElementById("hiw-tags");
    if (!root) return;
    if (!rows || !rows.length) {
      root.innerHTML = '<p class="metrics__muted">Tag sessions via MCP <code>tag_writing_session</code> to group here.</p>';
      return;
    }
    var html = '<table class="metrics__table"><thead><tr><th>Tag</th><th>Sessions</th><th>Flow min</th><th>First word</th><th>Revise</th><th>Words</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += "<tr><td>" + escapeHtml(r.contextTag || "(untagged)") +
        "</td><td>" + r.sessions +
        "</td><td>" + fmtNum(r.flowMinutes, 1) +
        "</td><td>" + fmtMs(r.timeToFirstWordMs) +
        "</td><td>" + fmtPct(r.revisionRatio) +
        "</td><td>" + fmtNum(r.wordsKept, 0) + "</td></tr>";
    });
    html += "</tbody></table>";
    root.innerHTML = html;
  }

  function loadDetail(sessionId) {
    if (!token() || !sessionId) return;
    setStatus("Loading session…");
    fetch("/api/analytics?action=how_i_write_session&sessionId=" + encodeURIComponent(sessionId), {
      headers: authHeaders(),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Could not load session.");
        return res.json();
      })
      .then(function (json) {
        setStatus("");
        renderDetail(json);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not load session.", true);
      });
  }

  function load() {
    if (!token()) {
      try { sessionStorage.setItem("tinker_mcp_return", "/metrics/how-i-write"); } catch (e) { /* ignore */ }
      window.location.assign("/?signin=1");
      return;
    }
    setStatus("Loading…");
    fetch("/api/analytics?action=how_i_write", { headers: authHeaders() })
      .then(function (res) {
        if (res.status === 403) throw Object.assign(new Error("Not available for this account."), { status: 403 });
        if (res.status === 401) throw Object.assign(new Error("Sign in required."), { status: 401 });
        if (!res.ok) throw new Error("Could not load How I write.");
        return res.json();
      })
      .then(function (json) {
        setStatus("");
        var summary = document.getElementById("hiw-summary");
        if (summary) summary.textContent = (json.summary && json.summary.text) || "";
        renderCharts(json.trends || []);
        renderTiming(json.timing || null);
        renderRankings(json.rankings || null);
        renderTags(json.byContextTag || []);
        sessions = json.sessions || [];
        renderSessions();
        var q = new URLSearchParams(window.location.search || "");
        var sid = q.get("session");
        if (sid) loadDetail(sid);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not load.", true);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
