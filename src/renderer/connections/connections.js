/* /connections — outbound MCP connectors (Notion first). */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var pendingWriteId = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function authHeaders() {
    return { Authorization: "Bearer " + token(), Accept: "application/json" };
  }
  function setStatus(msg, isError) {
    var el = document.querySelector("[data-connections-status]");
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ""; el.classList.remove("connections__status--error"); return; }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("connections__status--error", !!isError);
  }

  function formatConnectedAt(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return "Connected " + d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch (e) { return ""; }
  }

  function renderList(connectors) {
    var list = document.querySelector("[data-connections-list]");
    if (!list) return;
    list.innerHTML = "";
    (connectors || []).forEach(function (c) {
      var li = document.createElement("li");
      li.className = "connections__card";
      li.setAttribute("data-connector-id", c.id);

      var head = document.createElement("div");
      head.className = "connections__card-head";

      var text = document.createElement("div");
      var name = document.createElement("h2");
      name.className = "connections__name";
      name.textContent = c.name || c.id;
      var desc = document.createElement("p");
      desc.className = "connections__desc";
      desc.textContent = c.description || "";
      text.appendChild(name);
      text.appendChild(desc);

      var badge = document.createElement("span");
      badge.className = "connections__badge" + (c.connected ? " connections__badge--on" : "");
      badge.textContent = c.connected ? "Connected" : "Not connected";

      head.appendChild(text);
      head.appendChild(badge);
      li.appendChild(head);

      if (c.connected) {
        var meta = document.createElement("p");
        meta.className = "connections__meta";
        var parts = [];
        var when = formatConnectedAt(c.connectedAt);
        if (when) parts.push(when);
        parts.push(c.writeAccess
          ? "Write tools on for this hour"
          : "Read-only (search and fetch)");
        meta.textContent = parts.join(" · ");
        li.appendChild(meta);
      }

      var actions = document.createElement("div");
      actions.className = "connections__actions";

      if (!c.connected) {
        var connectBtn = document.createElement("button");
        connectBtn.type = "button";
        connectBtn.className = "connections__btn";
        connectBtn.textContent = "Connect";
        connectBtn.setAttribute("data-action", "connect");
        connectBtn.setAttribute("data-id", c.id);
        actions.appendChild(connectBtn);
      } else {
        var disconnectBtn = document.createElement("button");
        disconnectBtn.type = "button";
        disconnectBtn.className = "connections__btn connections__btn--ghost";
        disconnectBtn.textContent = "Disconnect";
        disconnectBtn.setAttribute("data-action", "disconnect");
        disconnectBtn.setAttribute("data-id", c.id);
        actions.appendChild(disconnectBtn);

        if (!c.writeAccess) {
          var writeBtn = document.createElement("button");
          writeBtn.type = "button";
          writeBtn.className = "connections__btn";
          writeBtn.textContent = "Allow writes";
          writeBtn.setAttribute("data-action", "allow-writes");
          writeBtn.setAttribute("data-id", c.id);
          writeBtn.setAttribute("data-name", c.name || c.id);
          actions.appendChild(writeBtn);
        } else {
          var revokeBtn = document.createElement("button");
          revokeBtn.type = "button";
          revokeBtn.className = "connections__btn connections__btn--ghost";
          revokeBtn.textContent = "Turn off writes";
          revokeBtn.setAttribute("data-action", "revoke-writes");
          revokeBtn.setAttribute("data-id", c.id);
          actions.appendChild(revokeBtn);
        }
      }

      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function load() {
    if (!token()) {
      setStatus("Sign in to manage connections.", true);
      renderList([]);
      return Promise.resolve();
    }
    setStatus("Loading…");
    return fetch("/api/connections", { headers: authHeaders() })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) throw new Error((json && json.error) || "Could not load connections.");
          return json;
        });
      })
      .then(function (json) {
        setStatus("");
        renderList(json.connectors || []);
        renderContextSection(json.connectors || []);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not load connections.", true);
        renderList([]);
        renderContextSection([]);
      });
  }

  function paintContextActive(serverCtx) {
    var active = document.querySelector("[data-context-active]");
    if (!active) return;
    var api = window.tinkerMcpContext;
    var label = "";
    if (serverCtx && api && typeof api.indicatorLabel === "function") {
      label = api.indicatorLabel(serverCtx) || "";
    } else if (api && typeof api.indicatorLabel === "function") {
      label = api.indicatorLabel() || "";
    }
    if (label) {
      active.hidden = false;
      active.textContent = label;
    } else {
      active.hidden = true;
      active.textContent = "";
    }
  }

  function loadServerContext() {
    if (!token()) return Promise.resolve(null);
    return fetch("/api/mcp-context?action=list", { headers: authHeaders() })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) return null;
          return json;
        });
      })
      .then(function (json) {
        if (!json || !json.context) return null;
        var api = window.tinkerMcpContext;
        if (api && typeof api.writeLocal === "function") {
          api.writeLocal(json.context);
        }
        paintContextActive(json.context);
        return json.context;
      })
      .catch(function () {
        return null;
      });
  }

  function renderContextSection(connectors) {
    var section = document.querySelector("[data-connections-context]");
    if (!section) return;
    var notion = (connectors || []).find(function (c) {
      return c && c.id === "notion" && c.connected;
    });
    section.hidden = !notion;
    if (!notion) {
      paintContextActive(null);
      return;
    }
    loadServerContext().then(function () {
      paintContextActive();
    });
  }

  function renderSearchResults(results, role) {
    var list = document.querySelector("[data-context-results]");
    if (!list) return;
    list.innerHTML = "";
    if (!results || !results.length) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    results.forEach(function (hit) {
      var li = document.createElement("li");
      li.className = "connections__context-hit";
      var title = document.createElement("span");
      title.className = "connections__context-hit-title";
      title.textContent = hit.title || hit.id;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "connections__btn";
      btn.textContent = "Use";
      btn.setAttribute("data-action", "pick-context");
      btn.setAttribute("data-page-id", hit.id || "");
      btn.setAttribute("data-page-title", hit.title || "");
      btn.setAttribute("data-page-url", hit.url || "");
      btn.setAttribute("data-role", role || "business");
      li.appendChild(title);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function onContextSubmit(e) {
    e.preventDefault();
    if (!token()) { setStatus("Sign in to search Notion.", true); return; }
    var roleEl = document.querySelector("[data-context-role]");
    var queryEl = document.querySelector("[data-context-query]");
    var role = roleEl ? roleEl.value : "business";
    var query = queryEl ? queryEl.value : "";
    if (!String(query || "").trim()) {
      setStatus("Enter a search query.", true);
      return;
    }
    setStatus("Searching Notion…");
    var searchBtn = document.querySelector("[data-context-search]");
    if (searchBtn) searchBtn.disabled = true;
    fetch("/api/mcp-context", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ action: "search", query: query }),
    })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) throw new Error((json && json.error) || "Search failed.");
          return json;
        });
      })
      .then(function (json) {
        setStatus(
          json.results && json.results.length
            ? "Pick a page below."
            : "No Notion pages matched."
        );
        renderSearchResults(json.results || [], role);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Search failed.", true);
        renderSearchResults([], role);
      })
      .finally(function () {
        if (searchBtn) searchBtn.disabled = false;
      });
  }

  function pickContextPage(btn) {
    if (!token() || !btn) return;
    var pageId = btn.getAttribute("data-page-id") || "";
    var title = btn.getAttribute("data-page-title") || "";
    var url = btn.getAttribute("data-page-url") || "";
    var role = btn.getAttribute("data-role") || "business";
    btn.disabled = true;
    setStatus("Fetching page…");
    fetch("/api/mcp-context", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({
        action: "select",
        role: role,
        pageId: pageId,
        title: title,
        url: url || undefined,
      }),
    })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) throw new Error((json && json.error) || "Could not save page.");
          return json;
        });
      })
      .then(function (json) {
        var api = window.tinkerMcpContext;
        if (api && typeof api.writeLocal === "function" && json.context) {
          api.writeLocal(json.context);
        }
        setStatus("Context page saved.");
        paintContextActive(json.context);
        renderSearchResults([], role);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not save page.", true);
      })
      .finally(function () {
        btn.disabled = false;
      });
  }

  function connect(id, btn) {
    if (!token()) { setStatus("Sign in to connect.", true); return; }
    if (btn) btn.disabled = true;
    setStatus("Starting " + id + "…");
    fetch("/api/connections?action=connect", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ connectorId: id }),
    })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) throw new Error((json && json.error) || "Could not start Connect.");
          return json;
        });
      })
      .then(function (json) {
        if (!json.authorizeUrl) throw new Error("No authorize URL returned.");
        window.location.assign(json.authorizeUrl);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not start Connect.", true);
        if (btn) btn.disabled = false;
      });
  }

  function disconnect(id, btn) {
    if (!token()) { setStatus("Sign in to disconnect.", true); return; }
    if (btn) btn.disabled = true;
    setStatus("Disconnecting…");
    fetch("/api/connections?action=disconnect&id=" + encodeURIComponent(id), {
      method: "DELETE",
      headers: authHeaders(),
    })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) throw new Error((json && json.error) || "Could not disconnect.");
          return json;
        });
      })
      .then(function () {
        setStatus("Disconnected.");
        return load();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not disconnect.", true);
        if (btn) btn.disabled = false;
      });
  }

  function setWriteAccess(id, enabled, confirmed) {
    return fetch("/api/connections?action=write-access", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ connectorId: id, enabled: !!enabled, confirmed: !!confirmed }),
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error((json && json.error) || "Could not update write access.");
        return json;
      });
    });
  }

  function openWriteDialog(id, name) {
    pendingWriteId = id;
    var dialog = document.querySelector("[data-write-dialog]");
    var body = document.querySelector("[data-write-dialog-body]");
    if (body) {
      body.textContent =
        (name || "This connector") +
        " write tools can create and change content in that workspace. Read tools stay available either way. Allow for one hour?";
    }
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  }

  function onListClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    if (action === "pick-context") {
      pickContextPage(btn);
      return;
    }
    var id = btn.getAttribute("data-id");
    if (!id) return;
    if (action === "connect") connect(id, btn);
    else if (action === "disconnect") disconnect(id, btn);
    else if (action === "allow-writes") openWriteDialog(id, btn.getAttribute("data-name"));
    else if (action === "revoke-writes") {
      btn.disabled = true;
      setWriteAccess(id, false, false)
        .then(function () { setStatus("Write tools turned off."); return load(); })
        .catch(function (err) {
          setStatus((err && err.message) || "Could not update write access.", true);
          btn.disabled = false;
        });
    }
  }

  function bindDialog() {
    var dialog = document.querySelector("[data-write-dialog]");
    if (!dialog) return;
    dialog.addEventListener("close", function () {
      if (dialog.returnValue !== "confirm" || !pendingWriteId) {
        pendingWriteId = null;
        return;
      }
      var id = pendingWriteId;
      pendingWriteId = null;
      setStatus("Enabling write tools…");
      setWriteAccess(id, true, true)
        .then(function () { setStatus("Write tools allowed for one hour."); return load(); })
        .catch(function (err) {
          setStatus((err && err.message) || "Could not enable write tools.", true);
        });
    });
  }

  function readQueryFlash() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      if (params.get("connected")) {
        setStatus("Connected to " + params.get("connected") + ".");
        history.replaceState({}, "", "/connections");
      } else if (params.get("error")) {
        setStatus(params.get("error"), true);
        history.replaceState({}, "", "/connections");
      }
    } catch (e) { /* ignore */ }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var list = document.querySelector("[data-connections-list]");
    if (list) list.addEventListener("click", onListClick);
    var contextSection = document.querySelector("[data-connections-context]");
    if (contextSection) contextSection.addEventListener("click", onListClick);
    var form = document.querySelector("[data-context-form]");
    if (form) form.addEventListener("submit", onContextSubmit);
    bindDialog();
    readQueryFlash();
    load();
  });
})();
