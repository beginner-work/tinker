/* Lead/person chat: owner notes only. Outreach recipient/subject/body stay
 * data-only via MCP (save_outreach_draft / list_approved_outreach). Review
 * happens outside Tinker in the owner's assistant; never show a review
 * form, banner, or sendability prompts here. Keep crafting / This is
 * everything save notes on the lead and never approve outreach.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var CHANNELS = [
    { key: "linkedin_connection", label: "LinkedIn" },
    { key: "gmail_outreach", label: "Email" },
    { key: "linkedin_post", label: "LinkedIn post" },
  ];
  var state = {
    leadId: "",
    lead: null,
    company: null,
    touch: null,
    notes: "",
    saving: false,
  };
  var legacyRoot = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function api(path, method, action, body, query) {
    var q = new URLSearchParams(Object.assign({ action: action }, query || {}));
    var opts = {
      method: method,
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    };
    if (method !== "GET") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body || {});
    }
    return fetch(path + "?" + q.toString(), opts).then(function (res) {
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
  function notepad() {
    return window.tinkerMessagesNotepad || null;
  }
  function threadHost() {
    return document.querySelector("#messages-pane [data-messages-thread]");
  }
  function hideLegacyComposer() {
    legacyRoot = document.getElementById("messages-composer");
    if (legacyRoot) legacyRoot.hidden = true;
  }
  function companyForLead(lead) {
    if (!lead) return null;
    var shell = window.tinkerMessagesShell;
    if (shell && typeof shell.companyForLead === "function") return shell.companyForLead(lead);
    if (shell && typeof shell.getCompany === "function" && lead.companyId) {
      return shell.getCompany(lead.companyId);
    }
    return null;
  }
  function researchProse(company) {
    if (!company) return "";
    var research = String(company.research || "").trim();
    var notes = String(company.notes || "").trim();
    var text = research || notes;
    if (!text) return "";
    return text
      .replace(/\r\n/g, "\n")
      .split(/\n+/)
      .map(function (line) {
        return String(line || "").replace(/^\s*[-*•]\s*/, "").replace(/^\s*[A-Za-z][^:]{0,24}:\s*/, "").trim();
      })
      .filter(Boolean)
      .join(" ");
  }
  function contextLine(lead, company) {
    var person = String(lead && lead.personName || "").trim() || "someone";
    var co = String((company && company.name) || (lead && lead.company) || "").trim();
    if (co) return "Notes for " + person + " at " + co + ".";
    return "Notes for " + person + ".";
  }
  function promptQuestion(lead, company) {
    var person = String(lead && lead.personName || "").trim() || "them";
    var co = String((company && company.name) || (lead && lead.company) || "").trim();
    if (co) return "What do you want " + person + " at " + co + " to understand about you?";
    return "What do you want " + person + " to understand about you?";
  }
  function logoMark(company) {
    var wrap = el("span", "messages-notepad__mark", { "aria-hidden": "true" });
    var domain = String(company && company.domain || "").trim().toLowerCase().replace(/^www\./, "");
    if (!domain) { wrap.hidden = true; return wrap; }
    var img = el("img", "messages-notepad__mark-img", {
      src: "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(domain) + ".ico",
      alt: "",
      width: "18",
      height: "18",
    });
    img.addEventListener("error", function () { wrap.hidden = true; wrap.innerHTML = ""; });
    wrap.appendChild(img);
    return wrap;
  }
  function buildOpening(lead, company) {
    var opening = el("div", "messages-notepad__opening");
    var mark = logoMark(company);
    if (!mark.hidden) opening.appendChild(mark);
    var context = el("p", "messages-notepad__context");
    context.textContent = contextLine(lead, company);
    opening.appendChild(context);
    var research = researchProse(company);
    if (research) {
      var prose = el("p", "messages-notepad__research");
      prose.textContent = research;
      opening.appendChild(prose);
    }
    var q = el("h2", "messages-notepad__question");
    q.textContent = promptQuestion(lead, company);
    opening.appendChild(q);
    return opening;
  }
  function stripReviewUi(host) {
    if (!host) return;
    host.querySelectorAll(
      "[data-messages-review], .messages-review, [data-handoff-line], .messages-notepad__handoff"
    ).forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
  }
  function mountNotepad() {
    var np = notepad();
    var host = threadHost();
    if (!np || !host || !state.leadId || !state.lead) return;
    hideLegacyComposer();
    document.body.classList.add("messages-notepad-active");
    document.body.classList.remove("messages-you-active");
    host.hidden = false;
    host.setAttribute("data-thread-ready", "1");
    host.classList.add("messages-thread");
    stripReviewUi(host);
    np.mount(host, {
      primaryLabel: "This is everything",
      secondaryLabel: "Keep crafting",
      heading: "",
      value: state.notes,
      metaNode: buildOpening(state.lead, state.company),
      onInput: function (value) {
        state.notes = value;
        if (window.tinkerNotesFolder && state.lead) {
          window.tinkerNotesFolder.scheduleWrite({
            id: state.leadId,
            personName: state.lead.personName,
            companyName: (state.company && state.company.name) || state.lead.company || "",
            companyId: state.lead.companyId || (state.company && state.company.id) || "",
            body: value,
            updatedAt: new Date().toISOString(),
          });
        }
      },
      onPrimary: function () { saveNotes("done"); },
      onSecondary: function () { saveNotes("keep"); },
    });
    np.setPrimaryEnabled(true);
    setTimeout(function () { np.focus(); }, 60);
  }
  function unmountNotepad() {
    var np = notepad();
    if (np) np.unmount();
    stripReviewUi(threadHost());
    document.body.classList.remove("messages-notepad-active");
  }
  function saveNotes(mode) {
    if (state.saving || !state.leadId) return;
    state.saving = true;
    var np = notepad();
    if (np) np.setPrimaryEnabled(false);
    var notes = String(state.notes || "");
    api("/api/leads", "PATCH", "edit", { notes: notes }, { id: state.leadId }).then(function (res) {
      if (res && res.lead) {
        state.lead = res.lead;
        state.notes = res.lead.notes || notes;
      }
      if (window.tinkerMessagesThread && state.leadId) window.tinkerMessagesThread.loadLead(state.leadId);
      if (window.tinkerMessagesShell && window.tinkerMessagesShell.refresh) window.tinkerMessagesShell.refresh();
      if (window.tinkerLeadDrafts && window.tinkerLeadDrafts.refresh) window.tinkerLeadDrafts.refresh();
      if (window.tinkerNotesFolder && state.lead) {
        window.tinkerNotesFolder.scheduleWrite({
          id: state.leadId,
          personName: state.lead.personName,
          companyName: (state.company && state.company.name) || state.lead.company || "",
          companyId: state.lead.companyId || (state.company && state.company.id) || "",
          body: state.notes,
          updatedAt: new Date().toISOString(),
        });
      }
      mountNotepad();
      return mode;
    }).catch(function () {
      mountNotepad();
    }).finally(function () {
      state.saving = false;
      var n = notepad();
      if (n) n.setPrimaryEnabled(true);
    });
  }
  function setLead(leadId, lead, touch) {
    state.leadId = leadId || "";
    state.lead = lead || null;
    state.company = companyForLead(lead);
    state.touch = touch || null;
    state.notes = String(lead && lead.notes || "").trim();
    if (!leadId) {
      unmountNotepad();
      return;
    }
    mountNotepad();
  }
  function setYouMode(on) {
    if (on) {
      state.leadId = "";
      state.lead = null;
      state.company = null;
      state.touch = null;
      state.notes = "";
      unmountNotepad();
      hideLegacyComposer();
    }
  }
  function onSelect(e) {
    if (e && e.detail && e.detail.you) {
      setYouMode(true);
      return;
    }
    var id = e && e.detail && e.detail.leadId;
    var touch = e && e.detail && e.detail.touch;
    if (!id) { setYouMode(false); setLead("", null, null); return; }
    api("/api/leads", "GET", "lead", null, { id: id }).then(function (res) {
      var lead = res.lead || { id: id };
      setLead(id, lead, touch || null);
    }).catch(function () {
      setLead(id, { id: id }, touch || null);
    });
  }
  function boot() {
    hideLegacyComposer();
    window.addEventListener("tinker:messages-select", onSelect);
  }

  function applyImportedBody(leadId, body) {
    if (!leadId || leadId !== state.leadId) return;
    state.notes = body || "";
    if (state.lead) state.lead.notes = state.notes;
    mountNotepad();
  }

  window.tinkerMessagesComposer = {
    setLead: setLead,
    setYouMode: setYouMode,
    applyImportedBody: applyImportedBody,
    refreshParts: function () { return Promise.resolve(); },
    CHANNELS: CHANNELS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
