/* Messaging shell: left conversation list of leads (TYL-65 slice 1).
 * Reuses leads + draft APIs from TYL-62/63. Thread and composer land in
 * later slices.
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
  var TOUCH_LABEL = {
    application: "application",
    referral_outreach: "referral intro",
    hiring_leader_outreach: "eng leader note",
    recruiter_outreach: "recruiter note",
    referral_follow_up: "follow-up",
    call_follow_up: "follow-up",
  };
  var CONTACT_LABEL = {
    referrer: "referral",
    hiring_leader: "hiring EM",
    recruiter: "recruiter",
    other: "contact",
  };
  var CONTACT_ORDER = { referrer: 0, hiring_leader: 1, recruiter: 2, other: 3 };
  var YOU_ID = "__you__";
  var OWNER_LABEL = "Lindow Labs";
  var OWNER_LOGO = "./icons/lindow-labs.svg";
  var NO_COMPANY = "No company";
  var state = {
    leads: [],
    drafts: [],
    companies: [],
    companiesById: {},
    touchesByLead: {},
    loading: false,
    error: "",
    query: "",
    companyFilter: "",
    selectedId: "",
    collapsed: {},
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
  function leadsApi(action, query) { return api("/api/leads", action, query); }
  function scheduleApi(action, query) { return api("/api/schedule", action, query); }
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
  function touchFor(lead) {
    if (!lead) return null;
    var entry = state.touchesByLead[lead.id];
    return entry && entry.touch ? entry.touch : null;
  }
  function dueDayLabel(touch) {
    if (!touch || !touch.date) return "";
    var d = new Date(touch.date);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    } catch (e) {
      return d.toDateString();
    }
  }
  function touchTypeLabel(touch) {
    if (!touch) return "";
    return TOUCH_LABEL[touch.touchType] || String(touch.touchType || "").replace(/_/g, " ");
  }
  function contactLabel(lead) {
    if (!lead) return "";
    return CONTACT_LABEL[lead.contactType] || String(lead.contactType || "").replace(/_/g, " ");
  }
  function nextStepLabel(lead) {
    var touch = touchFor(lead);
    if (touch) return touchTypeLabel(touch);
    var step = String(lead && lead.nextStep || "").trim();
    return step || "";
  }
  function companyKeyFor(lead) {
    if (!lead) return NO_COMPANY;
    if (lead.companyId && state.companiesById[lead.companyId]) {
      return state.companiesById[lead.companyId].name || NO_COMPANY;
    }
    var name = String(lead.company || "").trim();
    return name || NO_COMPANY;
  }
  function companyMeta(name) {
    var key = String(name || "").trim().toLowerCase();
    for (var i = 0; i < state.companies.length; i++) {
      var c = state.companies[i];
      if (String(c.name || "").trim().toLowerCase() === key) return c;
    }
    return null;
  }
  function companyRank(name) {
    if (name === NO_COMPANY) return { northStar: 0, priority: 99999, name: "\uffff" };
    var c = companyMeta(name);
    return {
      northStar: c && c.northStar ? 1 : 0,
      priority: c && c.priority != null ? Number(c.priority) : 100,
      name: String(name || "").toLowerCase(),
    };
  }
  function sortLeadsInCompany(a, b) {
    var ca = CONTACT_ORDER[a.contactType] != null ? CONTACT_ORDER[a.contactType] : 9;
    var cb = CONTACT_ORDER[b.contactType] != null ? CONTACT_ORDER[b.contactType] : 9;
    if (ca !== cb) return ca - cb;
    var qa = Number(a.queueOrder || 0);
    var qb = Number(b.queueOrder || 0);
    if (qa !== qb) return qa - qb;
    var ta = touchFor(a);
    var tb = touchFor(b);
    var da = ta && ta.date ? new Date(ta.date).getTime() : Number.POSITIVE_INFINITY;
    var db = tb && tb.date ? new Date(tb.date).getTime() : Number.POSITIVE_INFINITY;
    return da - db;
  }
  function groupByCompany(leads) {
    var map = {};
    leads.forEach(function (lead) {
      var key = companyKeyFor(lead);
      if (!map[key]) map[key] = [];
      map[key].push(lead);
    });
    Object.keys(map).forEach(function (key) { map[key].sort(sortLeadsInCompany); });
    var order = Object.keys(map).sort(function (a, b) {
      var ra = companyRank(a);
      var rb = companyRank(b);
      if (ra.northStar !== rb.northStar) return rb.northStar - ra.northStar;
      if (ra.priority !== rb.priority) return ra.priority - rb.priority;
      return ra.name.localeCompare(rb.name);
    });
    return { map: map, order: order };
  }
  function showPane() {
    if (!pane) return;
    pane.hidden = false;
    document.body.classList.add("messages-shell-open", "messages-inbox-primary");
  }
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
        note.textContent = "Thread view arrives next. Your drafts for this person will show here.";
        thread.appendChild(note);
      }
    }
    showPane();
  }
  function ownerDisplayName() {
    return OWNER_LABEL;
  }
  function fillOwnerMark(node, opts) {
    opts = opts || {};
    node.innerHTML = "";
    var img = el("img", "messages-avatar__img", {
      src: OWNER_LOGO,
      alt: opts.alt || OWNER_LABEL,
    });
    node.appendChild(img);
    node.classList.add("messages-avatar--photo", "messages-avatar--brand");
  }
  function renderYouRow() {
    if (!root) return;
    var slot = root.querySelector("[data-messages-you-slot]");
    if (!slot) return;
    slot.innerHTML = "";
    var btn = el("button", "messages-rail__row messages-rail__row--you", {
      type: "button",
      "data-conv-id": YOU_ID,
      "aria-current": state.selectedId === YOU_ID ? "true" : "false",
    });
    var avatar = el("span", "messages-rail__avatar", { "aria-hidden": "true" });
    fillOwnerMark(avatar);
    var main = el("span", "messages-rail__main");
    var top = el("span", "messages-rail__top");
    var title = el("span", "messages-rail__name");
    title.textContent = ownerDisplayName();
    top.appendChild(title);
    main.appendChild(top);
    btn.appendChild(avatar);
    btn.appendChild(main);
    btn.addEventListener("click", function () { selectYou(); });
    slot.appendChild(btn);
  }
  function setPaneHeader(name, roleText, opts) {
    opts = opts || {};
    if (!pane) return;
    var nameEl = pane.querySelector("[data-messages-name]");
    var role = pane.querySelector("[data-messages-role]");
    var avatar = pane.querySelector("[data-messages-avatar]");
    if (nameEl) nameEl.textContent = name || "Messages";
    if (role) {
      role.hidden = !roleText;
      role.textContent = roleText ? " · " + roleText : "";
    }
    if (avatar) {
      if (opts.showOwnerAvatar) {
        avatar.hidden = false;
        fillOwnerMark(avatar, { alt: name || OWNER_LABEL });
      } else {
        avatar.hidden = true;
        avatar.innerHTML = "";
        avatar.classList.remove("messages-avatar--photo", "messages-avatar--brand");
      }
    }
  }
  function selectYou(opts) {
    opts = opts || {};
    state.selectedId = YOU_ID;
    document.body.classList.add("messages-you-active", "messages-thread-active");
    if (root) {
      root.querySelectorAll("[data-conv-id]").forEach(function (btn) {
        btn.setAttribute("aria-current", btn.getAttribute("data-conv-id") === YOU_ID ? "true" : "false");
      });
    }
    setPaneHeader(ownerDisplayName(), "", { showOwnerAvatar: true });
    showPane();
    var empty = pane && pane.querySelector("[data-messages-empty]");
    var thread = pane && pane.querySelector("[data-messages-thread]");
    if (empty) empty.hidden = true;
    if (thread) {
      thread.hidden = false;
      thread.setAttribute("data-thread-ready", "1");
    }
    if (!opts.silent) {
      try {
        window.dispatchEvent(new CustomEvent("tinker:messages-select", {
          detail: { leadId: "", you: true },
        }));
      } catch (e) { /* ignore */ }
    }
    if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
      document.body.classList.add("messages-mobile-thread");
    }
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.open === "function") {
      window.tinkerMessagesYou.open();
    }
  }
  function selectLead(id, opts) {
    opts = opts || {};
    if (id === YOU_ID) { selectYou(opts); return; }
    state.selectedId = id || "";
    document.body.classList.remove("messages-you-active");
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.close === "function") {
      window.tinkerMessagesYou.close();
    }
    if (root) {
      root.querySelectorAll("[data-conv-id]").forEach(function (btn) {
        btn.setAttribute("aria-current", btn.getAttribute("data-conv-id") === state.selectedId ? "true" : "false");
      });
    }
    document.body.classList.toggle("messages-thread-active", !!state.selectedId);
    renderEmptyPane();
    if (!opts.silent) {
      try {
        var touchEntry = state.selectedId ? state.touchesByLead[state.selectedId] : null;
        window.dispatchEvent(new CustomEvent("tinker:messages-select", {
          detail: { leadId: state.selectedId, touch: touchEntry || null },
        }));
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
    renderYouRow();
    if (!leads.length) return;

    var grouped = groupByCompany(leads);
    grouped.order.forEach(function (bucket) {
      var group = el("li", "messages-rail__group");
      var collapsed = !!state.collapsed[bucket];
      var head = el("button", "messages-rail__group-head", {
        type: "button",
        "aria-expanded": collapsed ? "false" : "true",
      });
      var headLabel = el("span", "messages-rail__group-label");
      var company = companyMeta(bucket);
      headLabel.textContent = company && company.northStar ? "★ " + bucket : bucket;
      var headCount = el("span", "messages-rail__group-count");
      headCount.textContent = String(grouped.map[bucket].length);
      head.appendChild(headLabel);
      head.appendChild(headCount);
      head.addEventListener("click", function () {
        state.collapsed[bucket] = !state.collapsed[bucket];
        renderList();
      });
      group.appendChild(head);
      var ul = el("ul", "messages-rail__group-list");
      if (collapsed) ul.hidden = true;
      grouped.map[bucket].forEach(function (lead) {
        var li = el("li");
        var unread = needsDraft(lead);
        var btn = el("button", "messages-rail__row" + (unread ? " messages-rail__row--unread" : ""), {
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
        var touch = touchFor(lead);
        var dueText = touch
          ? dueDayLabel(touch)
          : (lead.nextStepAt ? dueDayLabel({ date: lead.nextStepAt }) : "");
        time.textContent = dueText || relativeTime((draft && draft.updatedAt) || lead.updatedAt || lead.createdAt);
        top.appendChild(title);
        top.appendChild(time);
        var preview = el("span", "messages-rail__preview");
        var role = contactLabel(lead);
        var step = nextStepLabel(lead);
        var roleStep = [role, step].filter(Boolean).join(" · ");
        preview.textContent = roleStep
          || (draft ? draftPreview(draft) : (String(lead.personTitle || "").trim() || "No next step yet"));
        var meta = el("span", "messages-rail__meta");
        if (role || step || dueText) {
          var touchEl = el("span", "messages-rail__touch");
          touchEl.textContent = [role, step, dueText].filter(Boolean).join(" · ");
          meta.appendChild(touchEl);
        }
        main.appendChild(top);
        main.appendChild(preview);
        if (meta.childNodes.length) main.appendChild(meta);
        btn.appendChild(avatar);
        btn.appendChild(main);
        if (unread) {
          var badge = el("span", "messages-rail__unread", { title: "Needs a draft", "aria-label": "Needs a draft" });
          badge.textContent = "1";
          btn.appendChild(badge);
        }
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
      state.companies = [];
      state.companiesById = {};
      state.touchesByLead = {};
      state.error = "";
      if (pane) pane.hidden = false;
      document.body.classList.remove("messages-thread-active", "messages-mobile-thread", "messages-you-active");
      renderList();
      renderEmptyPane();
      return Promise.resolve();
    }
    state.loading = true;
    return Promise.all([
      leadsApi("list"),
      leadsApi("drafts"),
      scheduleApi("inbox").catch(function () { return { byLeadId: {} }; }),
      leadsApi("companies", { status: "active" }).catch(function () { return { companies: [] }; }),
    ]).then(function (results) {
      state.leads = Array.isArray(results[0].leads) ? results[0].leads : [];
      state.drafts = Array.isArray(results[1].drafts) ? results[1].drafts : [];
      state.touchesByLead = (results[2] && results[2].byLeadId) || {};
      var companies = Array.isArray(results[3].companies) ? results[3].companies : [];
      state.companies = companies;
      state.companiesById = {};
      companies.forEach(function (c) { if (c && c.id) state.companiesById[c.id] = c; });
      state.error = "";
      if (pane) pane.hidden = false;
    }).catch(function (err) {
      state.leads = [];
      state.drafts = [];
      state.companies = [];
      state.companiesById = {};
      state.touchesByLead = {};
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
      if (state.selectedId === YOU_ID) selectYou({ silent: true });
      else renderEmptyPane();
    });
  }
  function bindChrome() {
    if (!root) return;
    var search = root.querySelector("[data-messages-search]");
    var chip = root.querySelector("[data-messages-filter]");
    var back = pane && pane.querySelector("[data-messages-back]");
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
    var brand = document.getElementById("nav-home");
    if (brand) {
      brand.addEventListener("click", function () {
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
    selectYou: selectYou,
    setCompanyFilter: setCompanyFilter,
    getSelectedId: function () { return state.selectedId; },
    touchForLead: function (id) { return (id && state.touchesByLead[id]) || null; },
    ownerProfile: function () {
      return {
        name: OWNER_LABEL,
        initials: "LL",
        avatarUrl: OWNER_LOGO,
      };
    },
    YOU_ID: YOU_ID,
    OWNER_LABEL: OWNER_LABEL,
    OWNER_LOGO: OWNER_LOGO,
    CHANNEL_LABEL: CHANNEL_LABEL,
    TOUCH_LABEL: TOUCH_LABEL,
    CONTACT_LABEL: CONTACT_LABEL,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
