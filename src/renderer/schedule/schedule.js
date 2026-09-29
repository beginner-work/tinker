/* /schedule — Mon–Fri outreach week. textContent only. Never sends. */
(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var catalog = window.tinkerSchedule || { TOUCH_TYPES: [], TOUCH_STATUSES: [], SESSION_TYPES: [], DAYS: ["Mon", "Tue", "Wed", "Thu", "Fri"] };
  var statusEl = document.getElementById("schedule-status");
  var weekEl = document.getElementById("schedule-week");
  var northEl = document.getElementById("schedule-north-star");
  var missingEl = document.getElementById("schedule-missing");
  var filterCompany = document.getElementById("schedule-filter-company");
  var filterTouch = document.getElementById("schedule-filter-touch");
  var weekStartInput = document.getElementById("schedule-week-start");
  var companies = [];
  var weekData = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (err) { return ""; }
  }
  function sendHome() {
    try { sessionStorage.setItem(RETURN_KEY, "/schedule"); }
    catch (err) { /* sign-in still works */ }
    window.location.assign("/");
  }
  if (!token()) { sendHome(); return; }

  function setStatus(text) { statusEl.textContent = text || ""; }
  function authHeaders(json) {
    var headers = { Authorization: "Bearer " + token() };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }
  function readJson(res) {
    return res.json().then(function (body) {
      return { status: res.status, body: body };
    }, function () { return { status: res.status, body: null }; });
  }
  function handleAuth(result) {
    if (result.status === 401) {
      try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
      sendHome();
      return true;
    }
    return false;
  }
  function labelFor(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].label;
    return key || "";
  }
  function fillSelect(el, items, withAll, allLabel) {
    el.replaceChildren();
    if (withAll) {
      var all = document.createElement("option");
      all.value = "";
      all.textContent = allLabel || "All";
      el.appendChild(all);
    }
    items.forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = item.key;
      opt.textContent = item.label;
      el.appendChild(opt);
    });
  }
  function field(id) { return document.getElementById(id); }
  function mondayIso(value) {
    var d = value ? new Date(value + "T12:00:00.000Z") : new Date();
    if (Number.isNaN(d.getTime())) d = new Date();
    var day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
  }
  function localToIso(value) {
    if (!value) return "";
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  function timeValue(value) {
    return value ? String(value).slice(0, 5) : "";
  }

  function api(base, action, method, body, query) {
    var url = base + "?action=" + encodeURIComponent(action);
    if (query) Object.keys(query).forEach(function (key) {
      if (query[key]) url += "&" + encodeURIComponent(key) + "=" + encodeURIComponent(query[key]);
    });
    var opts = { method: method, headers: authHeaders(!!body) };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(readJson);
  }
  function scheduleApi(action, method, body, query) {
    var url = "/api/schedule?action=" + encodeURIComponent(action);
    if (query) Object.keys(query).forEach(function (key) {
      if (query[key]) url += "&" + encodeURIComponent(key) + "=" + encodeURIComponent(query[key]);
    });
    var opts = { method: method, headers: authHeaders(!!body) };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(readJson);
  }
  function leadsApi(action, method, body, query) {
    return api("/api/leads", action, method, body, query);
  }

  function dayColumns(weekStart) {
    var start = new Date(weekStart);
    var days = [];
    for (var i = 0; i < 5; i++) {
      var d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      days.push({
        key: d.toISOString().slice(0, 10),
        label: catalog.DAYS[i],
        dateLabel: d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
      });
    }
    return days;
  }

  function renderNorthStar(data) {
    northEl.replaceChildren();
    var heading = document.createElement("div");
    heading.textContent = "North Star";
    heading.className = "schedule__heading";
    northEl.appendChild(heading);
    if (!data.northStar) {
      var empty = document.createElement("p");
      empty.textContent = "Pin a North Star company on your leads funnel to keep it at the top of your week.";
      northEl.appendChild(empty);
      return;
    }
    var name = document.createElement("strong");
    name.textContent = data.northStar.name;
    northEl.appendChild(name);
    var note = document.createElement("p");
    note.textContent = "Pinned so your highest-priority company stays visible while you plan touches.";
    northEl.appendChild(note);
  }

  function renderMissing(data) {
    missingEl.replaceChildren();
    var heading = document.createElement("div");
    heading.textContent = "No planned next touch";
    heading.className = "schedule__heading";
    missingEl.appendChild(heading);
    if (!data.companiesMissingTouch || !data.companiesMissingTouch.length) {
      var ok = document.createElement("p");
      ok.textContent = "Every active company has a planned or drafted next touch.";
      missingEl.appendChild(ok);
      return;
    }
    var list = document.createElement("ul");
    data.companiesMissingTouch.forEach(function (company) {
      var item = document.createElement("li");
      item.textContent = company.name + (company.northStar ? " (North Star)" : "");
      list.appendChild(item);
    });
    missingEl.appendChild(list);
  }

  function sessionDayKey(session) {
    return String(session.startsAt || "").slice(0, 10);
  }

  function renderWeek(data) {
    weekEl.replaceChildren();
    var days = dayColumns(data.weekStart);
    var byDay = {};
    days.forEach(function (day) { byDay[day.key] = []; });
    (data.sessions || []).forEach(function (entry) {
      var key = sessionDayKey(entry.session);
      if (byDay[key]) byDay[key].push(entry);
    });
    var loose = data.unscheduledTouches || [];
    days.forEach(function (day) {
      var col = document.createElement("article");
      col.className = "schedule__day";
      var name = document.createElement("h3");
      name.className = "schedule__day-name";
      name.textContent = day.label;
      col.appendChild(name);
      var date = document.createElement("p");
      date.className = "schedule__day-date";
      date.textContent = day.dateLabel;
      col.appendChild(date);
      var entries = byDay[day.key] || [];
      if (!entries.length) {
        var empty = document.createElement("p");
        empty.className = "schedule__empty";
        empty.textContent = "No sessions";
        col.appendChild(empty);
      }
      entries.forEach(function (entry) {
        var block = document.createElement("div");
        block.className = "schedule__block" + (entry.session.type === "skill" ? " schedule__block--skill" : "");
        var title = document.createElement("p");
        title.className = "schedule__block-title";
        title.textContent = entry.session.title;
        block.appendChild(title);
        var meta = document.createElement("p");
        meta.className = "schedule__block-meta";
        if (entry.session.type === "skill") {
          meta.textContent = [entry.session.productArea, entry.session.concept, entry.session.curriculumRef].filter(Boolean).join(" · ");
        } else {
          meta.textContent = "Company craft";
        }
        block.appendChild(meta);
        (entry.touches || []).forEach(function (item) {
          var touch = document.createElement("p");
          touch.className = "schedule__touch";
          var companyName = item.company ? item.company.name : "Company";
          touch.appendChild(document.createElement("strong")).textContent = companyName;
          touch.appendChild(document.createTextNode(" · " + labelFor(catalog.TOUCH_TYPES, item.touch.touchType) + " · " + labelFor(catalog.TOUCH_STATUSES, item.touch.status)));
          if (item.touch.windowStart) touch.appendChild(document.createTextNode(" · " + item.touch.windowStart + (item.touch.windowEnd ? "–" + item.touch.windowEnd : "")));
          block.appendChild(touch);
        });
        if (entry.googleCalendarUrl) {
          var cal = document.createElement("a");
          cal.className = "schedule__cal-link";
          cal.href = entry.googleCalendarUrl;
          cal.target = "_blank";
          cal.rel = "noopener noreferrer";
          cal.textContent = "Add to Google Calendar";
          block.appendChild(cal);
        }
        col.appendChild(block);
      });
      (data.busyEvents || []).filter(function (event) {
        return String(event.startsAt || "").slice(0, 10) === day.key;
      }).forEach(function (event) {
        var busy = document.createElement("div");
        busy.className = "schedule__block schedule__block--busy";
        var busyTitle = document.createElement("p");
        busyTitle.className = "schedule__block-title";
        busyTitle.textContent = event.title || "Busy";
        busy.appendChild(busyTitle);
        var busyMeta = document.createElement("p");
        busyMeta.className = "schedule__block-meta";
        busyMeta.textContent = "On your calendar";
        busy.appendChild(busyMeta);
        col.appendChild(busy);
      });
      loose.filter(function (item) { return String(item.touch.date || "").slice(0, 10) === day.key; }).forEach(function (item) {
        var looseBlock = document.createElement("div");
        looseBlock.className = "schedule__block";
        var looseTitle = document.createElement("p");
        looseTitle.className = "schedule__block-title";
        looseTitle.textContent = (item.company ? item.company.name : "Company") + " · unscheduled";
        looseBlock.appendChild(looseTitle);
        var looseMeta = document.createElement("p");
        looseMeta.className = "schedule__touch";
        looseMeta.textContent = labelFor(catalog.TOUCH_TYPES, item.touch.touchType) + " · " + labelFor(catalog.TOUCH_STATUSES, item.touch.status);
        looseBlock.appendChild(looseMeta);
        col.appendChild(looseBlock);
      });
      weekEl.appendChild(col);
    });
  }

  function fillCompanySelects() {
    var options = companies.map(function (company) {
      return { key: company.id, label: company.name + (company.northStar ? " ★" : "") };
    });
    fillSelect(filterCompany, options, true, "All companies");
    fillSelect(field("schedule-touch-company"), options, false);
  }

  function fillSessionSelect() {
    var el = field("schedule-touch-session");
    var options = ((weekData && weekData.sessions) || []).map(function (entry) {
      return { key: entry.session.id, label: entry.session.title };
    });
    fillSelect(el, options, true, "No session");
  }

  function loadWeek() {
    var query = {
      weekStart: mondayIso(weekStartInput.value),
      companyId: filterCompany.value,
      touchType: filterTouch.value,
    };
    setStatus("Loading your week…");
    return scheduleApi("week", "GET", null, query).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status >= 400) {
        setStatus((result.body && result.body.error) || "Could not load the schedule.");
        return;
      }
      weekData = result.body;
      weekStartInput.value = mondayIso(weekData.weekStart.slice(0, 10));
      field("schedule-curriculum-name").value = weekData.curriculumName || "";
      renderNorthStar(weekData);
      renderMissing(weekData);
      renderWeek(weekData);
      fillSessionSelect();
      setStatus("");
    });
  }

  function loadCompanies() {
    return leadsApi("companies", "GET", null, { status: "active" }).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status >= 400) {
        setStatus((result.body && result.body.error) || "Could not load companies.");
        return;
      }
      companies = result.body.companies || [];
      fillCompanySelects();
    });
  }

  fillSelect(filterTouch, catalog.TOUCH_TYPES, true, "All touch types");
  fillSelect(field("schedule-touch-type"), catalog.TOUCH_TYPES, false);
  fillSelect(field("schedule-touch-status"), catalog.TOUCH_STATUSES, false);
  fillSelect(field("schedule-session-type"), catalog.SESSION_TYPES, false);
  weekStartInput.value = mondayIso();

  document.getElementById("schedule-filter-apply").addEventListener("click", function () { loadWeek(); });
  document.getElementById("schedule-filter-clear").addEventListener("click", function () {
    filterCompany.value = "";
    filterTouch.value = "";
    loadWeek();
  });
  document.getElementById("schedule-export-ics").addEventListener("click", function () {
    var query = [];
    var weekStart = mondayIso(weekStartInput.value);
    if (weekStart) query.push("weekStart=" + encodeURIComponent(weekStart));
    if (filterCompany.value) query.push("companyId=" + encodeURIComponent(filterCompany.value));
    if (filterTouch.value) query.push("touchType=" + encodeURIComponent(filterTouch.value));
    var url = "/api/schedule?action=export" + (query.length ? "&" + query.join("&") : "");
    fetch(url, { headers: authHeaders(false) }).then(function (res) {
      if (res.status === 401) { handleAuth({ status: 401 }); return null; }
      if (!res.ok) return res.json().then(function (body) { setStatus((body && body.error) || "Could not export."); return null; });
      return res.text();
    }).then(function (ics) {
      if (!ics) return;
      var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "tinker-outreach-schedule.ics";
      link.click();
      URL.revokeObjectURL(link.href);
      setStatus("Downloaded this week as .ics. Tinker does not write to Google for you.");
    });
  });

  document.getElementById("schedule-session-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var type = field("schedule-session-type").value;
    var body = {
      type: type,
      title: field("schedule-session-title").value,
      startsAt: localToIso(field("schedule-session-start").value),
      endsAt: localToIso(field("schedule-session-end").value),
      productArea: field("schedule-session-product").value,
      concept: field("schedule-session-concept").value,
      curriculumRef: field("schedule-session-curriculum").value,
    };
    scheduleApi("session", "POST", body).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status >= 400) {
        setStatus((result.body && result.body.error) || "Could not save the session.");
        return;
      }
      field("schedule-session-title").value = "";
      loadWeek();
    });
  });

  document.getElementById("schedule-touch-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var body = {
      companyId: field("schedule-touch-company").value,
      touchType: field("schedule-touch-type").value,
      date: field("schedule-touch-date").value + "T12:00:00.000Z",
      windowStart: timeValue(field("schedule-touch-window-start").value),
      windowEnd: timeValue(field("schedule-touch-window-end").value),
      status: field("schedule-touch-status").value || "planned",
      sessionId: field("schedule-touch-session").value || null,
    };
    scheduleApi("touch", "POST", body).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status >= 400) {
        setStatus((result.body && result.body.error) || "Could not save the touch.");
        return;
      }
      loadWeek();
    });
  });

  document.getElementById("schedule-settings-form").addEventListener("submit", function (event) {
    event.preventDefault();
    leadsApi("settings", "POST", { curriculumName: field("schedule-curriculum-name").value }).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status >= 400) {
        setStatus((result.body && result.body.error) || "Could not save settings.");
        return;
      }
      setStatus("Curriculum name saved.");
    });
  });

  loadCompanies().then(loadWeek);
})();
