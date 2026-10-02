/* Lindow Labs overview — exercises, readings, roles. No inbox. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var ELEVEN_READER_HOME = "https://elevenreader.io/";
  var FORMATION_HOME = "https://formation.dev/";
  var CURSOR_ROOT_KEY = "tinker.cursorProjectRoot";
  var DOCKABLE_HOSTS = {
    "elevenreader.io": true,
    "www.elevenreader.io": true,
    "formation.dev": true,
    "www.formation.dev": true,
  };

  var state = {
    readings: [],
    roles: [],
    loading: false,
    error: "",
  };

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function isDesktop() {
    try {
      return !!(window.tinker && window.tinker.isDesktopApp);
    } catch (e) {
      return false;
    }
  }

  function cursorRoot() {
    try {
      return String(localStorage.getItem(CURSOR_ROOT_KEY) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function joinPath(root, rel) {
    var base = String(root || "").replace(/[/\\]+$/, "");
    var leaf = String(rel || "").replace(/^[/\\]+/, "");
    if (!base || !leaf) return "";
    var sep = base.indexOf("\\") >= 0 ? "\\" : "/";
    return base + sep + leaf.split("/").join(sep);
  }

  function cursorDeepLink(relPath) {
    var abs = joinPath(cursorRoot(), relPath);
    if (!abs) return "";
    return "cursor://file/" + abs;
  }

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function api(path, action, query) {
    var q = new URLSearchParams(Object.assign({ action: action }, query || {}));
    return fetch(path + "?" + q.toString(), {
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    }).then(function (res) {
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

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ""; }
  }

  function isDockable(url) {
    return !!DOCKABLE_HOSTS[hostOf(url)];
  }

  function openExternalLink(url, opts) {
    var href = String(url || "").trim();
    if (!href || !/^https?:\/\//i.test(href)) return;
    var forceBrowser = opts && opts.forceBrowser;
    if (!forceBrowser && isDesktop() && isDockable(href) && window.tinker && typeof window.tinker.openDockedPanel === "function") {
      window.tinker.openDockedPanel(href);
      return;
    }
    if (isDesktop() && window.tinker && typeof window.tinker.openExternal === "function") {
      window.tinker.openExternal(href);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  }

  function openCursorLink(relPath) {
    var link = cursorDeepLink(relPath);
    if (!link) return;
    window.location.href = link;
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function readingUrl(thread) {
    var custom = thread && thread.elevenReaderUrl ? String(thread.elevenReaderUrl).trim() : "";
    return custom || ELEVEN_READER_HOME;
  }

  function exercises() {
    if (window.tinkerExercises && typeof window.tinkerExercises.listExercises === "function") {
      return window.tinkerExercises.listExercises();
    }
    return [];
  }

  function renderExercises(mount) {
    mount.textContent = "";
    var rows = exercises();
    var root = cursorRoot();
    if (!rows.length) {
      mount.appendChild(el("p", "overview__empty")).textContent = "No exercises yet.";
      return;
    }
    if (!root) {
      var note = el("p", "overview__note");
      note.textContent = "Set cursorProjectRoot in Settings to enable Cursor links.";
      mount.appendChild(note);
    }
    var list = el("ul", "overview__list");
    rows.forEach(function (ex) {
      var li = el("li", "overview__item");
      var title = el("div", "overview__item-title");
      title.textContent = ex.title;
      var desc = el("p", "overview__item-desc");
      desc.textContent = ex.description || "";
      var meta = el("div", "overview__item-meta");
      meta.textContent = (ex.status || "open") + " · " + (ex.path || "");
      var actions = el("div", "overview__item-actions");
      var btn = el("button", "overview__link", { type: "button" });
      btn.textContent = "Open in Cursor";
      if (!root) {
        btn.disabled = true;
        btn.title = "Set the local folder path (cursorProjectRoot) in Settings";
      } else {
        btn.addEventListener("click", function () { openCursorLink(ex.path); });
      }
      actions.appendChild(btn);
      li.appendChild(title);
      li.appendChild(desc);
      li.appendChild(meta);
      li.appendChild(actions);
      list.appendChild(li);
    });
    mount.appendChild(list);
  }

  function renderReadings(mount) {
    mount.textContent = "";
    if (!state.readings.length) {
      mount.appendChild(el("p", "overview__empty")).textContent = "No readings yet.";
      return;
    }
    var list = el("ul", "overview__list");
    state.readings.forEach(function (thread) {
      var li = el("li", "overview__item");
      var title = el("div", "overview__item-title");
      title.textContent = thread.title || "Reading";
      var desc = el("p", "overview__item-desc");
      var parts = [];
      if (thread.author) parts.push(thread.author);
      if (thread.paused) parts.push("paused");
      if (thread.done) parts.push("done");
      else if (thread.currentSection && thread.currentSection.title) {
        parts.push(thread.currentSection.title);
      }
      desc.textContent = parts.join(" · ");
      var actions = el("div", "overview__item-actions");
      var btn = el("button", "overview__link", { type: "button" });
      btn.textContent = "ElevenReader";
      btn.addEventListener("click", function () {
        openExternalLink(readingUrl(thread));
      });
      actions.appendChild(btn);
      li.appendChild(title);
      li.appendChild(desc);
      li.appendChild(actions);
      list.appendChild(li);
    });
    mount.appendChild(list);
  }

  function renderRoles(mount) {
    mount.textContent = "";
    if (!state.roles.length) {
      mount.appendChild(el("p", "overview__empty")).textContent = "No roles yet.";
      return;
    }
    var list = el("ul", "overview__list");
    state.roles.forEach(function (role) {
      var li = el("li", "overview__item");
      var title = el("div", "overview__item-title");
      title.textContent = (role.company || "") + " — " + (role.title || "");
      var desc = el("p", "overview__item-desc");
      desc.textContent = role.fitReason || "";
      var meta = el("div", "overview__item-meta");
      var bits = [];
      if (role.location) bits.push(role.location);
      var when = formatDate(role.savedAt || role.createdAt);
      if (when) bits.push("saved " + when);
      meta.textContent = bits.join(" · ");
      var actions = el("div", "overview__item-actions");
      if (role.postingUrl) {
        var openBtn = el("button", "overview__link", { type: "button" });
        openBtn.textContent = "Posting";
        openBtn.addEventListener("click", function () {
          openExternalLink(role.postingUrl, { forceBrowser: true });
        });
        actions.appendChild(openBtn);
      }
      var dismiss = el("button", "overview__dismiss", { type: "button" });
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", function () {
        dismissRole(role.id).then(function () { paint(); });
      });
      actions.appendChild(dismiss);
      li.appendChild(title);
      if (role.fitReason) li.appendChild(desc);
      li.appendChild(meta);
      li.appendChild(actions);
      list.appendChild(li);
    });
    mount.appendChild(list);
  }

  function dismissRole(roleId) {
    if (!token() || !roleId) return Promise.resolve();
    return fetch("/api/role-matches?action=dismiss&id=" + encodeURIComponent(roleId), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    }).then(function (res) {
      if (!res.ok) throw new Error("dismiss-failed");
      state.roles = state.roles.filter(function (r) { return r.id !== roleId; });
    }).catch(function () { /* leave list; next refresh corrects */ });
  }

  function paint() {
    var root = document.getElementById("overview");
    if (!root) return;
    var err = root.querySelector("[data-overview-error]");
    if (err) {
      if (state.error) {
        err.hidden = false;
        err.textContent = state.error;
      } else {
        err.hidden = true;
        err.textContent = "";
      }
    }
    var ex = root.querySelector("[data-overview-exercises]");
    var rd = root.querySelector("[data-overview-readings]");
    var roles = root.querySelector("[data-overview-roles]");
    if (ex) renderExercises(ex);
    if (rd) renderReadings(rd);
    if (roles) renderRoles(roles);
  }

  function refresh() {
    if (!token()) {
      state.readings = [];
      state.roles = [];
      state.error = "";
      paint();
      return Promise.resolve();
    }
    state.loading = true;
    return Promise.all([
      api("/api/reading-thread", "list").catch(function () { return { threads: [] }; }),
      api("/api/role-matches", "list").catch(function () { return { roles: [] }; }),
    ]).then(function (pair) {
      state.readings = Array.isArray(pair[0] && pair[0].threads) ? pair[0].threads : [];
      state.roles = Array.isArray(pair[1] && pair[1].roles) ? pair[1].roles : [];
      state.error = "";
      state.loading = false;
      paint();
    }).catch(function (err) {
      state.loading = false;
      state.error = (err && err.message) || "Could not load overview.";
      paint();
    });
  }

  function openWrite() {
    if (window.tinkerMessagesShell && typeof window.tinkerMessagesShell.openWrite === "function") {
      window.tinkerMessagesShell.openWrite({ silent: false });
      return;
    }
    if (window.tinkerMessagesShell && typeof window.tinkerMessagesShell.selectYou === "function") {
      window.tinkerMessagesShell.selectYou({ silent: false });
      return;
    }
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.open === "function") {
      document.body.classList.add("overview-writing", "messages-shell-open", "messages-you-active", "messages-thread-active");
      var overview = document.getElementById("overview");
      if (overview) overview.hidden = true;
      var pane = document.getElementById("messages-pane");
      if (pane) pane.hidden = false;
      window.tinkerMessagesYou.open();
    }
  }

  function bindChrome() {
    var formation = document.querySelector("[data-overview-formation]");
    if (formation) {
      formation.addEventListener("click", function (e) {
        e.preventDefault();
        openExternalLink(FORMATION_HOME);
      });
    }
    document.querySelectorAll("[data-overview-write]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        openWrite();
      });
    });
  }

  function boot() {
    if (!document.body || !document.body.classList.contains("overview-primary")) return;
    bindChrome();
    paint();
    refresh();
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refresh();
    });
    window.addEventListener("storage", function (ev) {
      if (ev && (ev.key === TOKEN_KEY || ev.key === CURSOR_ROOT_KEY)) refresh();
    });
  }

  window.tinkerOverview = {
    refresh: refresh,
    openWrite: openWrite,
    cursorDeepLink: cursorDeepLink,
    CURSOR_ROOT_KEY: CURSOR_ROOT_KEY,
    ELEVEN_READER_HOME: ELEVEN_READER_HOME,
    FORMATION_HOME: FORMATION_HOME,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
