/* Sidebar draft center. Destinations: linkedin_post, linkedin_connection,
 * gmail_outreach (add linkedin_message later with one DESTINATIONS entry).
 * LINKEDIN_CONNECTION_NOTE_LIMIT=200 per LinkedIn Help a563153 (free note
 * limit; Premium is longer — we warn at free so notes always fit).
 * Tinker never sends.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  var TOKEN_KEY = "tinker_jwt";
  var LINKEDIN_CONNECTION_NOTE_LIMIT = 200;
  var GROUPS = [
    { key: "draft", label: "Needs review" },
    { key: "approved", label: "Ready to copy" },
    { key: "approved_to_send", label: "Queued to send" },
    { key: "send_failed", label: "Send failed" },
    { key: "sent_by_owner", label: "Sent" },
  ];
  var DESTINATIONS = {
    linkedin_post: { label: "LinkedIn post", open: "linkedin", needsLead: false },
    linkedin_connection: { label: "LinkedIn connection request", open: "linkedin", needsLead: true, charLimit: LINKEDIN_CONNECTION_NOTE_LIMIT },
    gmail_outreach: { label: "Gmail outreach", open: "gmail", needsLead: true },
  };
  /* Reply = lead stage replied+ (no LeadDraft.isReply column). */
  var REPLY_STAGES = { replied: 1, call: 1, interview: 1, offer: 1 };
  var state = {
    drafts: [], loading: false, error: "", defaultFrom: "", bookingUrl: "",
    sendingEnabled: false, companyFilter: "",
  };
  var overlay = null, concealed = [], root = null;

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function dest(ch) { return DESTINATIONS[ch] || { label: ch || "Message", open: "linkedin", needsLead: true }; }
  function relativeTime(iso) {
    if (!iso) return "";
    var ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "";
    var m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    return h < 48 ? h + "h ago" : Math.round(h / 24) + "d ago";
  }
  function rowTitle(draft) {
    var d = dest(draft.channel);
    if (!d.needsLead || !draft.lead) return "Post";
    var person = String(draft.lead.personName || "").trim() || "Someone";
    var company = String(draft.lead.company || "").trim();
    return company ? person + " · " + company : person;
  }
  function destinationIcon(channel) {
    var d = dest(channel);
    var wrap = el("span", "sidebar__drafts-dest", { role: "img", "aria-label": d.label, title: d.label });
    if (channel === "gmail_outreach") {
      wrap.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    } else if (channel === "linkedin_connection") {
      wrap.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.6"/><path d="M17 8v6M14 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    } else {
      wrap.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M7 9h10M7 12h10M7 15h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    }
    return wrap;
  }
  function api(method, action, body, query) {
    var q = new URLSearchParams(Object.assign({ action: action }, query || {}));
    var opts = { method: method, headers: { Authorization: "Bearer " + token(), Accept: "application/json" } };
    if (method !== "GET") { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body || {}); }
    return fetch("/api/leads?" + q.toString(), opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok) { var err = new Error((payload && payload.error) || "Request failed"); err.status = res.status; throw err; }
        return payload;
      });
    });
  }
  function snap(node) {
    return { node: node, display: node.style.display, pointerEvents: node.style.pointerEvents, hidden: !!node.hidden, active: node.hasAttribute("data-active"), inert: node.hasAttribute("inert"), ariaHidden: node.getAttribute("aria-hidden") };
  }
  function conceal(node) {
    if (node.hasAttribute("data-active")) node.removeAttribute("data-active");
    node.hidden = true; node.setAttribute("inert", ""); node.setAttribute("aria-hidden", "true");
    node.style.display = "none"; node.style.pointerEvents = "none";
  }
  function concealSurfaces() {
    var saved = [], stage = document.getElementById("stage");
    if (stage) for (var i = 0; i < stage.children.length; i++) {
      var child = stage.children[i];
      if (child.getAttribute("aria-label") === "Message draft") continue;
      saved.push(snap(child)); conceal(child);
    }
    var modeNav = document.getElementById("mode-nav");
    if (modeNav) { saved.push(snap(modeNav)); conceal(modeNav); }
    return saved;
  }
  function restore(saved) {
    saved.forEach(function (item) {
      var n = item.node;
      n.style.display = item.display; n.style.pointerEvents = item.pointerEvents; n.hidden = item.hidden;
      if (item.inert) n.setAttribute("inert", ""); else n.removeAttribute("inert");
      if (item.ariaHidden == null) n.removeAttribute("aria-hidden"); else n.setAttribute("aria-hidden", item.ariaHidden);
      if (item.active) n.setAttribute("data-active", ""); else n.removeAttribute("data-active");
    });
  }
  function closePanel() {
    if (concealed.length) { restore(concealed); concealed = []; }
    if (!overlay) return;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove(); overlay = null;
  }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); closePanel(); } }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var area = document.createElement("textarea");
    area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.left = "-9999px";
    document.body.appendChild(area); area.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    area.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
  }
  function effectiveFrom(draft) { return String((draft && draft.fromAddress) || state.defaultFrom || "").trim(); }
  function isReplyDraft(draft) {
    if (!draft || draft.channel === "linkedin_post") return false;
    var stage = draft.lead && draft.lead.stage;
    return !!(stage && REPLY_STAGES[stage]);
  }
  function openDestination(draft, lead) {
    if (dest(draft.channel).open === "gmail") {
      var p = new URLSearchParams();
      if (lead && lead.email) p.set("to", lead.email);
      if (draft.subject) p.set("su", draft.subject);
      if (draft.body) p.set("body", draft.body);
      var from = effectiveFrom(draft); if (from) p.set("authuser", from);
      window.open("https://mail.google.com/mail/?view=cm&fs=1&" + p.toString(), "_blank", "noopener");
      return;
    }
    window.open((lead && lead.linkedInUrl) || "https://www.linkedin.com/", "_blank", "noopener");
  }
  function rowTooltip(draft) {
    var parts = [dest(draft.channel).label];
    if (draft.channel === "gmail_outreach") {
      var from = effectiveFrom(draft);
      parts.push(from ? ("From " + from) : "No from address set");
    }
    return parts.join(" · ");
  }
  function syncFilterChip() {
    if (!root) return;
    var chip = root.querySelector("[data-drafts-filter]");
    if (!chip) return;
    if (!state.companyFilter) { chip.hidden = true; chip.textContent = ""; return; }
    chip.hidden = false;
    chip.textContent = "Showing " + state.companyFilter + " · Clear";
  }
  function renderSidebar() {
    if (!root) return;
    var list = root.querySelector("[data-drafts-list]");
    var badge = root.querySelector("[data-drafts-badge]");
    var empty = root.querySelector("[data-drafts-empty]");
    var err = root.querySelector("[data-drafts-error]");
    var fromInput = root.querySelector("[data-drafts-from]");
    var bookingInput = root.querySelector("[data-drafts-booking]");
    if (fromInput && document.activeElement !== fromInput) fromInput.value = state.defaultFrom || "";
    if (bookingInput && document.activeElement !== bookingInput) bookingInput.value = state.bookingUrl || "";
    /* Draft list removed in TYL-65 — thread + composer own that UI. */
    if (!list || !badge || !empty || !err) return;
    syncFilterChip();
    var review = state.drafts.filter(function (d) { return d.status === "draft"; }).length;
    badge.hidden = review < 1; badge.textContent = review > 0 ? String(review) : "";
    if (state.error) { err.hidden = false; err.textContent = state.error; }
    else { err.hidden = true; err.textContent = ""; }
    list.innerHTML = "";
    empty.hidden = state.drafts.length > 0 || !!state.error || state.loading;
    if (!state.drafts.length) return;
    GROUPS.forEach(function (group) {
      var items = state.drafts.filter(function (d) { return d.status === group.key; });
      if (!items.length) return;
      var groupEl = el("li", "sidebar__drafts-group");
      var head = el("h3", "sidebar__drafts-group-head"); head.textContent = group.label; groupEl.appendChild(head);
      var ul = el("ul", "sidebar__drafts-group-list");
      items.forEach(function (draft) {
        var li = el("li");
        var btn = el("button", "sidebar__account-item sidebar__drafts-row", { type: "button", title: rowTooltip(draft) });
        btn.appendChild(destinationIcon(draft.channel));
        var main = el("span", "sidebar__drafts-row-main");
        var title = el("span", "sidebar__account-label"); title.textContent = rowTitle(draft);
        var meta = el("span", "sidebar__drafts-row-meta");
        meta.textContent = dest(draft.channel).label + " · " + relativeTime(draft.updatedAt);
        main.appendChild(title); main.appendChild(meta); btn.appendChild(main);
        btn.addEventListener("click", function () { openDraft(draft.id); });
        li.appendChild(btn); ul.appendChild(li);
      });
      groupEl.appendChild(ul); list.appendChild(groupEl);
    });
  }
  function openDraft(id) {
    var draft = state.drafts.find(function (d) { return d.id === id; });
    if (!draft) return;
    closePanel(); concealed = concealSurfaces(); document.addEventListener("keydown", onKey, true);
    var stage = document.getElementById("stage") || document.body;
    overlay = el("section", "writing", { role: "region", "aria-label": "Message draft" });
    var d = dest(draft.channel);
    var header = el("header", "writing__top");
    var closeBtn = el("button", "writing__close", { type: "button", "aria-label": "Close" });
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    closeBtn.addEventListener("click", closePanel);
    var step = el("div", "writing__step"); step.textContent = "Draft";
    header.appendChild(closeBtn); header.appendChild(step);
    var body = el("div", "writing__body");
    var card = el("div", "writing-card");
    var titleRow = el("div", "sidebar__drafts-open-title");
    titleRow.appendChild(destinationIcon(draft.channel));
    var title = el("h2", "writing-question"); title.textContent = rowTitle(draft); titleRow.appendChild(title);
    card.appendChild(titleRow);
    var sub = el("p", "writing-note");
    var role = draft.lead && draft.lead.targetRoleTitle ? draft.lead.targetRoleTitle + " · " : "";
    sub.textContent = role + d.label + ". You approve and copy; Tinker never sends.";
    card.appendChild(sub);
    var subjectInput = null;
    if (draft.channel === "gmail_outreach") {
      card.appendChild(Object.assign(el("p", "writing-note"), { textContent: "Subject" }));
      subjectInput = el("textarea", "writing-input", { rows: "1", name: "subject" });
      subjectInput.value = draft.subject || ""; card.appendChild(subjectInput);
      card.appendChild(Object.assign(el("p", "writing-note"), { textContent: "From" }));
      var fromInput = el("input", "writing-input", { type: "email", name: "fromAddress", placeholder: state.defaultFrom || "you@example.com" });
      fromInput.value = draft.fromAddress || state.defaultFrom || ""; card.appendChild(fromInput);
      card.appendChild(Object.assign(el("p", "writing-note"), { textContent: state.defaultFrom ? ("Default is " + state.defaultFrom + ".") : "Set a default under Settings." }));
    }
    card.appendChild(Object.assign(el("p", "writing-note"), { textContent: "Message" }));
    var bodyInput = el("textarea", "writing-input", { rows: "10", name: "body" });
    bodyInput.value = draft.body || ""; card.appendChild(bodyInput);
    var counter = null;
    if (d.charLimit) {
      counter = el("p", "writing-note sidebar__drafts-counter", { role: "status", "aria-live": "polite" });
      function syncCount() {
        var n = bodyInput.value.length, over = n > d.charLimit;
        counter.textContent = n + " / " + d.charLimit + (over ? " — over LinkedIn’s free note limit" : "");
        counter.className = "writing-note sidebar__drafts-counter" + (over ? " sidebar__drafts-counter--over" : "");
      }
      bodyInput.addEventListener("input", syncCount); syncCount(); card.appendChild(counter);
    }
    var parts = Array.isArray(draft.storyPartIds) ? draft.storyPartIds : [];
    card.appendChild(Object.assign(el("p", "writing-note sidebar__drafts-parts"), {
      textContent: parts.length ? ("Story parts used: " + parts.join(", ")) : "No story parts recorded on this draft.",
    }));
    var status = el("p", "writing-note", { role: "status", "aria-live": "polite" }); status.hidden = true; card.appendChild(status);
    body.appendChild(el("div", "writing__stage")).appendChild(card);
    var foot = el("footer", "writing__foot");
    function btn(label, cls) { var b = el("button", cls || "writing__end", { type: "button" }); b.textContent = label; return b; }
    var saveBtn = btn("Save edits"), approveBtn = btn("Approve"), copyBtn = btn("Copy");
    var bookingBtn = null;
    if (isReplyDraft(draft)) {
      bookingBtn = btn("Insert booking link");
      if (!state.bookingUrl) bookingBtn.disabled = true;
    }
    var openBtn = btn(d.open === "gmail" ? "Open Gmail" : "Open LinkedIn");
    var sentBtn = btn("Mark sent", "writing__next");
    [saveBtn, approveBtn, copyBtn].forEach(function (b) { foot.appendChild(b); });
    if (bookingBtn) foot.appendChild(bookingBtn);
    foot.appendChild(openBtn);
    foot.appendChild(sentBtn);
    var sent = draft.status === "sent_by_owner";
    if (sent) { saveBtn.disabled = approveBtn.disabled = sentBtn.disabled = true; bodyInput.readOnly = true; if (subjectInput) subjectInput.readOnly = true; }
    else if (draft.status === "approved") approveBtn.disabled = true;
    function show(msg, kind) { status.hidden = false; status.textContent = msg; status.className = kind === "error" ? "writing-error" : "writing-note"; }
    function values() {
      return {
        subject: subjectInput ? subjectInput.value : draft.subject,
        body: bodyInput.value,
        fromAddress: draft.channel === "gmail_outreach" ? (card.querySelector('[name="fromAddress"]').value || "") : "",
      };
    }
    saveBtn.addEventListener("click", function () {
      var v = values(), payload = { id: draft.id, body: v.body };
      if (draft.channel === "gmail_outreach") { payload.subject = v.subject; payload.fromAddress = v.fromAddress; }
      saveBtn.disabled = true;
      api("PATCH", "draft", payload).then(function (res) { Object.assign(draft, res.draft); show("Saved.", "ok"); refresh(); })
        .catch(function (err) { show(err.message || "Could not save.", "error"); })
        .finally(function () { saveBtn.disabled = sent; });
    });
    approveBtn.addEventListener("click", function () {
      approveBtn.disabled = true;
      api("POST", "approve", { id: draft.id }).then(function (res) { Object.assign(draft, res.draft); show("Approved. Copy or open, then mark sent.", "ok"); refresh(); })
        .catch(function (err) { show(err.message || "Could not approve.", "error"); approveBtn.disabled = false; });
    });
    copyBtn.addEventListener("click", function () {
      var text = values().body.trim(); if (!text) return;
      copyText(text).then(function () { show("Copied. You still send it yourself.", "ok"); }).catch(function () { show("Could not copy.", "error"); });
    });
    if (bookingBtn) {
      bookingBtn.addEventListener("click", function () {
        var url = String(state.bookingUrl || "").trim();
        if (!url) { show("Set your booking link under Drafts first.", "error"); return; }
        var cur = bodyInput.value || "";
        var gap = cur && !/\s$/.test(cur) ? "\n\n" : (cur ? "\n" : "");
        bodyInput.value = cur + gap + url;
        if (d.charLimit) {
          var counter = card.querySelector(".sidebar__drafts-counter");
          if (counter) {
            var n = bodyInput.value.length;
            counter.textContent = n + " / " + d.charLimit;
            counter.classList.toggle("sidebar__drafts-counter--over", n > d.charLimit);
          }
        }
        show("Booking link inserted. Save when it reads right.", "ok");
      });
    }
    openBtn.addEventListener("click", function () { openDestination(Object.assign({}, draft, values()), draft.lead); });
    sentBtn.addEventListener("click", function () {
      sentBtn.disabled = true;
      api("POST", "mark-sent", { id: draft.id }).then(function (res) {
        Object.assign(draft, res.draft); if (res.lead) draft.lead = res.lead;
        show("Marked sent. The lead is contacted.", "ok");
        bodyInput.readOnly = true; if (subjectInput) subjectInput.readOnly = true;
        saveBtn.disabled = approveBtn.disabled = true; refresh();
      }).catch(function (err) { show(err.message || "Could not mark sent.", "error"); sentBtn.disabled = false; });
    });
    overlay.appendChild(header); overlay.appendChild(body); overlay.appendChild(foot);
    stage.appendChild(overlay); bodyInput.focus();
  }
  function refresh() {
    if (!token()) { state.drafts = []; state.error = ""; if (root) root.hidden = true; renderSidebar(); return Promise.resolve(); }
    state.loading = true;
    var q = state.companyFilter ? { company: state.companyFilter } : {};
    return Promise.all([
      api("GET", "drafts", null, q),
      api("GET", "settings").catch(function () {
        return { settings: { defaultFromAddress: "", sendingEnabled: false } };
      }),
    ]).then(function (results) {
      state.drafts = Array.isArray(results[0].drafts) ? results[0].drafts : [];
      state.defaultFrom = (results[1].settings && results[1].settings.defaultFromAddress) || "";
      state.bookingUrl = (results[1].settings && results[1].settings.bookingUrl) || "";
      state.sendingEnabled = !!(results[1].settings && results[1].settings.sendingEnabled);
      var sending = root && root.querySelector("[data-drafts-sending]");
      if (sending) sending.checked = state.sendingEnabled;
      state.error = ""; if (root) root.hidden = false;
    }).catch(function (err) {
      state.drafts = [];
      if (err.status === 401 || err.status === 403) { state.error = ""; if (root) root.hidden = true; }
      else { state.error = "Drafts could not load right now."; if (root) root.hidden = false; }
    }).finally(function () { state.loading = false; renderSidebar(); });
  }
  function setCompanyFilter(name) { state.companyFilter = String(name || "").trim(); return refresh(); }
  function bindChrome() {
    if (!root) return;
    var toggle = root.querySelector("[data-drafts-toggle]");
    var panel = root.querySelector("[data-drafts-panel]");
    var chip = root.querySelector("[data-drafts-filter]");
    var fromInput = root.querySelector("[data-drafts-from]");
    var fromSave = root.querySelector("[data-drafts-from-save]");
    if (toggle && panel) {
      function sync() {
        var open = root.getAttribute("data-open") !== "false";
        panel.hidden = !open; toggle.setAttribute("aria-expanded", open ? "true" : "false");
      }
      toggle.addEventListener("click", function () {
        root.setAttribute("data-open", root.getAttribute("data-open") !== "false" ? "false" : "true"); sync();
      });
      root.setAttribute("data-open", window.matchMedia && window.matchMedia("(max-width: 540px)").matches ? "false" : "true");
      sync();
    }
    if (chip) chip.addEventListener("click", function () { setCompanyFilter(""); });
    if (fromSave && fromInput) {
      fromSave.addEventListener("click", function () {
        fromSave.disabled = true;
        api("POST", "settings", { defaultFromAddress: fromInput.value.trim() }).then(function (res) {
          state.defaultFrom = (res.settings && res.settings.defaultFromAddress) || "";
          if (res.settings && res.settings.bookingUrl != null) state.bookingUrl = res.settings.bookingUrl;
          renderSidebar();
        }).finally(function () { fromSave.disabled = false; });
      });
    }
    var bookingInput = root.querySelector("[data-drafts-booking]");
    var bookingSave = root.querySelector("[data-drafts-booking-save]");
    if (bookingSave && bookingInput && !bookingSave.getAttribute("data-bound")) {
      bookingSave.setAttribute("data-bound", "1");
      bookingInput.value = state.bookingUrl || "";
      bookingSave.addEventListener("click", function () {
        bookingSave.disabled = true;
        api("POST", "settings", { bookingUrl: bookingInput.value.trim() }).then(function (res) {
          state.bookingUrl = (res.settings && res.settings.bookingUrl) || "";
          bookingInput.value = state.bookingUrl || "";
          renderSidebar();
        }).finally(function () { bookingSave.disabled = false; });
      });
    }
    var sendingInput = root.querySelector("[data-drafts-sending]");
    if (sendingInput && !sendingInput.getAttribute("data-bound")) {
      sendingInput.setAttribute("data-bound", "1");
      sendingInput.checked = !!state.sendingEnabled;
      sendingInput.addEventListener("change", function () {
        var on = !!sendingInput.checked;
        sendingInput.disabled = true;
        api("POST", "settings", { sendingEnabled: on }).then(function (res) {
          state.sendingEnabled = !!(res.settings && res.settings.sendingEnabled);
          sendingInput.checked = state.sendingEnabled;
          try {
            document.dispatchEvent(new CustomEvent("tinker:sending-enabled", {
              detail: { sendingEnabled: state.sendingEnabled },
            }));
          } catch (e) { /* ignore */ }
          var status = root.querySelector("[data-settings-status]");
          if (status) {
            status.hidden = false;
            status.textContent = state.sendingEnabled
              ? "Sending on. Press Send on a Gmail draft to queue it."
              : "Sending off. Gmail Send stays blocked.";
          }
        }).catch(function () {
          sendingInput.checked = !!state.sendingEnabled;
        }).finally(function () { sendingInput.disabled = false; });
      });
    }
  }
  function boot() {
    // Settings page hosts outreach defaults; the inbox rail no longer does.
    root = document.getElementById("settings-outreach") || document.getElementById("sidebar-drafts");
    if (!root) return;
    if (!root.querySelector("[data-drafts-from]")) return;
    bindChrome(); refresh();
    window.addEventListener("storage", function (e) { if (e.key === TOKEN_KEY) refresh(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  }
  window.tinkerLeadDrafts = {
    refresh: refresh, openDraft: openDraft, close: closePanel, setCompanyFilter: setCompanyFilter,
    LINKEDIN_CONNECTION_NOTE_LIMIT: LINKEDIN_CONNECTION_NOTE_LIMIT, DESTINATIONS: DESTINATIONS,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
