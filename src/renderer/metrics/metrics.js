/* /metrics — owner-only first-party analytics dashboard. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var days = 7;
  var filterTimer = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function authHeaders() {
    return { Authorization: "Bearer " + token(), Accept: "application/json" };
  }
  function setStatus(msg, isError) {
    var el = document.getElementById("metrics-status");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "var(--color-danger, #b42318)" : "var(--color-muted)";
  }
  function fmtPct(n) {
    if (!Number.isFinite(n)) return "—";
    return Math.round(n * 1000) / 10 + "%";
  }
  function fmtMs(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (n < 1000) return Math.round(n) + " ms";
    return (Math.round(n / 100) / 10) + " s";
  }

  function renderFunnel(funnel) {
    var root = document.getElementById("metrics-funnel");
    if (!root) return;
    root.innerHTML = "";
    var max = 1;
    (funnel || []).forEach(function (row) {
      if (row.unique > max) max = row.unique;
    });
    (funnel || []).forEach(function (row) {
      var line = document.createElement("div");
      line.className = "metrics__funnel-row";
      var label = document.createElement("div");
      label.textContent = row.name;
      var barWrap = document.createElement("div");
      barWrap.className = "metrics__bar";
      var bar = document.createElement("span");
      bar.style.width = Math.max(2, Math.round((row.unique / max) * 100)) + "%";
      barWrap.appendChild(bar);
      var count = document.createElement("div");
      count.textContent = String(row.unique);
      line.appendChild(label);
      line.appendChild(barWrap);
      line.appendChild(count);
      root.appendChild(line);
    });
  }

  function renderTable(el, headers, rows) {
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = '<p class="metrics__muted">No data yet.</p>';
      return;
    }
    var html = "<table class=\"metrics__table\"><thead><tr>";
    headers.forEach(function (h) { html += "<th>" + h + "</th>"; });
    html += "</tr></thead><tbody>";
    rows.forEach(function (cols) {
      html += "<tr>";
      cols.forEach(function (c) { html += "<td>" + c + "</td>"; });
      html += "</tr>";
    });
    html += "</tbody></table>";
    el.innerHTML = html;
  }

  function renderDau(rows) {
    renderTable(
      document.getElementById("metrics-dau"),
      ["Day", "Writers"],
      (rows || []).map(function (r) { return [r.day, String(r.writers)]; })
    );
  }

  function renderDay2(d) {
    var el = document.getElementById("metrics-day2");
    if (!el) return;
    if (!d || !d.eligible) {
      el.textContent = "Not enough day pairs yet.";
      return;
    }
    el.textContent = fmtPct(d.rate) + " (" + d.returned + " / " + d.eligible + " eligible day pairs)";
  }

  function renderDevices(split) {
    var el = document.getElementById("metrics-devices");
    if (!el) return;
    var s = split || {};
    el.innerHTML =
      "Phone: " + ((s.phone && s.phone.unique) || 0) + " unique<br>" +
      "Tablet: " + ((s.tablet && s.tablet.unique) || 0) + " unique<br>" +
      "Desktop: " + ((s.desktop && s.desktop.unique) || 0) + " unique";
  }

  function renderSources(sources) {
    var el = document.getElementById("metrics-sources");
    if (!el) return;
    if (!sources || !sources.length) {
      el.innerHTML = '<p class="metrics__muted">No sources yet.</p>';
      return;
    }
    var html = "<table class=\"metrics__table\"><thead><tr><th>Source</th><th>Subjects</th><th>Campaigns</th></tr></thead><tbody>";
    sources.forEach(function (s) {
      var camps = (s.campaigns || []).map(function (c) {
        return c.campaign + " (" + c.subjects + ")";
      }).join(", ");
      html += "<tr><td>" + s.source + "</td><td>" + s.subjects + "</td><td>" +
        (camps || "—") + "</td></tr>";
    });
    html += "</tbody></table>";
    el.innerHTML = html;
  }

  function renderWriting(wb) {
    var el = document.getElementById("metrics-writing");
    if (!el) return;
    wb = wb || {};
    if (!wb.sessions) {
      el.textContent = "No writing sessions in this range.";
      return;
    }
    el.innerHTML =
      "Sessions: " + wb.sessions + "<br>" +
      "Keys / min: " + wb.keysPerMinute + "<br>" +
      "Active typing: " + fmtMs(wb.activeTypingMs) + " avg<br>" +
      "Pauses &gt;2s: " + wb.pausesOver2s + " avg · &gt;10s: " + wb.pausesOver10s + " avg<br>" +
      "Avg burst length: " + wb.avgBurstLength + "<br>" +
      "Backspace/delete ratio: " + wb.backspaceDeleteRatio + "<br>" +
      "Pastes / session: " + wb.pasteCount + "<br>" +
      "Time to first word: " + fmtMs(wb.timeToFirstWordMs) + "<br>" +
      "First word → This is everything: " + fmtMs(wb.timeFirstWordToDoneMs);
  }

  function renderSessions(list) {
    var el = document.getElementById("metrics-sessions");
    if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = '<p class="metrics__muted">No sessions yet.</p>';
      return;
    }
    var html = "<table class=\"metrics__table\"><thead><tr>" +
      "<th>Started</th><th>Keys</th><th>KPM</th><th>Pauses&gt;2s</th><th></th>" +
      "</tr></thead><tbody>";
    list.forEach(function (s) {
      var when = s.startedAt ? new Date(s.startedAt).toISOString().replace("T", " ").slice(0, 16) : "—";
      html += "<tr><td>" + when + "</td><td>" + s.keyCount + "</td><td>" + s.keysPerMinute +
        "</td><td>" + s.pausesOver2s + "</td><td>" +
        "<button type=\"button\" data-session=\"" + s.sessionId + "\">Timeline</button>" +
        "</td></tr>";
    });
    html += "</tbody></table>";
    el.innerHTML = html;
    el.querySelectorAll("[data-session]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        loadTimeline(btn.getAttribute("data-session"));
      });
    });
  }

  function renderTimeline(data) {
    var label = document.getElementById("metrics-timeline-label");
    var root = document.getElementById("metrics-timeline");
    if (!root || !label) return;
    if (!data || !data.timeline || !data.timeline.length) {
      label.textContent = "No timeline for this session.";
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    label.textContent = "Session " + data.sessionId.slice(0, 10) + "… · " +
      (data.metrics && data.metrics.keyCount || 0) + " keys · " +
      (data.metrics && data.metrics.keysPerMinute || 0) + " kpm";
    root.hidden = false;
    var pts = data.timeline;
    var maxT = pts[pts.length - 1].t || 1;
    var maxRate = 1;
    pts.forEach(function (p) { if (p.rate > maxRate) maxRate = p.rate; });
    var w = 600;
    var h = 120;
    var pad = 8;
    var parts = [];
    parts.push('<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Typing rate over time">');
    pts.forEach(function (p) {
      var x = pad + (p.t / maxT) * (w - pad * 2);
      var barH = Math.max(1, (p.rate / maxRate) * (h - pad * 2));
      var y = h - pad - barH;
      parts.push('<rect x="' + x + '" y="' + y + '" width="3" height="' + barH + '" fill="currentColor" opacity="0.55"/>');
      if (p.del) {
        parts.push('<rect x="' + x + '" y="' + (h - pad - 4) + '" width="3" height="4" fill="#b42318" opacity="0.85"/>');
      }
      if (p.pause) {
        parts.push('<line x1="' + x + '" y1="' + pad + '" x2="' + x + '" y2="' + (h - pad) + '" stroke="currentColor" stroke-opacity="0.25" stroke-dasharray="2 3"/>');
      }
    });
    parts.push("</svg>");
    root.innerHTML = parts.join("");
  }

  function renderEvents(events) {
    renderTable(
      document.getElementById("metrics-events"),
      ["When", "Name", "Path", "Device", "Source"],
      (events || []).map(function (e) {
        var when = e.ts ? new Date(e.ts).toISOString().replace("T", " ").slice(0, 19) : "—";
        var source = e.utmSource || e.referrerHost || "direct";
        return [when, e.name, e.path || "/", e.deviceType || "", source];
      })
    );
  }

  function loadSummary() {
    if (!token()) {
      setStatus("Sign in to view metrics.", true);
      return Promise.resolve();
    }
    setStatus("Loading…");
    return fetch("/api/analytics?action=summary&days=" + days, { headers: authHeaders() })
      .then(function (res) {
        if (res.status === 403) throw Object.assign(new Error("Not available for this account."), { status: 403 });
        if (res.status === 401) throw Object.assign(new Error("Sign in to view metrics."), { status: 401 });
        return res.json().then(function (json) {
          if (!res.ok) {
            if (json && (json.code === "metrics_not_setup" || /not set up yet/i.test(json.error || ""))) {
              throw Object.assign(new Error("metrics not set up yet"), { status: 503, code: "metrics_not_setup" });
            }
            throw new Error((json && json.error) || "Could not load metrics.");
          }
          return json;
        });
      })
      .then(function (json) {
        setStatus("");
        renderFunnel(json.funnel);
        renderDau(json.dailyActiveWriters);
        renderDay2(json.day2Return);
        renderDevices(json.deviceSplit);
        renderSources(json.topSources);
        renderWriting(json.writingBehavior);
        renderSessions(json.recentWritingSessions);
      })
      .catch(function (err) {
        if (err && err.code === "metrics_not_setup") {
          setStatus("metrics not set up yet");
          return;
        }
        setStatus((err && err.message) || "Could not load metrics.", true);
      });
  }

  function loadEvents(name) {
    if (!token()) return;
    var q = "/api/analytics?action=events&limit=80";
    if (name) q += "&name=" + encodeURIComponent(name);
    fetch(q, { headers: authHeaders() })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (!json) return;
        renderEvents(json.events);
      })
      .catch(function () {});
  }

  function loadTimeline(sessionId) {
    if (!token() || !sessionId) return;
    var label = document.getElementById("metrics-timeline-label");
    if (label) label.textContent = "Loading timeline…";
    fetch("/api/analytics?action=session&sessionId=" + encodeURIComponent(sessionId), {
      headers: authHeaders(),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (!json) {
          if (label) label.textContent = "Session not found.";
          return;
        }
        renderTimeline(json);
      })
      .catch(function () {
        if (label) label.textContent = "Could not load timeline.";
      });
  }

  function boot() {
    document.querySelectorAll(".metrics__range-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        days = Number(btn.getAttribute("data-days")) === 30 ? 30 : 7;
        document.querySelectorAll(".metrics__range-btn").forEach(function (b) {
          var on = b === btn;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        loadSummary();
      });
    });
    var filter = document.getElementById("metrics-event-filter");
    if (filter) {
      filter.addEventListener("input", function () {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(function () {
          loadEvents(String(filter.value || "").trim());
        }, 250);
      });
    }
    if (!token()) {
      try { sessionStorage.setItem("tinker_mcp_return", "/metrics"); } catch (e) { /* ignore */ }
      window.location.assign("/?signin=1");
      return;
    }
    loadSummary();
    loadEvents("");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
