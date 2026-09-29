/* Messaging shell: left conversation list of leads (TYL-65 slice 1).
 * Reuses leads + draft APIs from TYL-62/63. Thread and composer land in
 * later slices. Tinker never sends.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var CHANNEL_LABEL = {
    linkedin_post: "LinkedIn post",
    linkedin_connection: "LinkedIn connection request",
    gmail_outreach: "Gmail",
    linkedin_message: "LinkedIn DM",
  };
  var state = {
    leads: [],
    drafts: [],
    loading: false,
    error: "",
    query: "",
    companyFilter: "",
    selectedId: "",
  };
  var root = null;
  var pane = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function api(action, query) {
    var q = new URLSearchParams(Object.assign({ action: action }, query || {}));
    return fetch("/api/leads?" + q.toString(), {
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
  function relativeTime(iso) {
    if (!iso) return "";
    var ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "";
    var m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m";
    var h = Math.round(m / 60);
    return h < 48 ? h + "h" : Math.round(h / 24) + "d";
  }
  function draftPreview(draft) {
    if (!draft) return "";
    var body = String(draft.body || "").replace(/\s+/g, " ").trim();
    if (!body) return CHANNEL_LABEL[draft.channel] || "Draft";
    return body.length > 64 ? body.slice(0, 63) + "…" : body;
  }
  function latestDraftFor(leadId) {
    var best = null;
    state.drafts.forEach(function (d) {
      if (!d || d.leadId !== leadId) return;
      if (!best || String(d.updatedAt || "") > String(best.updatedAt || "")) best = d;
    });
    return best;
  }
  function needsDraft(lead) {
    if (!lead) return false;
    if (lead.stage === "new" || lead.stage === "drafting") {
      var d = latestDraftFor(lead.id);
      return !d || d.status === "draft";
    }
    return false;
  }
  function matchesQuery(lead) {
    var q = state.query.trim().toLowerCase();
    if (!q) return true;
    var hay = [lead.personName, lead.company, lead.personTitle, lead.contactType, lead.stage]
      .map(function (v) { return String(v || "").toLowerCase(); })
      .join(" ");
    return hay.indexOf(q) !== -1;
  }
  function visibleLeads() {
    return state.leads.filter(function (lead) {
      if (state.companyFilter) {
        var c = String(lead.company || "").trim().toLowerCase();
        if (c !== state.companyFilter.toLowerCase()) return false;
      }
      return matchesQuery(lead);
    });
  }
  function groupByCompany(leads) {
    var map = {};
    var order = [];
    leads.forEach(function (lead) {
      var key = String(lead.company || "").trim() || "No company";
      if (!map[key]) { map[key] = []; order.push(key); }
      map[key].push(lead);
    });
    return { map: map, order: order };
  }
  function showPane() {
    if (!pane) return;
    pane.hidden = false;
    document.body.classList.add("messages-shell-open", "messages-inbox-primary");
    closePitchPanel();
  }
  function setPitchOpen(open) {
    var panel = document.getElementById("pitch-deck-panel");
    if (!panel) return;
    panel.hidden = !open;
    document.body.classList.toggle("pitch-deck-open", !!open);
    if (open && pane) pane.hidden = true;
    else if (pane && state.selectedId) pane.hidden = false;
    else if (pane) pane.hidden = false;
  }
  function closePitchPanel() { setPitchOpen(false); }
  function openPitchPanel() { setPitchOpen(true); }
  function renderEmptyPane() {
    if (!pane) return;
    var empty = pane.querySelector("[data-messages-empty]");
    var thread = pane.querySelector("[data-messages-thread]");
    if (empty) empty.hidden = !!state.selectedId;
    if (thread) {
      thread.hidden = !state.selectedId;
      if (!state.selectedId) thread.innerHTML = "";
      else if (!thread.getAttribute("data-thread-ready")) {
        thread.innerHTML = "";
        var note = el("p", "messages-pane__placeholder");
        note.textContent = "Thread view arrives next — your drafts for this person will show here.";
        thread.appendChild(note);
      }
    }
    showPane();
  }
  function selectLead(id, opts) {
    opts = opts || {};
    state.selectedId = id || "";
    if (root) {
      root.querySelectorAll("[data-conv-id]").forEach(function (btn) {
        btn.setAttribute("aria-current", btn.getAttribute("data-conv-id") === state.selectedId ? "true" : "false");
      });
    }
    document.body.classList.toggle("messages-thread-active", !!state.selectedId);
    renderEmptyPane();
    if (!opts.silent) {
      try {
        window.dispatchEvent(new CustomEvent("tinker:messages-select", { detail: { leadId: state.selectedId } }));
      } catch (e) { /* ignore */ }
    }
    if (state.selectedId && window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
      document.body.classList.add("messages-mobile-thread");
    }
  }
  function renderList() {
    if (!root) return;
    var list = root.querySelector("[data-messages-list]");
    var empty = root.querySelector("[data-messages-empty]");
    var err = root.querySelector("[data-messages-error]");
    var badge = root.querySelector("[data-messages-badge]");
    if (!list || !empty || !err) return;

    if (state.error) { err.hidden = false; err.textContent = state.error; }
    else { err.hidden = true; err.textContent = ""; }

    var leads = visibleLeads();
    var needs = leads.filter(needsDraft).length;
    if (badge) {
      badge.hidden = needs < 1;
      badge.textContent = needs > 0 ? String(needs) : "";
    }
    empty.hidden = leads.length > 0 || !!state.error || state.loading;
    list.innerHTML = "";
    if (!leads.length) return;

    var grouped = groupByCompany(leads);
    grouped.order.forEach(function (company) {
      var group = el("li", "messages-rail__group");
      var head = el("h3", "messages-rail__group-head");
      head.textContent = company;
      group.appendChild(head);
      var ul = el("ul", "messages-rail__group-list");
      grouped.map[company].forEach(function (lead) {
        var li = el("li");
        var btn = el("button", "messages-rail__row", {
          type: "button",
          "data-conv-id": lead.id,
          "aria-current": lead.id === state.selectedId ? "true" : "false",
        });
        var avatar = el("span", "messages-rail__avatar", { "aria-hidden": "true" });
        var name = String(lead.personName || "").trim() || "Someone";
        avatar.textContent = name.split(/\s+/).map(function (p) { return p[0]; }).slice(0, 2).join("").toUpperCase() || "?";
        var main = el("span", "messages-rail__main");
        var top = el("span", "messages-rail__top");
        var title = el("span", "messages-rail__name");
        title.textContent = name;
        var time = el("span", "messages-rail__time");
        var draft = latestDraftFor(lead.id);
        time.textContent = relativeTime((draft && draft.updatedAt) || lead.updatedAt || lead.createdAt);
        top.appendChild(title);
        top.appendChild(time);
        var preview = el("span", "messages-rail__preview");
        preview.textContent = draft
          ? draftPreview(draft)
          : (String(lead.personTitle || "").trim() || "No draft yet — write one when you are ready.");
        var meta = el("span", "messages-rail__meta");
        if (draft && draft.channel) {
          var ch = el("span", "messages-rail__channel");
          ch.textContent = CHANNEL_LABEL[draft.channel] || draft.channel;
          meta.appendChild(ch);
        }
        var stage = el("span", "messages-rail__stage");
        stage.textContent = String(lead.stage || "new");
        meta.appendChild(stage);
        if (needsDraft(lead)) {
          var dot = el("span", "messages-rail__dot", { title: "Needs a draft", "aria-label": "Needs a draft" });
          meta.appendChild(dot);
        }
        main.appendChild(top);
        main.appendChild(preview);
        main.appendChild(meta);
        btn.appendChild(avatar);
        btn.appendChild(main);
        btn.addEventListener("click", function () { selectLead(lead.id); });
        li.appendChild(btn);
        ul.appendChild(li);
      });
      group.appendChild(ul);
      list.appendChild(group);
    });
  }
  function setCompanyFilter(name) {
    state.companyFilter = String(name || "").trim();
    var chip = root && root.querySelector("[data-messages-filter]");
    if (chip) {
      if (!state.companyFilter) { chip.hidden = true; chip.textContent = ""; }
      else { chip.hidden = false; chip.textContent = "Showing " + state.companyFilter + " · Clear"; }
    }
    renderList();
  }
  function refresh() {
    document.body.classList.add("messages-inbox-primary", "messages-shell-open");
    if (root) root.hidden = false;
    if (!token()) {
      state.leads = [];
      state.drafts = [];
      state.error = "";
      if (pane) pane.hidden = false;
      document.body.classList.remove("messages-thread-active", "messages-mobile-thread");
      renderList();
      renderEmptyPane();
      return Promise.resolve();
    }
    state.loading = true;
    return Promise.all([
      api("list"),
      api("drafts"),
    ]).then(function (results) {
      state.leads = Array.isArray(results[0].leads) ? results[0].leads : [];
      state.drafts = Array.isArray(results[1].drafts) ? results[1].drafts : [];
      state.error = "";
      if (pane) pane.hidden = false;
    }).catch(function (err) {
      state.leads = [];
      state.drafts = [];
      if (err.status === 401 || err.status === 403) {
        state.error = "";
        if (pane) pane.hidden = false;
      } else {
        state.error = "Conversations could not load right now.";
        if (pane) pane.hidden = false;
      }
    }).finally(function () {
      state.loading = false;
      renderList();
      renderEmptyPane();
    });
  }
  function bindChrome() {
    if (!root) return;
    var search = root.querySelector("[data-messages-search]");
    var chip = root.querySelector("[data-messages-filter]");
    var back = pane && pane.querySelector("[data-messages-back]");
    var pitchOpen = document.querySelector("[data-pitch-open]");
    var pitchClose = document.querySelector("[data-pitch-close]");
    if (search) {
      search.addEventListener("input", function () {
        state.query = search.value || "";
        renderList();
      });
    }
    if (chip) chip.addEventListener("click", function () { setCompanyFilter(""); });
    if (back) {
      back.addEventListener("click", function () {
        document.body.classList.remove("messages-mobile-thread");
        selectLead("", { silent: true });
      });
    }
    if (pitchOpen) pitchOpen.addEventListener("click", openPitchPanel);
    if (pitchClose) pitchClose.addEventListener("click", closePitchPanel);
    var brand = document.getElementById("nav-home");
    if (brand) {
      brand.addEventListener("click", function () {
        closePitchPanel();
        document.body.classList.remove("messages-mobile-thread");
        if (!state.selectedId && pane) pane.hidden = false;
      });
    }
  }
  function boot() {
    root = document.getElementById("sidebar-messages");
    pane = document.getElementById("messages-pane");
    if (!root) return;
    document.body.classList.add("messages-inbox-primary", "messages-shell-open");
    bindChrome();
    refresh();
    window.addEventListener("storage", function (e) { if (e.key === TOKEN_KEY) refresh(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    window.addEventListener("tinker:messages-filter-company", function (e) {
      setCompanyFilter(e && e.detail && e.detail.company);
    });
  }

  window.tinkerMessagesShell = {
    refresh: refresh,
    selectLead: selectLead,
    setCompanyFilter: setCompanyFilter,
    openPitchPanel: openPitchPanel,
    closePitchPanel: closePitchPanel,
    getSelectedId: function () { return state.selectedId; },
    CHANNEL_LABEL: CHANNEL_LABEL,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
