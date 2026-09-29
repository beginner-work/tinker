/* Messaging shell: company-level inbox with person tabs (TYL-65).
 * Left rail lists companies (pinned owner + targets by priority).
 * Opening a company shows people as tabs; each tab is a lead thread.
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
    selectedCompanyId: "",
    selectedLeadId: "",
    ownerPersonName: "",
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
    return String(lead && lead.nextStep || "").trim();
  }
  function dueForLead(lead) {
    var touch = touchFor(lead);
    if (touch) return dueDayLabel(touch);
    if (lead && lead.nextStepAt) return dueDayLabel({ date: lead.nextStepAt });
    return "";
  }
  function sortLeadsInCompany(a, b) {
    var ca = CONTACT_ORDER[a.contactType] != null ? CONTACT_ORDER[a.contactType] : 9;
    var cb = CONTACT_ORDER[b.contactType] != null ? CONTACT_ORDER[b.contactType] : 9;
    if (ca !== cb) return ca - cb;
    var qa = Number(a.queueOrder || 0);
    var qb = Number(b.queueOrder || 0);
    if (qa !== qb) return qa - qb;
    var da = touchFor(a) && touchFor(a).date ? new Date(touchFor(a).date).getTime() : Number.POSITIVE_INFINITY;
    var db = touchFor(b) && touchFor(b).date ? new Date(touchFor(b).date).getTime() : Number.POSITIVE_INFINITY;
    return da - db;
  }
  function companySort(a, b) {
    var na = a.northStar || a.tier === "north_star" ? 1 : 0;
    var nb = b.northStar || b.tier === "north_star" ? 1 : 0;
    if (na !== nb) return nb - na;
    var pa = Number(a.priority == null ? 100 : a.priority);
    var pb = Number(b.priority == null ? 100 : b.priority);
    if (pa !== pb) return pa - pb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }
  function matchesQueryCompany(company, people) {
    var q = state.query.trim().toLowerCase();
    if (!q) return true;
    if (String(company.name || "").toLowerCase().indexOf(q) !== -1) return true;
    return people.some(function (lead) {
      var hay = [lead.personName, lead.personTitle, lead.contactType]
        .map(function (v) { return String(v || "").toLowerCase(); })
        .join(" ");
      return hay.indexOf(q) !== -1;
    });
  }
  function leadsForCompany(company) {
    if (!company) return [];
    var id = company.id;
    var name = String(company.name || "").trim().toLowerCase();
    return state.leads.filter(function (lead) {
      if (id && lead.companyId === id) return true;
      return name && String(lead.company || "").trim().toLowerCase() === name;
    }).sort(sortLeadsInCompany);
  }
  function visibleCompanies() {
    var rows = state.companies.slice().filter(function (c) {
      return !c.status || c.status === "active";
    });
    // Orphan company names from leads without a TargetCompany row
    var seen = {};
    rows.forEach(function (c) { seen[String(c.name || "").trim().toLowerCase()] = true; });
    state.leads.forEach(function (lead) {
      var name = String(lead.company || "").trim();
      if (!name || seen[name.toLowerCase()]) return;
      if (lead.companyId && state.companiesById[lead.companyId]) return;
      seen[name.toLowerCase()] = true;
      rows.push({ id: "name:" + name.toLowerCase(), name: name, priority: 100, northStar: false, tier: "other", orphan: true });
    });
    rows.sort(companySort);
    return rows.filter(function (company) {
      if (state.companyFilter) {
        if (String(company.name || "").trim().toLowerCase() !== state.companyFilter.toLowerCase()) return false;
      }
      return matchesQueryCompany(company, leadsForCompany(company));
    });
  }
  function ensureTabsHost() {
    if (!pane) return null;
    var host = pane.querySelector("[data-messages-tabs]");
    if (host) return host;
    var top = pane.querySelector(".messages-pane__top");
    host = el("div", "messages-pane__tabs", {
      "data-messages-tabs": "1",
      role: "tablist",
      "aria-label": "People at this company",
    });
    if (top && top.parentNode) top.parentNode.insertBefore(host, top.nextSibling);
    else pane.insertBefore(host, pane.firstChild);
    return host;
  }
  function showPane() {
    if (!pane) return;
    pane.hidden = false;
    document.body.classList.add("messages-shell-open", "messages-inbox-primary");
  }
  function ownerPersonLabel() {
    return state.ownerPersonName || "Owner";
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
      } else if (opts.initials) {
        avatar.hidden = false;
        avatar.innerHTML = "";
        avatar.classList.remove("messages-avatar--photo", "messages-avatar--brand");
        avatar.textContent = opts.initials;
      } else {
        avatar.hidden = true;
        avatar.innerHTML = "";
        avatar.classList.remove("messages-avatar--photo", "messages-avatar--brand");
      }
    }
  }
  function clearSelectionChrome() {
    document.body.classList.remove("messages-you-active", "messages-thread-active", "messages-mobile-thread");
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.close === "function") {
      window.tinkerMessagesYou.close();
    }
    var empty = pane && pane.querySelector("[data-messages-empty]");
    var thread = pane && pane.querySelector("[data-messages-thread]");
    if (empty) {
      empty.hidden = false;
      empty.textContent = "Select a company to see its people.";
    }
    if (thread) {
      thread.hidden = true;
      thread.innerHTML = "";
      thread.removeAttribute("data-thread-ready");
    }
    var tabs = ensureTabsHost();
    if (tabs) { tabs.innerHTML = ""; tabs.hidden = true; }
    setPaneHeader("Messages", "", {});
  }
  function renderPersonTabs(people, opts) {
    opts = opts || {};
    var tabs = ensureTabsHost();
    if (!tabs) return;
    tabs.hidden = false;
    tabs.innerHTML = "";
    people.forEach(function (person) {
      var btn = el("button", "messages-pane__tab" + (person.id === state.selectedLeadId ? " messages-pane__tab--on" : ""), {
        type: "button",
        role: "tab",
        "aria-selected": person.id === state.selectedLeadId ? "true" : "false",
        "data-tab-lead": person.id,
      });
      var name = el("span", "messages-pane__tab-name");
      name.textContent = person.personName || "Someone";
      var meta = el("span", "messages-pane__tab-meta");
      meta.textContent = [contactLabel(person), nextStepLabel(person), dueForLead(person)].filter(Boolean).join(" · ");
      btn.appendChild(name);
      if (meta.textContent) btn.appendChild(meta);
      btn.addEventListener("click", function () {
        selectPersonTab(person.id);
      });
      tabs.appendChild(btn);
    });
    if (opts.ownerTab) {
      var youBtn = el("button", "messages-pane__tab" + (state.selectedLeadId === YOU_ID ? " messages-pane__tab--on" : ""), {
        type: "button",
        role: "tab",
        "aria-selected": state.selectedLeadId === YOU_ID ? "true" : "false",
        "data-tab-lead": YOU_ID,
      });
      var youName = el("span", "messages-pane__tab-name");
      youName.textContent = ownerPersonLabel();
      var youMeta = el("span", "messages-pane__tab-meta");
      youMeta.textContent = "story";
      youBtn.appendChild(youName);
      youBtn.appendChild(youMeta);
      youBtn.addEventListener("click", function () { selectPersonTab(YOU_ID); });
      tabs.insertBefore(youBtn, tabs.firstChild);
    }
  }
  function selectPersonTab(leadId) {
    state.selectedLeadId = leadId || "";
    if (leadId === YOU_ID) {
      document.body.classList.add("messages-you-active", "messages-thread-active");
      var empty = pane && pane.querySelector("[data-messages-empty]");
      var thread = pane && pane.querySelector("[data-messages-thread]");
      if (empty) empty.hidden = true;
      if (thread) {
        thread.hidden = false;
        thread.setAttribute("data-thread-ready", "1");
      }
      renderPersonTabs([], { ownerTab: true });
      try {
        window.dispatchEvent(new CustomEvent("tinker:messages-select", {
          detail: { leadId: "", you: true, companyId: YOU_ID },
        }));
      } catch (e) { /* ignore */ }
      if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.open === "function") {
        window.tinkerMessagesYou.open();
      }
      return;
    }
    document.body.classList.remove("messages-you-active");
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.close === "function") {
      window.tinkerMessagesYou.close();
    }
    document.body.classList.add("messages-thread-active");
    var company = state.companiesById[state.selectedCompanyId]
      || visibleCompanies().find(function (c) { return c.id === state.selectedCompanyId; });
    var people = company ? leadsForCompany(company) : [];
    renderPersonTabs(people);
    var empty = pane && pane.querySelector("[data-messages-empty]");
    var thread = pane && pane.querySelector("[data-messages-thread]");
    if (empty) empty.hidden = true;
    if (thread) {
      thread.hidden = false;
      thread.setAttribute("data-thread-ready", "1");
    }
    if (company) {
      setPaneHeader(company.name, company.tier === "north_star" || company.northStar ? "North Star" : "", {
        initials: String(company.name || "?").slice(0, 2).toUpperCase(),
      });
    }
    try {
      var touchEntry = leadId ? state.touchesByLead[leadId] : null;
      window.dispatchEvent(new CustomEvent("tinker:messages-select", {
        detail: { leadId: leadId, touch: touchEntry || null, companyId: state.selectedCompanyId },
      }));
    } catch (e) { /* ignore */ }
  }
  function selectCompany(companyId, opts) {
    opts = opts || {};
    if (companyId === YOU_ID) { selectYou(opts); return; }
    state.selectedCompanyId = companyId || "";
    state.selectedLeadId = "";
    document.body.classList.remove("messages-you-active");
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.close === "function") {
      window.tinkerMessagesYou.close();
    }
    if (root) {
      root.querySelectorAll("[data-company-id]").forEach(function (btn) {
        btn.setAttribute("aria-current", btn.getAttribute("data-company-id") === state.selectedCompanyId ? "true" : "false");
      });
    }
    showPane();
    if (!state.selectedCompanyId) {
      clearSelectionChrome();
      return;
    }
    var company = state.companiesById[state.selectedCompanyId]
      || visibleCompanies().find(function (c) { return c.id === state.selectedCompanyId; });
    if (!company) {
      clearSelectionChrome();
      return;
    }
    var people = leadsForCompany(company);
    setPaneHeader(company.name, company.tier === "north_star" || company.northStar ? "North Star" : "", {
      initials: String(company.name || "?").slice(0, 2).toUpperCase(),
    });
    document.body.classList.add("messages-thread-active");
    if (!opts.silent && !opts.stayOnList) enterMobileThread();
    if (!people.length) {
      renderPersonTabs([]);
      var empty = pane.querySelector("[data-messages-empty]");
      var thread = pane.querySelector("[data-messages-thread]");
      if (empty) {
        empty.hidden = false;
        empty.textContent = "No people at this company yet. Add them with the lead tools.";
      }
      if (thread) { thread.hidden = true; thread.innerHTML = ""; }
      try {
        window.dispatchEvent(new CustomEvent("tinker:messages-select", {
          detail: { leadId: "", companyId: company.id },
        }));
      } catch (e) { /* ignore */ }
      return;
    }
    selectPersonTab(people[0].id);
  }
  function enterMobileThread() {
    if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
      document.body.classList.add("messages-mobile-thread");
    }
  }
  function leaveMobileThread() {
    document.body.classList.remove("messages-mobile-thread");
  }
  function showCompanyList() {
    state.selectedCompanyId = "";
    state.selectedLeadId = "";
    leaveMobileThread();
    clearSelectionChrome();
    showPane();
    renderList();
  }
  function selectYou(opts) {
    opts = opts || {};
    state.selectedCompanyId = YOU_ID;
    state.selectedLeadId = YOU_ID;
    document.body.classList.add("messages-you-active", "messages-thread-active");
    if (root) {
      root.querySelectorAll("[data-company-id]").forEach(function (btn) {
        btn.setAttribute("aria-current", btn.getAttribute("data-company-id") === YOU_ID ? "true" : "false");
      });
    }
    setPaneHeader(OWNER_LABEL, "", { showOwnerAvatar: true });
    showPane();
    renderPersonTabs([], { ownerTab: true });
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
          detail: { leadId: "", you: true, companyId: YOU_ID },
        }));
      } catch (e) { /* ignore */ }
    }
    // Only leave the company list when the user opens Lindow Labs.
    // Silent refresh must not hide the mobile inbox behind an empty thread.
    if (!opts.silent && !opts.stayOnList) enterMobileThread();
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.open === "function") {
      window.tinkerMessagesYou.open();
    }
  }
  function selectLead(id, opts) {
    // Back-compat for callers that still pass a lead id.
    opts = opts || {};
    if (!id) { showCompanyList(); return; }
    if (id === YOU_ID) { selectYou(opts); return; }
    var lead = state.leads.find(function (row) { return row.id === id; });
    if (!lead) return;
    var companyId = lead.companyId
      || (visibleCompanies().find(function (c) {
        return String(c.name || "").toLowerCase() === String(lead.company || "").toLowerCase();
      }) || {}).id;
    if (companyId && state.selectedCompanyId !== companyId) {
      state.selectedCompanyId = companyId;
    }
    selectPersonTab(id);
    if (!opts.silent) enterMobileThread();
  }
  function companyPreview(company, people) {
    if (!people.length) return "No people yet";
    var first = people[0];
    var bits = [contactLabel(first), nextStepLabel(first), dueForLead(first)].filter(Boolean);
    return bits.join(" · ") || (String(first.personName || "").trim() || "Open");
  }
  function renderYouRow() {
    if (!root) return;
    var slot = root.querySelector("[data-messages-you-slot]");
    if (!slot) return;
    slot.innerHTML = "";
    var btn = el("button", "messages-rail__row messages-rail__row--you", {
      type: "button",
      "data-company-id": YOU_ID,
      "aria-current": state.selectedCompanyId === YOU_ID ? "true" : "false",
    });
    var avatar = el("span", "messages-rail__avatar", { "aria-hidden": "true" });
    fillOwnerMark(avatar);
    var main = el("span", "messages-rail__main");
    var top = el("span", "messages-rail__top");
    var title = el("span", "messages-rail__name");
    title.textContent = OWNER_LABEL;
    top.appendChild(title);
    var preview = el("span", "messages-rail__preview");
    preview.textContent = ownerPersonLabel();
    main.appendChild(top);
    main.appendChild(preview);
    btn.appendChild(avatar);
    btn.appendChild(main);
    btn.addEventListener("click", function () { selectYou(); });
    slot.appendChild(btn);
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

    var companies = visibleCompanies();
    var needs = state.leads.filter(needsDraft).length;
    if (badge) {
      badge.hidden = needs < 1;
      badge.textContent = needs > 0 ? String(needs) : "";
    }
    empty.hidden = companies.length > 0 || !!state.error || state.loading;
    empty.textContent = "No companies yet. Add target companies with the lead tools.";
    list.innerHTML = "";
    renderYouRow();

    companies.forEach(function (company) {
      var people = leadsForCompany(company);
      var li = el("li");
      var unread = people.some(needsDraft);
      var btn = el("button", "messages-rail__row" + (unread ? " messages-rail__row--unread" : ""), {
        type: "button",
        "data-company-id": company.id,
        "aria-current": company.id === state.selectedCompanyId ? "true" : "false",
      });
      var avatar = el("span", "messages-rail__avatar", { "aria-hidden": "true" });
      avatar.textContent = String(company.name || "?").trim().slice(0, 2).toUpperCase() || "?";
      var main = el("span", "messages-rail__main");
      var top = el("span", "messages-rail__top");
      var title = el("span", "messages-rail__name");
      var star = company.northStar || company.tier === "north_star";
      title.textContent = (star ? "★ " : "") + (company.name || "Company");
      var time = el("span", "messages-rail__time");
      time.textContent = String(people.length);
      top.appendChild(title);
      top.appendChild(time);
      var preview = el("span", "messages-rail__preview");
      preview.textContent = companyPreview(company, people);
      main.appendChild(top);
      main.appendChild(preview);
      btn.appendChild(avatar);
      btn.appendChild(main);
      if (unread) {
        var ub = el("span", "messages-rail__unread", { title: "Needs a draft", "aria-label": "Needs a draft" });
        ub.textContent = "1";
        btn.appendChild(ub);
      }
      btn.addEventListener("click", function () { selectCompany(company.id); });
      li.appendChild(btn);
      list.appendChild(li);
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
  function loadOwnerPersonName() {
    if (!token()) {
      state.ownerPersonName = "";
      return Promise.resolve();
    }
    return fetch("/api/user-data/profile", {
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    }).then(function (res) { return res.ok ? res.json() : null; }).then(function (json) {
      var p = json && json.data ? json.data : null;
      state.ownerPersonName = p && p.name ? String(p.name).trim() : "";
    }).catch(function () { state.ownerPersonName = ""; });
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
      clearSelectionChrome();
      showPane();
      return Promise.resolve();
    }
    state.loading = true;
    return Promise.all([
      leadsApi("list"),
      leadsApi("drafts"),
      scheduleApi("inbox").catch(function () { return { byLeadId: {} }; }),
      leadsApi("companies", { status: "active" }).catch(function () { return { companies: [] }; }),
      loadOwnerPersonName(),
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
      // Mobile front screen is always the company list. Never auto-enter
      // thread mode on refresh (that was painting a blank stage).
      if (state.selectedCompanyId && document.body.classList.contains("messages-mobile-thread")) {
        if (state.selectedCompanyId === YOU_ID) selectYou({ silent: true, stayOnList: true });
        else selectCompany(state.selectedCompanyId, { silent: true, stayOnList: true });
      } else {
        showCompanyList();
      }
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
      back.addEventListener("click", function () { showCompanyList(); });
    }
    var brand = document.getElementById("nav-home");
    if (brand) {
      brand.addEventListener("click", function (e) {
        e.preventDefault();
        showCompanyList();
      });
    }
  }
  function boot() {
    root = document.getElementById("sidebar-messages");
    pane = document.getElementById("messages-pane");
    if (!root) return;
    document.body.classList.add("messages-inbox-primary", "messages-shell-open");
    ensureTabsHost();
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
    selectCompany: selectCompany,
    selectYou: selectYou,
    showCompanyList: showCompanyList,
    setCompanyFilter: setCompanyFilter,
    getSelectedId: function () { return state.selectedLeadId; },
    getSelectedCompanyId: function () { return state.selectedCompanyId; },
    touchForLead: function (id) { return (id && state.touchesByLead[id]) || null; },
    ownerProfile: function () {
      return {
        name: OWNER_LABEL,
        personName: ownerPersonLabel(),
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
