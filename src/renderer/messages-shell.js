/* Messaging shell: people-list inbox (TYL-65).
 * Left rail: owner row, then one flat list ranked by priority
 * (deadlines → warm follow-ups → prep → cold outreach).
 * Opening a person goes straight to their chat (invisible notepad).
 * Company logo badges the person avatar; research opens in the chat.
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
  var YOU_ID = "__you__";
  var RANK_TIER = { DEADLINE: 1, WARM: 2, PREP: 3, COLD: 4 };
  var WARM_TOUCH = { call_follow_up: 1, referral_follow_up: 1 };
  var READING_PREFIX = "__read__:";
  var OWNER_LABEL = "Lindow Labs";
  var OWNER_LOGO = "./icons/lindow-labs.svg";
  var LOGO_CACHE_KEY = "tinker.companyLogos.v1";
  var LOGO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var INBOX_CACHE_KEY = "tinker.inboxSnapshot.v1";
  var logoIdleQueued = false;
  var pendingLogoFills = [];
  var state = {
    leads: [],
    drafts: [],
    companies: [],
    companiesById: {},
    touchesByLead: {},
    readingThreads: [],
    loading: false,
    error: "",
    companyFilter: "",
    selectedId: "",
    collapsed: {},
    ownerPersonName: "",
    ownerAvatarUrl: "",
    ownerTitle: "",
    ownerLinkedInUrl: "",
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
  function readingApi(action, query) { return api("/api/reading-thread", action, query); }
  function readingConvId(threadId) { return READING_PREFIX + String(threadId || ""); }
  function readingIdFromConv(convId) {
    var id = String(convId || "");
    if (id.indexOf(READING_PREFIX) !== 0) return "";
    return id.slice(READING_PREFIX.length);
  }
  function isReadingSelected() {
    return String(state.selectedId || "").indexOf(READING_PREFIX) === 0;
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
  function leadHasSentOutreach(leadId) {
    if (!leadId) return false;
    return state.drafts.some(function (d) {
      return d && d.leadId === leadId
        && (d.status === "sent_by_owner" || d.status === "sent");
    });
  }
  function visibleLeads() {
    return state.leads.filter(function (lead) {
      if (!lead) return false;
      // UI-only: once outreach is sent, drop the person from the rail.
      // Thread still opens by direct selectLead / URL. Data + MCP unchanged.
      if (leadHasSentOutreach(lead.id)) return false;
      if (state.companyFilter) {
        var c = String(lead.company || "").trim().toLowerCase();
        if (c !== state.companyFilter.toLowerCase()) return false;
      }
      return true;
    });
  }
  function touchFor(lead) {
    if (!lead) return null;
    var entry = state.touchesByLead[lead.id];
    return entry && entry.touch ? entry.touch : null;
  }
  function calendarDayKey(value) {
    if (!value) return "";
    var text = String(value).trim();
    var m = text.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0{1,3})?Z)?$/);
    if (m) return m[1];
    var d = new Date(text);
    if (Number.isNaN(d.getTime())) return "";
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function dueDayLabel(touch) {
    if (!touch || !touch.date) return "";
    var key = calendarDayKey(touch.date);
    if (!key) return "";
    var parts = key.split("-");
    var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 12, 0, 0));
    try {
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    } catch (e) {
      return key;
    }
  }
  function touchTypeLabel(touch) {
    if (!touch) return "";
    return TOUCH_LABEL[touch.touchType] || String(touch.touchType || "").replace(/_/g, " ");
  }
  function companyPriority(lead) {
    var company = companyForLead(lead);
    if (company && company.priority != null && company.priority !== "") return Number(company.priority);
    return 100;
  }
  function leadDueRaw(lead) {
    var touch = touchFor(lead);
    if (touch && touch.date) return touch.date;
    return lead && lead.nextStepAt ? lead.nextStepAt : "";
  }
  function todayDayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function notesLookLikePrep(notes) {
    var text = String(notes || "");
    if (!/^###\s+/m.test(text)) return false;
    if (/(?:^|\n)###\s*__done__\s*(?:\n|$)/.test(text)) return false;
    return true;
  }
  function isInterviewDeadline(lead, touch) {
    var blob = [lead && lead.nextStep, lead && lead.notes, touch && touch.touchType]
      .map(function (v) { return String(v || "").toLowerCase(); })
      .join(" ");
    return /\b(interview|braintrust|deadline|due today|ai interview|onsite|phone screen)\b/.test(blob);
  }
  function classifyLead(lead) {
    var touch = touchFor(lead);
    var due = calendarDayKey(leadDueRaw(lead));
    var today = todayDayKey();
    var company = companyForLead(lead);
    if (isInterviewDeadline(lead, touch) && due) {
      return {
        tier: RANK_TIER.DEADLINE,
        dueDay: due,
        rankReason: due === today
          ? "due today · interview / deadline"
          : ("due " + due + " · interview / deadline"),
        northStar: !!(company && company.northStar),
        priority: companyPriority(lead),
      };
    }
    if (touch && WARM_TOUCH[touch.touchType]) {
      return {
        tier: RANK_TIER.WARM,
        dueDay: due,
        rankReason: due ? ("follow-up · " + due) : "follow-up",
        northStar: !!(company && company.northStar),
        priority: companyPriority(lead),
      };
    }
    if (notesLookLikePrep(lead && lead.notes)) {
      return {
        tier: RANK_TIER.PREP,
        dueDay: due,
        rankReason: "interview prep",
        northStar: !!(company && company.northStar),
        priority: companyPriority(lead),
      };
    }
    var wave = String((company && company.tier) || "other");
    var north = !!(company && company.northStar);
    var coldLabel = north ? "North Star" : (wave !== "other" ? wave.replace(/_/g, " ") : "outreach");
    return {
      tier: RANK_TIER.COLD,
      dueDay: due,
      rankReason: due ? (coldLabel + " · " + due) : coldLabel,
      northStar: north,
      priority: companyPriority(lead),
    };
  }
  function classifyReading(thread) {
    if (!thread || thread.done) {
      return { tier: RANK_TIER.PREP, dueDay: "", rankReason: "reading · done", hide: true };
    }
    var section = thread.currentSection && thread.currentSection.title
      ? String(thread.currentSection.title).trim()
      : "";
    return {
      tier: RANK_TIER.PREP,
      dueDay: "",
      rankReason: section ? ("reading · " + section) : "reading workbook",
      hide: false,
      northStar: false,
      priority: 100,
    };
  }
  function compareRanked(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    var da = a.dueDay || "";
    var db = b.dueDay || "";
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da || db) return da ? -1 : 1;
    if (a.tier === RANK_TIER.COLD) {
      if (!!a.northStar !== !!b.northStar) return a.northStar ? -1 : 1;
      var pa = Number(a.priority != null ? a.priority : 100) - Number(b.priority != null ? b.priority : 100);
      if (pa) return pa;
    }
    var qa = Number(a.queueOrder || 0) - Number(b.queueOrder || 0);
    if (qa) return qa;
    return String(a.sortTitle || "").localeCompare(String(b.sortTitle || ""));
  }
  function rankInboxItems() {
    // Flat priority list (mirrors api/_lib/inbox-rank.js).
    var items = [];
    visibleLeads().forEach(function (lead) {
      if (!lead || !lead.id) return;
      var cls = classifyLead(lead);
      items.push({
        kind: "person",
        lead: lead,
        tier: cls.tier,
        dueDay: cls.dueDay || "",
        rankReason: cls.rankReason,
        northStar: cls.northStar,
        priority: cls.priority,
        queueOrder: lead.queueOrder || 0,
        sortTitle: String(lead.personName || ""),
      });
    });
    (state.readingThreads || []).forEach(function (thread) {
      if (!thread || !thread.id) return;
      var cls = classifyReading(thread);
      if (cls.hide) return;
      items.push({
        kind: "reading",
        thread: thread,
        tier: cls.tier,
        dueDay: "",
        rankReason: cls.rankReason,
        northStar: false,
        priority: 100,
        queueOrder: 0,
        sortTitle: String(thread.title || ""),
      });
    });
    items.sort(compareRanked);
    return items;
  }
  function loadLogoCache() {
    try {
      var raw = localStorage.getItem(LOGO_CACHE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) { return {}; }
  }
  function saveLogoCache(cache) {
    try { localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* ignore */ }
  }
  function logoUrl(domain) {
    var d = String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    return d ? ("https://icons.duckduckgo.com/ip3/" + encodeURIComponent(d) + ".ico") : "";
  }
  function companyInitials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function personInitials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function companyForLead(lead) {
    if (!lead) return null;
    if (lead.companyId && state.companiesById[lead.companyId]) return state.companiesById[lead.companyId];
    var name = String(lead.company || "").trim().toLowerCase();
    if (!name) return null;
    for (var i = 0; i < state.companies.length; i++) {
      if (String(state.companies[i].name || "").trim().toLowerCase() === name) return state.companies[i];
    }
    return null;
  }
  function runPendingLogoFills() {
    logoIdleQueued = false;
    var jobs = pendingLogoFills.splice(0, pendingLogoFills.length);
    jobs.forEach(function (job) {
      try { job(); } catch (e) { /* ignore */ }
    });
  }
  function deferLogoFill(fn) {
    pendingLogoFills.push(fn);
    if (logoIdleQueued) return;
    logoIdleQueued = true;
    var kick = typeof requestIdleCallback === "function"
      ? function (cb) { requestIdleCallback(cb, { timeout: 400 }); }
      : function (cb) { setTimeout(cb, 0); };
    // Paint the rail text first; logos fill on the next idle frame.
    requestAnimationFrame(function () { kick(runPendingLogoFills); });
  }
  function fillCompanyLogo(node, company, opts) {
    opts = opts || {};
    if (!node) return;
    node.innerHTML = "";
    node.classList.remove("messages-avatar--photo", "messages-avatar--brand", "messages-rail__avatar--fallback");
    node.hidden = false;
    var domain = (company && company.domain) || "";
    var url = logoUrl(domain);
    var cache = loadLogoCache();
    var hit = domain ? cache[domain] : null;
    var now = Date.now();
    function fail() {
      node.innerHTML = "";
      node.classList.remove("messages-avatar--photo");
      if (opts.hideOnFail) node.hidden = true;
      if (typeof opts.onReady === "function") opts.onReady(false);
    }
    // No monogram fallback - only a resolved logo, else nothing.
    if (!url) { fail(); return; }
    if (hit && hit.failed && now - hit.at < LOGO_TTL_MS) { fail(); return; }
    // Reserve the badge slot so deferred logo loads do not shift the rail.
    if (opts.hideOnFail) node.hidden = true;
    function attach() {
      if (!node.isConnected) return;
      var img = el("img", "messages-avatar__img", {
        alt: "",
        // hideOnFail keeps the slot hidden until load; lazy images in a
        // hidden parent often never fetch, so those logos must be eager.
        loading: opts.hideOnFail ? "eager" : "lazy",
        decoding: "async",
      });
      img.addEventListener("load", function () {
        if (domain) { cache[domain] = { ok: true, at: Date.now() }; saveLogoCache(cache); }
        node.hidden = false;
        if (typeof opts.onReady === "function") opts.onReady(true);
      });
      img.addEventListener("error", function () {
        if (domain) { cache[domain] = { failed: true, at: Date.now() }; saveLogoCache(cache); }
        fail();
      });
      node.appendChild(img);
      node.classList.add("messages-avatar--photo");
      img.src = url;
    }
    if (opts.eager) attach();
    else deferLogoFill(attach);
  }
  function ownerPersonLabel() {
    return state.ownerPersonName || "Owner";
  }
  function fillOwnerMark(node, opts) {
    opts = opts || {};
    node.innerHTML = "";
    node.classList.remove("messages-avatar--photo", "messages-avatar--brand", "messages-rail__avatar--fallback");
    node.hidden = false;
    var alt = opts.alt || ownerPersonLabel();
    var url = state.ownerAvatarUrl || "";
    // Owner row keeps the real profile photo only - no initials fallback.
    if (!url) {
      node.hidden = true;
      return;
    }
    var img = el("img", "messages-avatar__img", { src: url, alt: alt });
    img.addEventListener("error", function () {
      node.innerHTML = "";
      node.classList.remove("messages-avatar--photo");
      node.hidden = true;
    });
    node.appendChild(img);
    node.classList.add("messages-avatar--photo");
  }
  function fillPersonAvatar(node, lead) {
    // Person rows: only a small company logo when it resolves. No circle, no monogram.
    node.innerHTML = "";
    node.classList.remove("messages-avatar--photo", "messages-rail__avatar--fallback");
    node.hidden = false;
    var company = companyForLead(lead);
    if (!company) {
      node.hidden = true;
      return;
    }
    fillCompanyLogo(node, company, {
      hideOnFail: true,
      onReady: function (ok) { node.hidden = !ok; },
    });
  }
  function showPane() {
    if (!pane) return;
    pane.hidden = false;
    document.body.classList.add("messages-shell-open", "messages-inbox-primary");
  }
  function setPaneHeader(name, roleText, opts) {
    opts = opts || {};
    if (!pane) return;
    var nameEl = pane.querySelector("[data-messages-name]");
    var role = pane.querySelector("[data-messages-role]");
    var avatar = pane.querySelector("[data-messages-avatar]");
    var links = pane.querySelector("[data-messages-links]");
    if (nameEl) nameEl.textContent = name || "Messages";
    if (role) {
      // Second line under the name; no middle-dot prefix (that forced one
      // long clipped line on iPhone). Title + company wrap freely.
      role.hidden = !roleText;
      role.textContent = roleText || "";
    }
    if (opts.showOwnerAvatar) {
      // Owner chrome: never keep a previous person's links.
      if (links) { links.hidden = true; links.innerHTML = ""; }
    }
    if (avatar) {
      avatar.innerHTML = "";
      avatar.classList.remove("messages-avatar--photo", "messages-avatar--brand");
      if (opts.showOwnerAvatar) {
        fillOwnerMark(avatar, { alt: name || ownerPersonLabel() });
      } else if (opts.company) {
        fillCompanyLogo(avatar, opts.company, {
          hideOnFail: true,
          eager: true,
          onReady: function (ok) { avatar.hidden = !ok; },
        });
      } else {
        avatar.hidden = true;
      }
    }
    // Person chats do not use company person-tabs.
    var tabs = pane.querySelector("[data-messages-tabs]");
    if (tabs) { tabs.innerHTML = ""; tabs.hidden = true; }
    var research = pane.querySelector("[data-messages-research]");
    if (research) { research.hidden = true; research.textContent = ""; }
  }
  function selectYou(opts) {
    opts = opts || {};
    state.selectedId = YOU_ID;
    if (root) {
      root.querySelectorAll("[data-conv-id]").forEach(function (btn) {
        btn.setAttribute("aria-current", btn.getAttribute("data-conv-id") === YOU_ID ? "true" : "false");
      });
    }
    document.body.classList.add("messages-you-active", "messages-thread-active");
    document.body.classList.remove("messages-reading-active");
    // Clear person profile links before owner chrome mounts.
    if (window.tinkerMessagesThread && typeof window.tinkerMessagesThread.clearProfileLinks === "function") {
      window.tinkerMessagesThread.clearProfileLinks();
    }
    setPaneHeader(ownerPersonLabel(), state.ownerTitle || "", { showOwnerAvatar: true });
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
          detail: { leadId: "", you: true, companyId: YOU_ID },
        }));
      } catch (e) { /* ignore */ }
    }
    if (!opts.silent && !opts.stayOnList && window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
      document.body.classList.add("messages-mobile-thread");
    }
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.open === "function") {
      window.tinkerMessagesYou.open();
    }
  }
  function selectReading(threadId, opts) {
    opts = opts || {};
    var id = String(threadId || "").trim();
    if (!id) return;
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.close === "function") {
      window.tinkerMessagesYou.close();
    }
    if (window.tinkerMessagesThread && typeof window.tinkerMessagesThread.clearProfileLinks === "function") {
      window.tinkerMessagesThread.clearProfileLinks();
    }
    state.selectedId = readingConvId(id);
    if (root) {
      root.querySelectorAll("[data-conv-id]").forEach(function (btn) {
        btn.setAttribute("aria-current", btn.getAttribute("data-conv-id") === state.selectedId ? "true" : "false");
      });
    }
    document.body.classList.add("messages-thread-active", "messages-reading-active");
    document.body.classList.remove("messages-you-active");
    var thread = (state.readingThreads || []).find(function (row) { return row && row.id === id; }) || null;
    var title = String(thread && thread.title || "Reading").trim() || "Reading";
    var sub = "";
    if (thread && thread.currentSection && thread.currentSection.title) {
      sub = String(thread.currentSection.title).trim();
    } else if (thread && thread.author) {
      sub = String(thread.author).trim();
    }
    setPaneHeader(title, sub, {});
    showPane();
    var emptyEl = pane && pane.querySelector("[data-messages-empty]");
    var threadEl = pane && pane.querySelector("[data-messages-thread]");
    if (emptyEl) emptyEl.hidden = true;
    if (threadEl) {
      threadEl.hidden = false;
      threadEl.setAttribute("data-thread-ready", "1");
    }
    if (!opts.silent) {
      try {
        window.dispatchEvent(new CustomEvent("tinker:messages-select", {
          detail: { leadId: "", reading: true, threadId: id },
        }));
      } catch (e) { /* ignore */ }
    }
    if (!opts.silent && !opts.stayOnList && window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
      document.body.classList.add("messages-mobile-thread");
    }
  }
  function selectLead(id, opts) {
    opts = opts || {};
    if (id === YOU_ID) { selectYou(opts); return; }
    if (readingIdFromConv(id)) { selectReading(readingIdFromConv(id), opts); return; }
    if (window.tinkerMessagesYou && typeof window.tinkerMessagesYou.close === "function") {
      window.tinkerMessagesYou.close();
    }
    document.body.classList.remove("messages-reading-active");
    // Drop prior thread links immediately so a previous person or owner URL
    // cannot linger while the new lead header loads.
    if (window.tinkerMessagesThread && typeof window.tinkerMessagesThread.clearProfileLinks === "function") {
      window.tinkerMessagesThread.clearProfileLinks();
    }
    state.selectedId = id || "";
    if (root) {
      root.querySelectorAll("[data-conv-id]").forEach(function (btn) {
        btn.setAttribute("aria-current", btn.getAttribute("data-conv-id") === state.selectedId ? "true" : "false");
      });
    }
    document.body.classList.toggle("messages-thread-active", !!state.selectedId);
    document.body.classList.remove("messages-you-active");
    if (!state.selectedId) {
      setPaneHeader("Messages", "", {});
      var empty = pane && pane.querySelector("[data-messages-empty]");
      var thread = pane && pane.querySelector("[data-messages-thread]");
      if (empty) { empty.hidden = false; empty.textContent = "Select a person to write."; }
      if (thread) { thread.hidden = true; thread.innerHTML = ""; }
      showPane();
      return;
    }
    var lead = state.leads.find(function (row) { return row.id === id; });
    var company = companyForLead(lead);
    var name = String(lead && lead.personName || "").trim() || "Someone";
    var bits = [];
    if (lead && lead.personTitle) bits.push(String(lead.personTitle).trim());
    if (lead && lead.company) bits.push("at " + String(lead.company).trim());
    setPaneHeader(name, bits.join(" "), {
      company: company || null,
    });
    showPane();
    var emptyEl = pane && pane.querySelector("[data-messages-empty]");
    var threadEl = pane && pane.querySelector("[data-messages-thread]");
    if (emptyEl) emptyEl.hidden = true;
    if (threadEl) {
      threadEl.hidden = false;
      threadEl.setAttribute("data-thread-ready", "1");
    }
    if (!opts.silent) {
      try {
        var touchEntry = state.touchesByLead[state.selectedId] || null;
        window.dispatchEvent(new CustomEvent("tinker:messages-select", {
          detail: { leadId: state.selectedId, touch: touchEntry, companyId: company && company.id || "" },
        }));
      } catch (e) { /* ignore */ }
    }
    if (state.selectedId && !opts.stayOnList && window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
      document.body.classList.add("messages-mobile-thread");
    }
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
    title.textContent = ownerPersonLabel();
    top.appendChild(title);
    main.appendChild(top);
    if (state.ownerTitle) {
      var preview = el("span", "messages-rail__preview");
      preview.textContent = state.ownerTitle;
      main.appendChild(preview);
    }
    btn.appendChild(avatar);
    btn.appendChild(main);
    btn.addEventListener("click", function () { selectYou(); });
    slot.appendChild(btn);
  }
  function renderReadingItem(thread, rankReason) {
    var convId = readingConvId(thread.id);
    var li = el("li");
    var unread = !thread.done;
    var btn = el("button", "messages-rail__row messages-rail__row--reading" + (unread ? " messages-rail__row--unread" : ""), {
      type: "button",
      "data-conv-id": convId,
      "data-reading-id": thread.id,
      "aria-current": convId === state.selectedId ? "true" : "false",
    });
    var avatar = el("span", "messages-rail__avatar messages-rail__avatar--reading", { "aria-hidden": "true" });
    avatar.textContent = "R";
    var main = el("span", "messages-rail__main");
    var top = el("span", "messages-rail__top");
    var name = el("span", "messages-rail__name");
    name.textContent = String(thread.title || "Reading").trim() || "Reading";
    top.appendChild(name);
    main.appendChild(top);
    var preview = el("span", "messages-rail__preview");
    preview.textContent = rankReason
      || (thread.currentSection && thread.currentSection.title
        ? String(thread.currentSection.title).trim()
        : (thread.author ? String(thread.author).trim() : "Pre-read"));
    main.appendChild(preview);
    btn.appendChild(avatar);
    btn.appendChild(main);
    btn.addEventListener("click", function () { selectReading(thread.id); });
    li.appendChild(btn);
    return li;
  }
  function renderPersonItem(lead, rankReason) {
    var unread = needsDraft(lead);
    var li = el("li");
    var btn = el("button", "messages-rail__row" + (unread ? " messages-rail__row--unread" : ""), {
      type: "button",
      "data-conv-id": lead.id,
      "aria-current": lead.id === state.selectedId ? "true" : "false",
    });
    var avatar = el("span", "messages-rail__logo", { "aria-hidden": "true" });
    fillPersonAvatar(avatar, lead);
    var main = el("span", "messages-rail__main");
    var top = el("span", "messages-rail__top");
    var title = el("span", "messages-rail__name");
    title.textContent = String(lead.personName || "").trim() || "Someone";
    var time = el("span", "messages-rail__time");
    var draft = latestDraftFor(lead.id);
    var touch = touchFor(lead);
    time.textContent = touch ? dueDayLabel(touch) : (lead.nextStepAt ? dueDayLabel({ date: lead.nextStepAt }) : relativeTime((draft && draft.updatedAt) || lead.updatedAt || lead.createdAt));
    top.appendChild(title);
    top.appendChild(time);
    var preview = el("span", "messages-rail__preview");
    preview.textContent = String(lead.personTitle || "").trim()
      || (draft ? draftPreview(draft) : "No draft yet. Write one when you are ready.");
    var meta = el("span", "messages-rail__meta");
    var reason = el("span", "messages-rail__touch");
    reason.textContent = rankReason || (touch ? touchTypeLabel(touch) : "");
    if (reason.textContent) meta.appendChild(reason);
    main.appendChild(top);
    main.appendChild(preview);
    if (reason.textContent) main.appendChild(meta);
    btn.appendChild(avatar);
    btn.appendChild(main);
    btn.addEventListener("click", function () { selectLead(lead.id); });
    li.appendChild(btn);
    return li;
  }
  function renderList() {
    if (!root) return;
    var list = root.querySelector("[data-messages-list]");
    var empty = root.querySelector("[data-messages-empty]");
    var err = root.querySelector("[data-messages-error]");
    if (!list || !empty || !err) return;

    if (state.error) { err.hidden = false; err.textContent = state.error; }
    else { err.hidden = true; err.textContent = ""; }

    var ranked = rankInboxItems();
    empty.hidden = ranked.length > 0 || !!state.error || state.loading;
    empty.textContent = "No people yet. Add them with the lead tools.";
    list.innerHTML = "";
    renderYouRow();
    // One flat priority list — no due-bucket or reading section heads.
    ranked.forEach(function (item) {
      if (item.kind === "reading") list.appendChild(renderReadingItem(item.thread, item.rankReason));
      else if (item.kind === "person") list.appendChild(renderPersonItem(item.lead, item.rankReason));
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
  function applyOwnerProfile(p) {
    state.ownerPersonName = p && p.name ? String(p.name).trim() : "";
    state.ownerAvatarUrl = p && p.avatarUrl ? String(p.avatarUrl).trim() : "";
    state.ownerTitle = p && p.title ? String(p.title).trim() : "";
    state.ownerLinkedInUrl = p && (p.linkedInUrl || p.linkedinUrl)
      ? String(p.linkedInUrl || p.linkedinUrl).trim()
      : "";
  }
  function applyInboxPayload(payload) {
    payload = payload || {};
    state.leads = Array.isArray(payload.leads) ? payload.leads : [];
    state.drafts = Array.isArray(payload.drafts) ? payload.drafts : [];
    state.touchesByLead = payload.byLeadId || payload.touchesByLead || {};
    if (Object.prototype.hasOwnProperty.call(payload, "readingThreads")) {
      state.readingThreads = Array.isArray(payload.readingThreads) ? payload.readingThreads : [];
    }
    var companies = Array.isArray(payload.companies) ? payload.companies : [];
    state.companies = companies;
    state.companiesById = {};
    companies.forEach(function (c) { if (c && c.id) state.companiesById[c.id] = c; });
    if (Object.prototype.hasOwnProperty.call(payload, "profile")) {
      applyOwnerProfile(payload.profile);
    } else if (payload.ownerPersonName != null || payload.ownerTitle != null) {
      state.ownerPersonName = payload.ownerPersonName || "";
      state.ownerAvatarUrl = payload.ownerAvatarUrl || "";
      state.ownerTitle = payload.ownerTitle || "";
      state.ownerLinkedInUrl = payload.ownerLinkedInUrl || "";
    }
    state.error = "";
    if (pane) pane.hidden = false;
  }
  function inboxSnapshot() {
    return {
      leads: state.leads,
      drafts: state.drafts,
      companies: state.companies,
      byLeadId: state.touchesByLead,
      readingThreads: state.readingThreads,
      ownerPersonName: state.ownerPersonName,
      ownerAvatarUrl: state.ownerAvatarUrl,
      ownerTitle: state.ownerTitle,
      ownerLinkedInUrl: state.ownerLinkedInUrl,
      savedAt: Date.now(),
    };
  }
  function readInboxCache() {
    try {
      var raw = localStorage.getItem(INBOX_CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.leads)) return null;
      return parsed;
    } catch (e) { return null; }
  }
  function writeInboxCache() {
    try { localStorage.setItem(INBOX_CACHE_KEY, JSON.stringify(inboxSnapshot())); }
    catch (e) { /* ignore quota */ }
  }
  function paintSelection() {
    if (state.selectedId === YOU_ID) {
      selectYou({ silent: true, stayOnList: !document.body.classList.contains("messages-mobile-thread") });
    } else if (isReadingSelected()) {
      selectReading(readingIdFromConv(state.selectedId), {
        silent: true,
        stayOnList: !document.body.classList.contains("messages-mobile-thread"),
      });
    } else if (state.selectedId) {
      selectLead(state.selectedId, { silent: true, stayOnList: !document.body.classList.contains("messages-mobile-thread") });
    } else {
      selectLead("", { silent: true });
    }
  }
  function fetchReadingThreads() {
    return readingApi("list").then(function (payload) {
      state.readingThreads = Array.isArray(payload.threads) ? payload.threads : [];
    }).catch(function () {
      // Older deploys / auth miss: keep any cached reading rows.
      if (!Array.isArray(state.readingThreads)) state.readingThreads = [];
    });
  }
  function fetchInboxBatched() {
    return leadsApi("inbox").then(function (payload) {
      applyInboxPayload(payload);
      return fetchReadingThreads().then(function () {
        writeInboxCache();
      });
    });
  }
  function fetchInboxLegacyParallel() {
    return Promise.all([
      leadsApi("list"),
      leadsApi("drafts"),
      scheduleApi("inbox").catch(function () { return { byLeadId: {} }; }),
      leadsApi("companies", { status: "active" }).catch(function () { return { companies: [] }; }),
      fetch("/api/user-data/profile", {
        headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
      }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; }),
    ]).then(function (results) {
      applyInboxPayload({
        leads: results[0].leads,
        drafts: results[1].drafts,
        byLeadId: (results[2] && results[2].byLeadId) || {},
        companies: (results[3] && results[3].companies) || [],
        profile: results[4] && results[4].data ? results[4].data : null,
      });
      return fetchReadingThreads().then(function () {
        writeInboxCache();
      });
    });
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
      state.readingThreads = [];
      applyOwnerProfile(null);
      state.error = "";
      if (pane) pane.hidden = false;
      document.body.classList.remove("messages-thread-active", "messages-mobile-thread", "messages-you-active", "messages-reading-active");
      renderList();
      selectLead("", { silent: true });
      return Promise.resolve();
    }
    state.loading = true;
    // Prefer one batched inbox round-trip; fall back to the old parallel fan-out.
    return fetchInboxBatched().catch(function (err) {
      if (err && (err.status === 401 || err.status === 403)) throw err;
      return fetchInboxLegacyParallel();
    }).catch(function (err) {
      if (!(state.leads && state.leads.length)) {
        state.leads = [];
        state.drafts = [];
        state.companies = [];
        state.companiesById = {};
        state.touchesByLead = {};
      }
      if (err.status === 401 || err.status === 403) {
        state.error = "";
        if (pane) pane.hidden = false;
      } else if (!(state.leads && state.leads.length)) {
        state.error = "Conversations could not load right now.";
        if (pane) pane.hidden = false;
      }
    }).finally(function () {
      state.loading = false;
      renderList();
      paintSelection();
    });
  }
  function bindChrome() {
    if (!root) return;
    var chip = root.querySelector("[data-messages-filter]");
    var back = pane && pane.querySelector("[data-messages-back]");
    if (chip) chip.addEventListener("click", function () { setCompanyFilter(""); });
    if (back) {
      back.addEventListener("click", function () {
        document.body.classList.remove("messages-mobile-thread", "messages-you-active", "messages-notepad-active");
        selectLead("", { silent: true });
        renderList();
      });
    }
    var brand = document.getElementById("nav-home");
    if (brand) {
      brand.addEventListener("click", function (e) {
        e.preventDefault();
        document.body.classList.remove("messages-mobile-thread", "messages-you-active", "messages-notepad-active");
        selectLead("", { silent: true });
        renderList();
        showPane();
      });
    }
  }
  function boot() {
    root = document.getElementById("sidebar-messages");
    pane = document.getElementById("messages-pane");
    if (!root) return;
    document.body.classList.add("messages-inbox-primary", "messages-shell-open");
    // Inbox is primary: clear the welcome "active" flag so the AI / No AI
    // pill (keyed off #welcome[data-active]) cannot float over the rail.
    var welcome = document.getElementById("welcome");
    if (welcome) welcome.removeAttribute("data-active");
    // Drop leftover company-tab hosts from older builds.
    var tabs = pane && pane.querySelector("[data-messages-tabs]");
    if (tabs) { tabs.innerHTML = ""; tabs.hidden = true; }
    bindChrome();
    // Warm path: paint the last inbox snapshot before the network returns.
    if (token()) {
      var cached = readInboxCache();
      if (cached) {
        applyInboxPayload(cached);
        renderList();
        if (pane) pane.hidden = false;
        try {
          performance.mark("tinker-inbox-cache-paint");
        } catch (e) { /* ignore */ }
      }
    }
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
    selectReading: selectReading,
    selectCompany: function () { /* company view removed; no-op for older callers */ },
    showCompanyList: function () {
      document.body.classList.remove("messages-mobile-thread");
      selectLead("", { silent: true });
      renderList();
    },
    setCompanyFilter: setCompanyFilter,
    getSelectedId: function () { return state.selectedId; },
    getSelectedCompanyId: function () { return ""; },
    touchForLead: function (id) { return (id && state.touchesByLead[id]) || null; },
    companyForLead: companyForLead,
    getCompany: function (id) { return (id && state.companiesById[id]) || null; },
    fillCompanyLogo: fillCompanyLogo,
    ownerProfile: function () {
      return {
        name: ownerPersonLabel(),
        personName: ownerPersonLabel(),
        initials: personInitials(ownerPersonLabel()),
        avatarUrl: state.ownerAvatarUrl || "",
        title: state.ownerTitle || "",
        linkedInUrl: state.ownerLinkedInUrl || "",
      };
    },
    YOU_ID: YOU_ID,
    READING_PREFIX: READING_PREFIX,
    OWNER_LABEL: OWNER_LABEL,
    OWNER_LOGO: OWNER_LOGO,
    CHANNEL_LABEL: CHANNEL_LABEL,
    TOUCH_LABEL: TOUCH_LABEL,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
