/* Sidebar message draft center. Destination icons, connection counter,
 * from-address for Gmail. Edit / approve / copy / open channel / mark sent.
 * Tinker never sends.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  /* LinkedIn connection-request note limit. Free Basic and Premium both
   * commonly cap the note at 300 characters (see PR citations). Single
   * constant so the live counter has one source of truth. */
  var LINKEDIN_CONNECTION_NOTE_MAX = 300;
  var GROUPS = [
    { key: "draft", label: "Needs review" },
    { key: "approved", label: "Ready to send" },
    { key: "sent_by_owner", label: "Sent" },
  ];
  /* Extensible destination map — a fourth LinkedIn DM channel is a one-line add later. */
  var DESTINATIONS = {
    linkedin_post: {
      label: "LinkedIn post",
      shortLabel: "Post",
      openLabel: "Open LinkedIn",
      kind: "linkedin",
      leadless: true,
    },
    linkedin_connection: {
      label: "LinkedIn connection",
      shortLabel: "Connection",
      openLabel: "Open LinkedIn",
      kind: "linkedin",
      leadless: false,
      charLimit: LINKEDIN_CONNECTION_NOTE_MAX,
    },
    gmail_outreach: {
      label: "Gmail outreach",
      shortLabel: "Gmail",
      openLabel: "Open Gmail",
      kind: "gmail",
      leadless: false,
    },
  };
  var state = {
    drafts: [],
    loading: false,
    error: "",
    companyFilter: "",
    settings: { defaultFromAddress: "" },
  };
  var overlay = null;
  var concealed = [];
  var root = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function destination(ch) {
    return DESTINATIONS[ch] || {
      label: ch || "Message",
      shortLabel: ch || "Message",
      openLabel: "Open",
      kind: "other",
      leadless: false,
    };
  }
  function relativeTime(iso) {
    if (!iso) return "";
    var ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "";
    var m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }
  function leadLabel(draft) {
    var dest = destination(draft.channel);
    if (dest.leadless || !draft.lead) {
      return dest.shortLabel === "Post" ? "Post" : dest.label;
    }
    var person = String(draft.lead.personName || "").trim() || "Someone";
    var company = String(draft.lead.company || "").trim();
    return company ? person + " · " + company : person;
  }
  function fromFor(draft) {
    var raw = String((draft && draft.fromAddress) || state.settings.defaultFromAddress || "").trim();
    return raw;
  }

  function destinationIcon(ch) {
    var dest = destination(ch);
    var wrap = el("span", "sidebar__drafts-dest", {
      title: dest.label,
      "aria-label": dest.label,
      role: "img",
    });
    var svg;
    if (dest.kind === "gmail") {
      svg = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">'
        + '<path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5L4 8V6l8 5 8-5v2z"/></svg>';
    } else if (ch === "linkedin_post") {
      svg = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">'
        + '<path fill="currentColor" d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-5l-3 3-3-3H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2 4v2h12V7H6zm0 4v2h8v-2H6z"/></svg>';
    } else {
      svg = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">'
        + '<path fill="currentColor" d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14zM8.5 9.5A1.5 1.5 0 1 0 8.5 6a1.5 1.5 0 0 0 0 3.5zM7 18h3v-5.5H7V18zm5 0h3v-8h-3v8z"/></svg>';
    }
    wrap.innerHTML = svg;
    return wrap;
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
    return fetch("/api/leads?" + q.toString(), opts).then(function (res) {
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

  function snap(node) {
    return {
      node: node, display: node.style.display, pointerEvents: node.style.pointerEvents,
      hidden: !!node.hidden, active: node.hasAttribute("data-active"),
      inert: node.hasAttribute("inert"), ariaHidden: node.getAttribute("aria-hidden"),
    };
  }
  function conceal(node) {
    if (node.hasAttribute("data-active")) node.removeAttribute("data-active");
    node.hidden = true;
    node.setAttribute("inert", "");
    node.setAttribute("aria-hidden", "true");
    node.style.display = "none";
    node.style.pointerEvents = "none";
  }
  function concealSurfaces() {
    var saved = [];
    var stage = document.getElementById("stage");
    if (stage) {
      for (var i = 0; i < stage.children.length; i++) {
        var child = stage.children[i];
        if (child.getAttribute("aria-label") === "Message draft") continue;
        saved.push(snap(child));
        conceal(child);
      }
    }
    var modeNav = document.getElementById("mode-nav");
    if (modeNav) { saved.push(snap(modeNav)); conceal(modeNav); }
    return saved;
  }
  function restore(saved) {
    saved.forEach(function (item) {
      var n = item.node;
      n.style.display = item.display;
      n.style.pointerEvents = item.pointerEvents;
      n.hidden = item.hidden;
      if (item.inert) n.setAttribute("inert", ""); else n.removeAttribute("inert");
      if (item.ariaHidden == null) n.removeAttribute("aria-hidden");
      else n.setAttribute("aria-hidden", item.ariaHidden);
      if (item.active) n.setAttribute("data-active", ""); else n.removeAttribute("data-active");
    });
  }
  function closePanel() {
    if (concealed.length) { restore(concealed); concealed = []; }
    if (!overlay) return;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    overlay = null;
  }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); closePanel(); } }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    area.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
  }

  function openChannel(draft, lead) {
    var dest = destination(draft.channel);
    if (dest.kind === "gmail") {
      var p = new URLSearchParams();
      if (lead && lead.email) p.set("to", lead.email);
      if (draft.subject) p.set("su", draft.subject);
      if (draft.body) p.set("body", draft.body);
      var from = fromFor(draft);
      if (from) p.set("authuser", from);
      window.open("https://mail.google.com/mail/?view=cm&fs=1&" + p.toString(), "_blank", "noopener");
      return;
    }
    window.open((lead && lead.linkedInUrl) || "https://www.linkedin.com/", "_blank", "noopener");
  }

  function bindFromSettings() {
    if (!root) return;
    var input = root.querySelector("[data-drafts-from]");
    var save = root.querySelector("[data-drafts-from-save]");
    if (!input || !save || save.getAttribute("data-bound")) return;
    save.setAttribute("data-bound", "1");
    input.value = state.settings.defaultFromAddress || "";
    save.addEventListener("click", function () {
      var value = String(input.value || "").trim().toLowerCase();
      save.disabled = true;
      api("POST", "settings", { defaultFromAddress: value }).then(function (res) {
        state.settings = res.settings || { defaultFromAddress: value };
        input.value = state.settings.defaultFromAddress || "";
      }).catch(function () { /* keep prior */ })
        .finally(function () { save.disabled = false; });
    });
  }

  function renderSidebar() {
    if (!root) return;
    var list = root.querySelector("[data-drafts-list]");
    var badge = root.querySelector("[data-drafts-badge]");
    var empty = root.querySelector("[data-drafts-empty]");
    var err = root.querySelector("[data-drafts-error]");
    var filter = root.querySelector("[data-drafts-filter]");
    var fromInput = root.querySelector("[data-drafts-from]");
    if (!list || !badge || !empty || !err) return;
    if (fromInput && document.activeElement !== fromInput) {
      fromInput.value = state.settings.defaultFromAddress || "";
    }
    if (filter) {
      if (state.companyFilter) {
        filter.hidden = false;
        filter.textContent = "Showing " + state.companyFilter + " · Clear";
      } else {
        filter.hidden = true;
        filter.textContent = "";
      }
    }
    var review = state.drafts.filter(function (d) { return d.status === "draft"; }).length;
    badge.hidden = review < 1;
    badge.textContent = review > 0 ? String(review) : "";
    if (state.error) { err.hidden = false; err.textContent = state.error; }
    else { err.hidden = true; err.textContent = ""; }
    list.innerHTML = "";
    empty.hidden = state.drafts.length > 0 || !!state.error || state.loading;
    if (!state.drafts.length) return;
    GROUPS.forEach(function (group) {
      var items = state.drafts.filter(function (d) { return d.status === group.key; });
      if (!items.length) return;
      var groupEl = el("li", "sidebar__drafts-group");
      var head = el("h3", "sidebar__drafts-group-head");
      head.textContent = group.label;
      groupEl.appendChild(head);
      var ul = el("ul", "sidebar__drafts-group-list");
      items.forEach(function (draft) {
        var dest = destination(draft.channel);
        var li = el("li");
        var btn = el("button", "sidebar__account-item sidebar__drafts-row", { type: "button" });
        var tip = dest.label;
        var from = fromFor(draft);
        if (draft.channel === "gmail_outreach" && from) tip += " · from " + from;
        btn.title = tip;
        btn.appendChild(destinationIcon(draft.channel));
        var main = el("span", "sidebar__drafts-row-main");
        var title = el("span", "sidebar__account-label");
        title.textContent = leadLabel(draft);
        var meta = el("span", "sidebar__drafts-row-meta");
        meta.textContent = dest.shortLabel + " · " + relativeTime(draft.updatedAt);
        main.appendChild(title);
        main.appendChild(meta);
        btn.appendChild(main);
        btn.addEventListener("click", function () { openDraft(draft.id); });
        li.appendChild(btn);
        ul.appendChild(li);
      });
      groupEl.appendChild(ul);
      list.appendChild(groupEl);
    });
  }

  function syncCharCounter(input, counter, limit) {
    var n = String(input.value || "").length;
    counter.textContent = n + " / " + limit;
    var over = n > limit;
    counter.classList.toggle("sidebar__drafts-counter--over", over);
    counter.setAttribute("aria-live", "polite");
    if (over) counter.setAttribute("role", "status");
    else counter.removeAttribute("role");
  }

  function openDraft(id) {
    var draft = state.drafts.find(function (d) { return d.id === id; });
    if (!draft) return;
    closePanel();
    concealed = concealSurfaces();
    document.addEventListener("keydown", onKey, true);
    var stage = document.getElementById("stage") || document.body;
    overlay = el("section", "writing", { role: "region", "aria-label": "Message draft" });
    var dest = destination(draft.channel);

    var header = el("header", "writing__top");
    var closeBtn = el("button", "writing__close", { type: "button", "aria-label": "Close" });
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    closeBtn.addEventListener("click", closePanel);
    var step = el("div", "writing__step");
    step.textContent = "Draft";
    header.appendChild(closeBtn);
    header.appendChild(step);

    var body = el("div", "writing__body");
    var card = el("div", "writing-card");
    var titleRow = el("div", "sidebar__drafts-open-title");
    titleRow.appendChild(destinationIcon(draft.channel));
    var title = el("h2", "writing-question");
    title.textContent = leadLabel(draft);
    titleRow.appendChild(title);
    card.appendChild(titleRow);
    var sub = el("p", "writing-note");
    var role = draft.lead && draft.lead.targetRoleTitle ? draft.lead.targetRoleTitle + " · " : "";
    sub.textContent = role + dest.label + ". You approve and copy; Tinker never sends.";
    card.appendChild(sub);

    var fromInput = null;
    if (draft.channel === "gmail_outreach") {
      card.appendChild(Object.assign(el("p", "writing-note"), { textContent: "From address" }));
      fromInput = el("input", "writing-input sidebar__drafts-from-input", {
        type: "email",
        name: "fromAddress",
        autocomplete: "email",
        placeholder: state.settings.defaultFromAddress || "you@example.com",
      });
      fromInput.value = draft.fromAddress || state.settings.defaultFromAddress || "";
      card.appendChild(fromInput);
      card.appendChild(Object.assign(el("p", "writing-note"), { textContent: "Subject" }));
      var subjectInput = el("textarea", "writing-input", { rows: "1", name: "subject" });
      subjectInput.value = draft.subject || "";
      card.appendChild(subjectInput);
    } else {
      var subjectInput = null;
    }

    card.appendChild(Object.assign(el("p", "writing-note"), { textContent: "Message" }));
    var bodyInput = el("textarea", "writing-input", { rows: "10", name: "body" });
    bodyInput.value = draft.body || "";
    card.appendChild(bodyInput);

    var counter = null;
    if (dest.charLimit) {
      counter = el("p", "sidebar__drafts-counter writing-note");
      syncCharCounter(bodyInput, counter, dest.charLimit);
      bodyInput.addEventListener("input", function () {
        syncCharCounter(bodyInput, counter, dest.charLimit);
      });
      card.appendChild(counter);
    }

    var parts = Array.isArray(draft.storyPartIds) ? draft.storyPartIds : [];
    var partsNote = el("p", "writing-note sidebar__drafts-parts");
    partsNote.textContent = parts.length
      ? ("Story parts used: " + parts.join(", "))
      : "No story parts recorded on this draft.";
    card.appendChild(partsNote);
    var status = el("p", "writing-note", { role: "status", "aria-live": "polite" });
    status.hidden = true;
    card.appendChild(status);
    body.appendChild(el("div", "writing__stage")).appendChild(card);

    var foot = el("footer", "writing__foot");
    var saveBtn = el("button", "writing__end", { type: "button" });
    saveBtn.textContent = "Save edits";
    var approveBtn = el("button", "writing__end", { type: "button" });
    approveBtn.textContent = "Approve";
    var copyBtn = el("button", "writing__end", { type: "button" });
    copyBtn.textContent = "Copy";
    var openBtn = el("button", "writing__end", { type: "button" });
    openBtn.textContent = dest.openLabel;
    var sentBtn = el("button", "writing__next", { type: "button" });
    sentBtn.textContent = "Mark sent";
    [saveBtn, approveBtn, copyBtn, openBtn, sentBtn].forEach(function (b) { foot.appendChild(b); });

    var sent = draft.status === "sent_by_owner";
    if (sent) {
      saveBtn.disabled = approveBtn.disabled = sentBtn.disabled = true;
      bodyInput.readOnly = true;
      if (subjectInput) subjectInput.readOnly = true;
      if (fromInput) fromInput.readOnly = true;
    } else if (draft.status === "approved") approveBtn.disabled = true;

    function show(msg, kind) {
      status.hidden = false;
      status.textContent = msg;
      status.className = kind === "error" ? "writing-error" : "writing-note";
    }
    function values() {
      return {
        subject: subjectInput ? subjectInput.value : draft.subject,
        body: bodyInput.value,
        fromAddress: fromInput ? fromInput.value : draft.fromAddress,
      };
    }

    saveBtn.addEventListener("click", function () {
      var v = values();
      var payload = { id: draft.id, body: v.body };
      if (draft.channel === "gmail_outreach") {
        payload.subject = v.subject;
        payload.fromAddress = v.fromAddress;
      }
      saveBtn.disabled = true;
      api("PATCH", "draft", payload).then(function (res) {
        Object.assign(draft, res.draft);
        show("Saved. You can approve when it reads right.", "ok");
        refresh();
      }).catch(function (err) { show(err.message || "Could not save.", "error"); })
        .finally(function () { saveBtn.disabled = sent; });
    });
    approveBtn.addEventListener("click", function () {
      approveBtn.disabled = true;
      api("POST", "approve", { id: draft.id }).then(function (res) {
        Object.assign(draft, res.draft);
        show("Approved. Copy it or open the channel, then mark sent.", "ok");
        refresh();
      }).catch(function (err) {
        show(err.message || "Could not approve.", "error");
        approveBtn.disabled = false;
      });
    });
    copyBtn.addEventListener("click", function () {
      var text = values().body.trim();
      if (!text) return;
      copyText(text).then(function () { show("Copied. You still send it yourself.", "ok"); })
        .catch(function () { show("Could not copy.", "error"); });
    });
    openBtn.addEventListener("click", function () {
      openChannel(Object.assign({}, draft, values()), draft.lead);
    });
    sentBtn.addEventListener("click", function () {
      sentBtn.disabled = true;
      api("POST", "mark-sent", { id: draft.id }).then(function (res) {
        Object.assign(draft, res.draft);
        if (res.lead) draft.lead = res.lead;
        show(draft.lead ? "Marked sent. The lead is contacted." : "Marked sent.", "ok");
        bodyInput.readOnly = true;
        if (subjectInput) subjectInput.readOnly = true;
        if (fromInput) fromInput.readOnly = true;
        saveBtn.disabled = approveBtn.disabled = true;
        refresh();
      }).catch(function (err) {
        show(err.message || "Could not mark sent.", "error");
        sentBtn.disabled = false;
      });
    });

    overlay.appendChild(header);
    overlay.appendChild(body);
    overlay.appendChild(foot);
    stage.appendChild(overlay);
    bodyInput.focus();
  }

  function refresh() {
    if (!token()) {
      state.drafts = [];
      state.error = "";
      if (root) root.hidden = true;
      renderSidebar();
      return Promise.resolve();
    }
    state.loading = true;
    var query = {};
    if (state.companyFilter) query.company = state.companyFilter;
    return Promise.all([
      api("GET", "drafts", null, query),
      api("GET", "settings").catch(function () { return { settings: state.settings }; }),
    ]).then(function (results) {
      var payload = results[0];
      var settingsPayload = results[1];
      state.drafts = Array.isArray(payload.drafts) ? payload.drafts : [];
      if (settingsPayload && settingsPayload.settings) state.settings = settingsPayload.settings;
      state.error = "";
      if (root) root.hidden = false;
    }).catch(function (err) {
      state.drafts = [];
      if (err.status === 401 || err.status === 403) {
        state.error = "";
        if (root) root.hidden = true;
      } else {
        state.error = "Drafts could not load right now.";
        if (root) root.hidden = false;
      }
    }).finally(function () {
      state.loading = false;
      renderSidebar();
    });
  }

  function setCompanyFilter(company) {
    state.companyFilter = String(company || "").trim();
    return refresh();
  }

  function bindToggle() {
    if (!root) return;
    var toggle = root.querySelector("[data-drafts-toggle]");
    var panel = root.querySelector("[data-drafts-panel]");
    var filter = root.querySelector("[data-drafts-filter]");
    if (!toggle || !panel) return;
    function sync() {
      var open = root.getAttribute("data-open") !== "false";
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    toggle.addEventListener("click", function () {
      root.setAttribute("data-open", root.getAttribute("data-open") !== "false" ? "false" : "true");
      sync();
    });
    if (filter && !filter.getAttribute("data-bound")) {
      filter.setAttribute("data-bound", "1");
      filter.addEventListener("click", function () { setCompanyFilter(""); });
    }
    root.setAttribute(
      "data-open",
      window.matchMedia && window.matchMedia("(max-width: 540px)").matches ? "false" : "true",
    );
    sync();
    bindFromSettings();
  }

  function boot() {
    root = document.getElementById("sidebar-drafts");
    if (!root) return;
    bindToggle();
    refresh();
    window.addEventListener("storage", function (e) { if (e.key === TOKEN_KEY) refresh(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  }

  window.tinkerLeadDrafts = {
    refresh: refresh,
    openDraft: openDraft,
    close: closePanel,
    setCompanyFilter: setCompanyFilter,
    LINKEDIN_CONNECTION_NOTE_MAX: LINKEDIN_CONNECTION_NOTE_MAX,
    DESTINATIONS: DESTINATIONS,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
