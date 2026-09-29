/* Lead/person chat: owner notes (notepad) stay separate from Clair's
 * composed outreach draft (review card). Keep crafting / This is everything
 * on the notepad save notes only and never approve. The review card shows
 * To, Subject, and Body; This is everything there approves only when the
 * message is sendable (email: recipient + subject + body; LinkedIn: profile
 * URL + body). Editing the card revokes approval.
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
    draftId: "",
    channel: "gmail_outreach",
    subject: "",
    body: "",
    to: "",
    defaultFrom: "",
    saving: false,
    reviewing: false,
    handedOff: false,
    statusLine: "",
  };
  var reviewRoot = null;
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
  function isEmailChannel(channel) {
    return String(channel || "") === "gmail_outreach";
  }
  function isLinkedInChannel(channel) {
    var c = String(channel || "");
    return c === "linkedin_connection" || c === "linkedin_post";
  }
  function recipientForState() {
    if (isEmailChannel(state.channel)) {
      return String(state.to || (state.lead && state.lead.email) || "").trim();
    }
    if (isLinkedInChannel(state.channel)) {
      return String(state.to || (state.lead && state.lead.linkedInUrl) || "").trim();
    }
    return String(state.to || "").trim();
  }
  function isSendable() {
    var body = String(state.body || "").trim();
    if (!body) return false;
    var to = recipientForState();
    if (isEmailChannel(state.channel)) {
      return !!(to && String(state.subject || "").trim());
    }
    if (isLinkedInChannel(state.channel)) return !!to;
    return false;
  }
  function sendableHint() {
    if (isEmailChannel(state.channel)) {
      return "Email needs a recipient, subject, and body before This is everything can approve.";
    }
    return "LinkedIn needs a profile URL and body before This is everything can approve.";
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
  function applyDraft(draft, lead) {
    if (!draft) {
      state.draftId = "";
      state.body = "";
      state.subject = "";
      state.to = "";
      state.statusLine = "";
      state.handedOff = false;
      state.reviewing = false;
      return;
    }
    state.draftId = draft.id;
    state.body = draft.body || "";
    state.subject = draft.subject || "";
    state.channel = draft.channel || state.channel;
    state.statusLine = draft.status || "draft";
    // Non-sendable approvals are treated as drafts in the UI (server heals them).
    var sendable = isSendableOutreachClient(draft, lead);
    state.handedOff = draft.status === "approved_to_send" && sendable;
    state.reviewing = true;
    if (isEmailChannel(state.channel)) state.to = String((lead && lead.email) || "").trim();
    else state.to = String((lead && lead.linkedInUrl) || "").trim();
  }
  function isSendableOutreachClient(draft, lead) {
    var body = String(draft && draft.body || "").trim();
    if (!body) return false;
    var channel = String(draft && draft.channel || "");
    if (channel === "gmail_outreach") {
      return !!(String((lead && lead.email) || "").trim() && String(draft.subject || "").trim());
    }
    if (channel === "linkedin_connection" || channel === "linkedin_post") {
      return !!String((lead && lead.linkedInUrl) || "").trim();
    }
    return false;
  }
  function ensureReview() {
    if (reviewRoot) return reviewRoot;
    reviewRoot = el("section", "messages-review", { "data-messages-review": "1", hidden: "" });
    var title = el("h3", "messages-review__title");
    title.textContent = "Review before handoff";
    var hint = el("p", "messages-review__hint", { "data-review-hint": "1" });
    var toLabel = el("label", "messages-review__label");
    toLabel.textContent = "To";
    var toInput = el("input", "messages-review__input", {
      type: "text",
      "data-review-to": "1",
      autocomplete: "off",
    });
    var subjWrap = el("div", "messages-review__field", { "data-review-subject-wrap": "1" });
    var subjLabel = el("label", "messages-review__label");
    subjLabel.textContent = "Subject";
    var subjInput = el("input", "messages-review__input", {
      type: "text",
      "data-review-subject": "1",
      autocomplete: "off",
    });
    subjWrap.appendChild(subjLabel);
    subjWrap.appendChild(subjInput);
    var bodyLabel = el("label", "messages-review__label");
    bodyLabel.textContent = "Body";
    var bodyInput = el("textarea", "messages-review__body", {
      "data-review-body": "1",
      rows: "8",
    });
    var foot = el("footer", "messages-review__foot");
    var primary = el("button", "messages-review__primary", {
      type: "button",
      "data-review-primary": "1",
    });
    primary.textContent = "This is everything";
    foot.appendChild(primary);
    reviewRoot.appendChild(title);
    reviewRoot.appendChild(hint);
    reviewRoot.appendChild(toLabel);
    reviewRoot.appendChild(toInput);
    reviewRoot.appendChild(subjWrap);
    reviewRoot.appendChild(bodyLabel);
    reviewRoot.appendChild(bodyInput);
    reviewRoot.appendChild(foot);

    function onEdit() {
      state.to = toInput.value;
      state.subject = subjInput.value;
      state.body = bodyInput.value;
      if (state.handedOff) {
        state.handedOff = false;
        revokeIfNeeded();
      }
      syncReviewEnabled();
    }
    toInput.addEventListener("input", onEdit);
    subjInput.addEventListener("input", onEdit);
    bodyInput.addEventListener("input", onEdit);
    primary.addEventListener("click", function () { approveReview(); });
    return reviewRoot;
  }
  function syncReviewEnabled() {
    var primary = reviewRoot && reviewRoot.querySelector("[data-review-primary]");
    var hint = reviewRoot && reviewRoot.querySelector("[data-review-hint]");
    var ok = isSendable();
    if (primary) {
      primary.disabled = !ok || state.saving || state.handedOff;
      primary.textContent = state.handedOff ? "Handed off" : "This is everything";
    }
    if (hint) {
      hint.hidden = ok || state.handedOff;
      hint.textContent = sendableHint();
    }
  }
  function mountReview(host) {
    if (!host || !state.draftId) {
      if (reviewRoot) reviewRoot.hidden = true;
      return;
    }
    ensureReview();
    if (reviewRoot.parentNode !== host) {
      if (reviewRoot.parentNode) reviewRoot.parentNode.removeChild(reviewRoot);
      host.insertBefore(reviewRoot, host.firstChild);
    }
    reviewRoot.hidden = false;
    var toInput = reviewRoot.querySelector("[data-review-to]");
    var subjInput = reviewRoot.querySelector("[data-review-subject]");
    var subjWrap = reviewRoot.querySelector("[data-review-subject-wrap]");
    var bodyInput = reviewRoot.querySelector("[data-review-body]");
    if (toInput && document.activeElement !== toInput) toInput.value = recipientForState();
    if (subjInput && document.activeElement !== subjInput) subjInput.value = state.subject || "";
    if (bodyInput && document.activeElement !== bodyInput) bodyInput.value = state.body || "";
    if (subjWrap) subjWrap.hidden = !isEmailChannel(state.channel);
    if (toInput) {
      toInput.setAttribute("aria-label", isEmailChannel(state.channel) ? "Recipient email" : "LinkedIn profile URL");
      toInput.placeholder = isEmailChannel(state.channel) ? "name@company.com" : "https://www.linkedin.com/in/…";
    }
    syncReviewEnabled();
  }
  function unmountReview() {
    if (!reviewRoot) return;
    reviewRoot.hidden = true;
    if (reviewRoot.parentNode) reviewRoot.parentNode.removeChild(reviewRoot);
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
      mountReview(host);
      showHandoff(host);
      return;
    }
    hideHandoff(host);
    mountReview(host);
    np.mount(host, {
      primaryLabel: "This is everything",
      secondaryLabel: "Keep crafting",
      heading: "",
      value: state.notes,
      metaNode: buildOpening(state.lead, state.company),
      onInput: function (value) {
        state.notes = value;
        // Debounced write into the local notes folder when one is chosen.
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
    unmountReview();
    document.body.classList.remove("messages-notepad-active");
    hideHandoff(threadHost());
  }
  function loadSettings() {
    return api("/api/leads", "GET", "settings").then(function (res) {
      state.defaultFrom = (res.settings && res.settings.defaultFromAddress) || "";
    }).catch(function () { /* ignore */ });
  }
  function revokeIfNeeded() {
    if (!state.draftId) return;
    if (state.statusLine !== "approved_to_send" && state.statusLine !== "approved" && state.statusLine !== "send_failed") return;
    var patch = {
      body: state.body,
      subject: isEmailChannel(state.channel) ? state.subject : undefined,
    };
    api("/api/leads", "PATCH", "draft", patch, { id: state.draftId }).then(function (res) {
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
      // Done with notes: surface the composed review card when Clair has one.
      if (mode === "done" && state.draftId) state.reviewing = true;
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
    }).catch(function () {
      mountNotepad();
    }).finally(function () {
      state.saving = false;
      var n = notepad();
      if (n) n.setPrimaryEnabled(true);
    });
  }
  function persistReviewFields() {
    if (!state.draftId) return Promise.resolve();
    var patch = { body: state.body };
    if (isEmailChannel(state.channel)) patch.subject = state.subject || "";
    var leadPatch = {};
    if (isEmailChannel(state.channel)) leadPatch.email = recipientForState();
    else if (isLinkedInChannel(state.channel)) leadPatch.linkedInUrl = recipientForState();
    return api("/api/leads", "PATCH", "draft", patch, { id: state.draftId }).then(function (res) {
      var d = res && res.draft;
      if (d) {
        state.draftId = d.id;
        state.statusLine = d.status || "draft";
        state.body = d.body || state.body;
        state.subject = d.subject || state.subject;
        state.handedOff = false;
      }
      if (Object.keys(leadPatch).length) {
        return api("/api/leads", "PATCH", "edit", leadPatch, { id: state.leadId }).then(function (out) {
          if (out && out.lead) {
            state.lead = out.lead;
            state.to = recipientForState();
          }
        });
      }
    });
  }
  function approveReview() {
    if (state.saving || !state.draftId) return;
    if (!isSendable()) {
      syncReviewEnabled();
      return;
    }
    state.saving = true;
    syncReviewEnabled();
    persistReviewFields().then(function () {
      return api("/api/leads", "POST", "approve", {}, { id: state.draftId });
    }).then(function (out) {
      var d = out && out.draft;
      state.draftId = d && d.id || state.draftId;
      state.statusLine = (d && d.status) || "approved_to_send";
      state.handedOff = true;
      state.body = (d && (d.approvedText || d.body)) || state.body;
      if (window.tinkerMessagesThread && state.leadId) window.tinkerMessagesThread.loadLead(state.leadId);
      if (window.tinkerMessagesShell && window.tinkerMessagesShell.refresh) window.tinkerMessagesShell.refresh();
      mountNotepad();
    }).catch(function (err) {
      state.handedOff = false;
      var hint = reviewRoot && reviewRoot.querySelector("[data-review-hint]");
      if (hint) {
        hint.hidden = false;
        hint.textContent = (err && err.message) || sendableHint();
      }
      mountNotepad();
    }).finally(function () {
      state.saving = false;
      syncReviewEnabled();
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
    api("/api/leads", "GET", "drafts").then(function (res) {
      var all = Array.isArray(res.drafts) ? res.drafts : [];
      var mine = all.filter(function (d) { return d && d.leadId === leadId; });
      applyDraft(pickOpenDraft(mine), lead);
      mountNotepad();
    }).catch(function () {
      applyDraft(null, lead);
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
      state.notes = "";
      state.handedOff = false;
      state.reviewing = false;
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
      state.notes = String(lead.notes || "").trim();
      if (Array.isArray(res.drafts) && res.drafts.length) {
        applyDraft(pickOpenDraft(res.drafts), lead);
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
    isSendable: isSendable,
    CHANNELS: CHANNELS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
