/* Plain story-parts page for outreach drafts. */
(function () {
  "use strict";
  var TOKEN_KEY = "tinker_jwt";
  var FALLBACK_STAGES = [
    { key: "hook", name: "Hook" },
    { key: "proof_point", name: "Proof point" },
    { key: "connecting_story", name: "Connecting story" },
    { key: "fit", name: "Fit" },
    { key: "ask", name: "Ask" },
  ];
  var state = { stages: FALLBACK_STAGES.slice(), parts: [] };

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function status(msg, err) {
    var el = document.getElementById("sp-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "sp__status" + (err ? " sp__status--error" : "");
  }
  function api(method, action, body) {
    var q = new URLSearchParams({ action: action });
    var opts = {
      method: method,
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    };
    if (method !== "GET") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body || {});
    }
    return fetch("/api/story-parts?" + q.toString(), opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok) {
          var err = new Error((payload && payload.error) || "Request failed");
          err.status = res.status;
          throw err;
        }
        return payload;
      });
    });
  }
  function stageName(key) {
    for (var i = 0; i < state.stages.length; i++) {
      if (state.stages[i].key === key) return state.stages[i].name || key;
    }
    return key;
  }
  function fillStages() {
    var sel = document.getElementById("sp-stage");
    if (!sel) return;
    sel.innerHTML = "";
    state.stages.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.key;
      opt.textContent = s.name || s.key;
      sel.appendChild(opt);
    });
  }
  function render() {
    var board = document.getElementById("sp-board");
    if (!board) return;
    board.innerHTML = "";
    if (!state.parts.length) {
      var empty = document.createElement("p");
      empty.className = "sp__empty";
      empty.textContent = "No story parts yet. Add one above, then insert it from the inbox composer.";
      board.appendChild(empty);
      return;
    }
    var by = {};
    state.parts.forEach(function (part) {
      var k = part.stageKey || "other";
      (by[k] = by[k] || []).push(part);
    });
    Object.keys(by).forEach(function (key) {
      var section = document.createElement("section");
      section.className = "sp__stage";
      var h = document.createElement("h2");
      h.className = "sp__heading";
      h.textContent = stageName(key);
      section.appendChild(h);
      var ul = document.createElement("ul");
      ul.className = "sp__list";
      by[key].forEach(function (part) {
        var li = document.createElement("li");
        li.className = "sp__item";
        var meta = document.createElement("p");
        meta.className = "sp__item-meta";
        meta.textContent = (part.status || "ready") + (part.updatedAt ? " · " + String(part.updatedAt).slice(0, 10) : "");
        var body = document.createElement("p");
        body.className = "sp__item-body";
        body.textContent = part.body || "";
        li.appendChild(meta);
        li.appendChild(body);
        ul.appendChild(li);
      });
      section.appendChild(ul);
      board.appendChild(section);
    });
  }
  function refresh() {
    if (!token()) {
      status("Sign in from the inbox to manage story parts.", true);
      try { sessionStorage.setItem("tinker_mcp_return", "/story-parts"); } catch (e) { /* ignore */ }
      window.location.assign("/");
      return Promise.resolve();
    }
    return Promise.all([
      api("GET", "stages").catch(function () { return { stages: FALLBACK_STAGES }; }),
      api("GET", "list"),
    ]).then(function (results) {
      if (Array.isArray(results[0].stages) && results[0].stages.length) state.stages = results[0].stages;
      state.parts = Array.isArray(results[1].parts) ? results[1].parts : [];
      fillStages();
      render();
      status("");
    }).catch(function (err) {
      status(err.message || "Could not load story parts.", true);
    });
  }
  function boot() {
    var form = document.getElementById("sp-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var stage = document.getElementById("sp-stage");
        var body = document.getElementById("sp-body");
        var text = body && body.value.trim();
        if (!text) return;
        status("Saving…");
        api("POST", "create", { stageKey: stage.value, body: text, status: "ready" }).then(function () {
          body.value = "";
          status("Saved. It is ready for the inbox composer.");
          return refresh();
        }).catch(function (err) {
          status(err.message || "Could not save.", true);
        });
      });
    }
    fillStages();
    refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
