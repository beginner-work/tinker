/* Job application thread: role, posting link, pay range, fit notes.
 * Shared Keep crafting / This is everything chrome (no review UI, no sent bubbles).
 * Keep crafting saves fit notes; This is everything marks the application done.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var state = {
    applicationId: "",
    application: null,
    fitNotes: "",
    saving: false,
    done: false,
  };

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === false || attrs[k] == null) return;
      n.setAttribute(k, attrs[k] === true ? "" : String(attrs[k]));
    });
    return n;
  }
  function api(method, action, body, query) {
    var q = new URLSearchParams(Object.assign({ action: action }, query || {}));
    var opts = {
      method: method,
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    };
    if (method !== "GET") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body || {});
    }
    return fetch("/api/job-application?" + q.toString(), opts).then(function (res) {
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
  function threadHost() {
    return document.querySelector("#messages-pane [data-messages-thread]");
  }
  function actions() {
    return window.tinkerThreadActions || null;
  }
  function setPaneHeader(app) {
    var titleEl = document.querySelector("#messages-pane [data-messages-title]");
    var subEl = document.querySelector("#messages-pane [data-messages-subtitle]");
    if (titleEl) titleEl.textContent = String(app && app.roleTitle || "Application").trim() || "Application";
    if (subEl) subEl.textContent = String(app && app.companyName || "").trim();
    // Same header slot as LinkedIn on person threads — posting link only.
    if (window.tinkerMessagesThread && typeof window.tinkerMessagesThread.renderProfileLinks === "function") {
      window.tinkerMessagesThread.renderProfileLinks({
        postingUrl: app && app.postingUrl ? String(app.postingUrl).trim() : "",
      });
    }
  }
  function buildFacts(app) {
    var wrap = el("div", "messages-application__facts");
    if (app.payRange) {
      var pay = el("p", "messages-application__row");
      pay.textContent = app.payRange;
      wrap.appendChild(pay);
    }
    if (app.referrerName) {
      var ref = el("p", "messages-application__row messages-application__muted");
      ref.textContent = "Referrer: " + app.referrerName;
      wrap.appendChild(ref);
    }
    return wrap;
  }
  function render() {
    var host = threadHost();
    if (!host || !state.application) return;
    host.innerHTML = "";
    host.classList.add("messages-application");
    var app = state.application;
    setPaneHeader(app);
    var scroll = el("div", "messages-notepad");
    scroll.appendChild(buildFacts(app));
    var label = el("label", "messages-application__label");
    label.textContent = "Fit notes";
    scroll.appendChild(label);
    var ta = el("textarea", "messages-notepad__input", {
      rows: "6",
      "data-application-fit": "1",
      placeholder: "Why this role fits…",
    });
    ta.value = state.fitNotes || "";
    ta.disabled = !!state.done;
    ta.addEventListener("input", function () {
      state.fitNotes = ta.value;
    });
    scroll.appendChild(ta);
    if (state.done) {
      var done = el("p", "messages-notepad__done");
      done.textContent = state.application && state.application.status === "dropped"
        ? "Application dropped — not applying."
        : "Application marked done.";
      scroll.appendChild(done);
    }
    var isDropped = !!(state.application && state.application.status === "dropped");
    var act = actions();
    var foot = act && act.buildFoot
      ? act.buildFoot({
        onSecondary: function () { saveFitNotes(); },
        onPrimary: function () { markDone(); },
        secondaryLabel: state.done ? "Saved" : "Keep crafting",
        primaryLabel: isDropped ? "Dropped" : (state.done ? "Done" : "This is everything"),
      })
      : null;
    if (foot) {
      if (state.done) {
        foot.secondary.disabled = true;
        foot.primary.disabled = true;
      }
      scroll.appendChild(foot.foot);
    }
    host.appendChild(scroll);
  }
  function saveFitNotes() {
    if (!state.applicationId || state.done || state.saving) return Promise.resolve();
    state.saving = true;
    return api("POST", "edit", { fitNotes: state.fitNotes }, { id: state.applicationId }).then(function (payload) {
      state.application = payload.application || state.application;
      state.fitNotes = state.application.fitNotes || "";
      state.saving = false;
      render();
      if (window.tinkerMessagesShell && typeof window.tinkerMessagesShell.refresh === "function") {
        window.tinkerMessagesShell.refresh();
      }
    }).catch(function () {
      state.saving = false;
    });
  }
  function markDone() {
    if (!state.applicationId || state.done || state.saving) return Promise.resolve();
    state.saving = true;
    return api("POST", "edit", { fitNotes: state.fitNotes }, { id: state.applicationId }).then(function () {
      return api("POST", "done", {}, { id: state.applicationId });
    }).then(function (payload) {
      state.application = (payload && payload.application) || state.application;
      state.done = true;
      state.saving = false;
      render();
      if (window.tinkerMessagesShell && typeof window.tinkerMessagesShell.refresh === "function") {
        window.tinkerMessagesShell.refresh();
      }
    }).catch(function () {
      state.saving = false;
    });
  }
  function openApplication(application) {
    state.applicationId = application && application.id ? String(application.id) : "";
    state.application = application || null;
    state.fitNotes = application && application.fitNotes ? String(application.fitNotes) : "";
    state.done = !!(application && (application.status === "done" || application.status === "dropped"));
    state.saving = false;
    render();
  }
  function clear() {
    state.applicationId = "";
    state.application = null;
    state.fitNotes = "";
    state.done = false;
    var host = threadHost();
    if (host) {
      host.classList.remove("messages-application");
      if (host.querySelector(".messages-application__facts")) host.innerHTML = "";
    }
  }
  function onSelect(e) {
    if (e && e.detail && e.detail.application && e.detail.applicationId) {
      if (window.tinkerMessagesComposer && typeof window.tinkerMessagesComposer.setYouMode === "function") {
        window.tinkerMessagesComposer.setYouMode(true);
      }
      api("GET", "get", null, { id: e.detail.applicationId }).then(function (res) {
        openApplication(res.application || { id: e.detail.applicationId, roleTitle: "Application" });
      }).catch(function () {
        openApplication({ id: e.detail.applicationId, roleTitle: "Application", companyName: "", fitNotes: "" });
      });
      return;
    }
    clear();
  }
  function boot() {
    window.addEventListener("tinker:messages-select", onSelect);
  }

  window.tinkerMessagesApplication = {
    open: function (applicationId) {
      onSelect({ detail: { application: true, applicationId: applicationId } });
    },
    clear: clear,
    saveFitNotes: saveFitNotes,
    markDone: markDone,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
