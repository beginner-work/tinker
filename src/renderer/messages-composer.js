/* Lead/person chat notepad (TYL-65).
 * Same invisible notepad as the owner thread: logo mark, italic context,
 * serif prompt, free text, floating Keep crafting / This is everything.
 * Channel, due date, and subject stay as MCP data - not UI.
 * This is everything → approved_to_send. Keep crafting → draft.
 * Owner You thread is handled by messages-you.js and left alone.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var CHANNELS = [
    { key: "linkedin_connection", label: "LinkedIn connection request" },
    { key: "gmail_outreach", label: "Gmail" },
    { key: "linkedin_post", label: "LinkedIn post" },
  ];
  var state = {
    leadId: "",
    lead: null,
    company: null,
    touch: null,
    draftId: "",
    channel: "gmail_outreach",
    subject: "",
    body: "",
    defaultFrom: "",
    saving: false,
    handedOff: false,
    statusLine: "",
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
    // Flatten any labeled lines into flowing prose without headings.
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
    if (co) return "Drafting for " + person + " at " + co + ".";
    return "Drafting for " + person + ".";
  }
  function promptQuestion(lead, company) {
    var person = String(lead && lead.personName || "").trim() || "them";
    var co = String((company && company.name) || (lead && lead.company) || "").trim();
    if (co) return "What do you want " + person + " at " + co + " to understand about you?";
    return "What do you want " + person + " to understand about you?";
  }
  function logoMark(company) {
    // Small Home-sized mark (18px). Never let the avatar img fill the pane.
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
  function showHandoff(host) {
    if (!host) return;
    var line = host.querySelector("[data-handoff-line]");
    if (!line) {
      line = el("p", "messages-notepad__handoff", { "data-handoff-line": "1" });
      host.appendChild(line);
    }
    line.hidden = false;
    line.textContent = "Handed off. Your assistant will send this.";
  }
  function hideHandoff(host) {
    var line = host && host.querySelector("[data-handoff-line]");
    if (line) line.hidden = true;
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

    if (state.handedOff) {
      np.unmount();
      showHandoff(host);
      return;
    }
    hideHandoff(host);
    np.mount(host, {
      primaryLabel: "This is everything",
      secondaryLabel: "Keep crafting",
      heading: "",
      value: state.body,
      metaNode: buildOpening(state.lead, state.company),
      onInput: function (value) {
        var prev = state.body;
        state.body = value;
        if (state.handedOff && value !== prev) {
          state.handedOff = false;
          revokeIfNeeded();
        }
        // Typing after approve revokes via PATCH when a draft exists.
        if (state.draftId && (state.statusLine === "approved_to_send" || state.statusLine === "approved")) {
          revokeIfNeeded();
        }
      },
      onPrimary: function () { saveDraft("ship"); },
      onSecondary: function () { saveDraft("next"); },
    });
    np.setPrimaryEnabled(!!String(state.body || "").trim() && !state.saving);
    setTimeout(function () { np.focus(); }, 60);
  }
  function unmountNotepad() {
    var np = notepad();
    if (np) np.unmount();
    document.body.classList.remove("messages-notepad-active");
    hideHandoff(threadHost());
  }
  function loadSettings() {
    return api("/api/leads", "GET", "settings").then(function (res) {
      state.defaultFrom = (res.settings && res.settings.defaultFromAddress) || "";
    }).catch(function () { /* ignore */ });
  }
  function pickOpenDraft(drafts) {
    var list = Array.isArray(drafts) ? drafts : [];
    var open = list.filter(function (d) {
      return d && (d.status === "draft" || d.status === "approved_to_send" || d.status === "approved" || d.status === "send_failed");
    });
    open.sort(function (a, b) {
      return String(b.updatedAt || "") < String(a.updatedAt || "") ? -1 : 1;
    });
    return open[0] || null;
  }
  function revokeIfNeeded() {
    if (!state.draftId) return;
    if (state.statusLine !== "approved_to_send" && state.statusLine !== "approved" && state.statusLine !== "send_failed") return;
    api("/api/leads", "PATCH", "draft", { body: state.body }, { id: state.draftId }).then(function (res) {
      var d = res && res.draft;
      if (d) {
        state.draftId = d.id;
        state.statusLine = d.status || "draft";
        state.handedOff = false;
        state.body = d.body || state.body;
      }
      mountNotepad();
    }).catch(function () { /* ignore */ });
  }
  function saveDraft(mode) {
    if (state.saving) return;
    var body = String(state.body || "").trim();
    if (!body) return;
    if (!state.leadId) return;
    state.saving = true;
    var np = notepad();
    if (np) np.setPrimaryEnabled(false);

    var payload = {
      channel: state.channel || "gmail_outreach",
      body: body,
      storyPartIds: [],
    };
    payload.leadId = state.leadId;
    if (payload.channel === "gmail_outreach") {
      payload.subject = state.subject || "";
      payload.fromAddress = state.defaultFrom || "";
    }

    var chain;
    if (state.draftId && (state.statusLine === "draft" || state.statusLine === "send_failed" || state.statusLine === "approved_to_send" || state.statusLine === "approved")) {
      chain = api("/api/leads", "PATCH", "draft", { body: body, subject: payload.subject }, { id: state.draftId }).then(function (res) {
        return { draft: res.draft };
      }).catch(function () {
        return api("/api/leads", "POST", "draft", payload);
      });
    } else {
      chain = api("/api/leads", "POST", "draft", payload);
    }

    chain.then(function (res) {
      var draft = res && res.draft;
      if (!draft || !draft.id) throw new Error("Could not save draft.");
      state.draftId = draft.id;
      state.statusLine = draft.status || "draft";
      state.body = draft.body || body;
      if (mode === "ship") {
        return api("/api/leads", "POST", "approve", {}, { id: draft.id }).then(function (out) {
          var d = out && out.draft;
          state.draftId = d && d.id || draft.id;
          state.statusLine = (d && d.status) || "approved_to_send";
          state.handedOff = true;
          state.body = (d && (d.approvedText || d.body)) || body;
        });
      }
      state.handedOff = false;
    }).then(function () {
      if (window.tinkerMessagesThread && state.leadId) window.tinkerMessagesThread.loadLead(state.leadId);
      if (window.tinkerMessagesShell && window.tinkerMessagesShell.refresh) window.tinkerMessagesShell.refresh();
      if (window.tinkerLeadDrafts && window.tinkerLeadDrafts.refresh) window.tinkerLeadDrafts.refresh();
      mountNotepad();
    }).catch(function () {
      state.handedOff = false;
      mountNotepad();
    }).finally(function () {
      state.saving = false;
      var n = notepad();
      if (n) n.setPrimaryEnabled(!!String(state.body || "").trim());
    });
  }
  function setLead(leadId, lead, touch) {
    state.leadId = leadId || "";
    state.lead = lead || null;
    state.company = companyForLead(lead);
    state.touch = touch || null;
    if (touch && touch.touch && touch.touch.touchType) {
      /* channel stays MCP-owned; keep last known */
    }
    if (!leadId) {
      unmountNotepad();
      return;
    }
    api("/api/leads", "GET", "drafts").then(function (res) {
      var all = Array.isArray(res.drafts) ? res.drafts : [];
      var mine = all.filter(function (d) { return d && d.leadId === leadId; });
      // Prefer nested drafts from lead fetch when available later.
      var open = pickOpenDraft(mine);
      if (open) {
        state.draftId = open.id;
        state.body = open.body || "";
        state.subject = open.subject || "";
        state.channel = open.channel || state.channel;
        state.statusLine = open.status || "draft";
        state.handedOff = open.status === "approved_to_send";
      } else {
        state.draftId = "";
        state.body = "";
        state.statusLine = "draft";
        state.handedOff = false;
      }
      mountNotepad();
    }).catch(function () {
      state.draftId = "";
      state.body = "";
      state.handedOff = false;
      mountNotepad();
    });
  }
  function setYouMode(on) {
    if (on) {
      state.leadId = "";
      state.lead = null;
      state.company = null;
      state.touch = null;
      state.draftId = "";
      state.body = "";
      state.handedOff = false;
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
      // Prefer drafts nested on the lead response when present.
      if (Array.isArray(res.drafts) && res.drafts.length) {
        var open = pickOpenDraft(res.drafts);
        state.draftId = open ? open.id : "";
        state.body = open ? (open.body || "") : "";
        state.subject = open ? (open.subject || "") : "";
        state.channel = open ? (open.channel || "gmail_outreach") : "gmail_outreach";
        state.statusLine = open ? (open.status || "draft") : "draft";
        state.handedOff = !!(open && open.status === "approved_to_send");
        state.leadId = id;
        state.lead = lead;
        state.company = companyForLead(lead);
        state.touch = touch || null;
        mountNotepad();
        return;
      }
      setLead(id, lead, touch || null);
    }).catch(function () {
      setLead(id, { id: id }, touch || null);
    });
  }
  function boot() {
    hideLegacyComposer();
    loadSettings();
    window.addEventListener("tinker:messages-select", onSelect);
  }

  window.tinkerMessagesComposer = {
    setLead: setLead,
    setYouMode: setYouMode,
    refreshParts: function () { return Promise.resolve(); },
    CHANNELS: CHANNELS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
