/* Messaging thread (TYL-65): chat bubbles per lead.
 * Owner sent → solid right; saved drafts → lighter right with Draft label;
 * lead replies (when present in data) → left. Meta (status, channel, date)
 * sits as one small line under each bubble body.
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
  var REPLY_STAGES = { replied: 1, call: 1, interview: 1, offer: 1 };
  var TOUCH_LABEL = {
    application: "application",
    referral_outreach: "referral intro",
    hiring_leader_outreach: "eng leader note",
    recruiter_outreach: "recruiter note",
    referral_follow_up: "follow-up",
    call_follow_up: "follow-up",
  };
  var STATUS_LABEL = {
    draft: "Draft",
    approved: "Ready",
    sent_by_owner: "Sent",
  };
  var state = { lead: null, drafts: [], replies: [], touch: null, loading: false, error: "", mode: "lead" };
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
  function channelLabel(ch) {
    return CHANNEL_LABEL[ch] || String(ch || "Message");
  }
  function formatWhen(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    try {
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return d.toISOString().slice(0, 16).replace("T", " ");
    }
  }
  function formatDay(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    try {
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    } catch (e) {
      return d.toDateString();
    }
  }
  function isInboundDraft(d) {
    if (!d) return false;
    if (d.direction === "inbound" || d.fromLead === true || d.side === "lead") return true;
    if (d.role === "lead" || d.source === "lead_reply") return true;
    return false;
  }
  function parseLoggedReplies(lead) {
    if (!lead) return [];
    var out = [];
    var notes = String(lead.notes || "").trim();
    if (notes) {
      var blocks = notes.split(/\n{2,}/);
      blocks.forEach(function (block, i) {
        var m = block.match(/^\s*Reply(?:\s*\(([^)]+)\))?\s*:\s*([\s\S]+)$/i);
        if (!m) return;
        var chRaw = String(m[1] || "").trim().toLowerCase();
        var channel = "gmail_outreach";
        if (/linkedin\s*dm|linkedin\s*message/.test(chRaw)) channel = "linkedin_message";
        else if (/connection/.test(chRaw)) channel = "linkedin_connection";
        else if (/gmail|email/.test(chRaw)) channel = "gmail_outreach";
        else if (chRaw && CHANNEL_LABEL[chRaw]) channel = chRaw;
        out.push({
          id: "reply-notes-" + lead.id + "-" + i,
          side: "lead",
          kind: "reply",
          channel: channel,
          subject: "",
          body: String(m[2] || "").trim(),
          at: lead.updatedAt || lead.createdAt,
          openable: false,
        });
      });
    }
    if (!out.length && lead.lastReply && (lead.lastReply.body || lead.lastReply.text)) {
      var lr = lead.lastReply;
      out.push({
        id: "reply-last-" + lead.id,
        side: "lead",
        kind: "reply",
        channel: lr.channel || "gmail_outreach",
        subject: lr.subject || "",
        body: String(lr.body || lr.text || "").trim(),
        at: lr.at || lr.updatedAt || lead.updatedAt,
        openable: false,
      });
    }
    if (!out.length && Array.isArray(lead.replies)) {
      lead.replies.forEach(function (r, i) {
        if (!r) return;
        out.push({
          id: "reply-" + (r.id || i),
          side: "lead",
          kind: "reply",
          channel: r.channel || "gmail_outreach",
          subject: r.subject || "",
          body: String(r.body || r.text || "").trim(),
          at: r.at || r.updatedAt || r.createdAt || lead.updatedAt,
          openable: false,
        });
      });
    }
    return out.filter(function (r) { return r.body; });
  }
  function buildItems() {
    var items = [];
    state.drafts.forEach(function (d) {
      if (!d) return;
      if (isInboundDraft(d)) {
        items.push({
          id: d.id,
          side: "lead",
          kind: "reply",
          channel: d.channel,
          subject: d.subject || "",
          body: String(d.body || "").trim(),
          at: d.updatedAt || d.createdAt,
          openable: false,
        });
        return;
      }
      var sent = d.status === "sent_by_owner";
      var handed = d.status === "approved_to_send";
      // Skip open draft bubbles - writing lives in the invisible notepad.
      // Keep quiet handed-off and sent lines only.
      if (!sent && !handed) return;
      items.push({
        id: d.id,
        side: "owner",
        kind: sent ? "sent" : "handed",
        channel: d.channel,
        subject: "",
        body: sent
          ? ("Sent via " + channelLabel(d.channel) + (d.sentAt ? ", " + formatDay(d.sentAt) : ""))
          : "Handed off. Your assistant will send this.",
        at: d.sentAt || d.approvedAt || d.updatedAt || d.createdAt,
        status: d.status,
        openable: false,
        draftId: d.id,
      });
    });
    state.replies.forEach(function (r) { items.push(r); });
    items.sort(function (a, b) {
      return String(a.at || "") < String(b.at || "") ? -1 : 1;
    });
    return items;
  }
  function groupKey(item) {
    return item.side + ":" + item.kind + ":" + (item.channel || "");
  }
  function metaLine(parts) {
    return parts.filter(Boolean).join(" · ");
  }
  function renderProfileLinks(lead) {
    var host = pane && pane.querySelector("[data-messages-links]");
    if (!host) return;
    host.innerHTML = "";
    var linkedIn = String(lead && lead.linkedInUrl || "").trim();
    var github = String(lead && lead.githubUrl || "").trim();
    function addLink(href, label) {
      if (!href) return;
      var a = el("a", "messages-pane__link", {
        href: href,
        target: "_blank",
        rel: "noopener noreferrer",
      });
      a.textContent = label;
      host.appendChild(a);
    }
    addLink(linkedIn, "LinkedIn");
    addLink(github, "GitHub");
    host.hidden = !host.childNodes.length;
  }
  function renderHeader() {
    if (!pane || !state.lead) return;
    var nameEl = pane.querySelector("[data-messages-name]");
    var role = pane.querySelector("[data-messages-role]");
    var avatar = pane.querySelector("[data-messages-avatar]");
    var lead = state.lead;
    var name = String(lead.personName || "").trim() || "Someone";
    if (nameEl) nameEl.textContent = name;
    if (role) {
      var bits = [];
      if (lead.personTitle) bits.push(String(lead.personTitle).trim());
      if (lead.company) bits.push("at " + String(lead.company).trim());
      var line = bits.join(" ");
      role.hidden = !line;
      role.textContent = line ? " · " + line : "";
    }
    renderProfileLinks(lead);
    // No initials circles in the chat header. Company logo only when it resolves.
    if (avatar) {
      avatar.hidden = true;
      avatar.innerHTML = "";
      avatar.classList.remove("messages-avatar--photo", "messages-avatar--brand");
      var company = window.tinkerMessagesShell && typeof window.tinkerMessagesShell.companyForLead === "function"
        ? window.tinkerMessagesShell.companyForLead(lead)
        : null;
      if (company && window.tinkerMessagesShell && typeof window.tinkerMessagesShell.fillCompanyLogo === "function") {
        window.tinkerMessagesShell.fillCompanyLogo(avatar, company, { hideOnFail: true, onReady: function (ok) {
          avatar.hidden = !ok;
        } });
      }
    }
  }
  function openDraft(id) {
    if (window.tinkerLeadDrafts && typeof window.tinkerLeadDrafts.openDraft === "function") {
      window.tinkerLeadDrafts.openDraft(id);
    }
  }
  function renderBubble(item, grouped) {
    var li = el("li", "messages-thread__item messages-thread__item--" + item.side + " messages-thread__item--" + item.kind + (grouped ? " messages-thread__item--grouped" : ""));
    var bubble;
    if (item.openable && item.draftId) {
      bubble = el("button", "messages-thread__bubble", { type: "button", title: item.kind === "draft" ? "Open draft" : "Open message" });
      bubble.addEventListener("click", function () { openDraft(item.draftId); });
    } else {
      bubble = el("div", "messages-thread__bubble");
    }
    if (item.channel === "gmail_outreach" && item.subject) {
      var subj = el("div", "messages-thread__subject");
      subj.textContent = item.subject;
      bubble.appendChild(subj);
    }
    var body = el("div", "messages-thread__body");
    body.textContent = item.body || (item.kind === "draft" ? "(empty draft)" : "");
    bubble.appendChild(body);

    var statusBit = "";
    if (item.kind === "draft") statusBit = STATUS_LABEL[item.status] || "Draft";
    else if (item.kind === "sent") statusBit = "Sent";
    var meta = el("div", "messages-thread__meta");
    meta.textContent = grouped
      ? formatWhen(item.at)
      : metaLine([statusBit, channelLabel(item.channel), formatWhen(item.at)]);
    bubble.appendChild(meta);

    li.appendChild(bubble);
    return li;
  }
  function renderThread() {
    if (!pane) return;
    var empty = pane.querySelector("[data-messages-empty]");
    var thread = pane.querySelector("[data-messages-thread]");
    if (!thread) return;
    thread.setAttribute("data-thread-ready", "1");
    thread.classList.add("messages-thread");
    if (empty) empty.hidden = true;
    thread.hidden = false;
    thread.innerHTML = "";

    if (state.error) {
      thread.appendChild(Object.assign(el("p", "messages-thread__error"), { textContent: state.error }));
      return;
    }
    if (state.loading) {
      thread.appendChild(Object.assign(el("p", "messages-thread__empty"), { textContent: "Loading…" }));
      return;
    }

    var items = buildItems();
    var list = el("ol", "messages-thread__list", { "aria-label": "Conversation" });
    // Only the owner's writing and quiet sent/handed-off lines - no planning bubbles.
    if (!items.length) {
      thread.appendChild(list);
      return;
    }
    var prevKey = "";
    items.forEach(function (item) {
      var key = groupKey(item);
      var grouped = key === prevKey;
      list.appendChild(renderBubble(item, grouped));
      prevKey = key;
    });
    thread.appendChild(list);
    try { thread.scrollTop = thread.scrollHeight; } catch (e) { /* ignore */ }
  }
  function clearThread() {
    state.lead = null;
    state.drafts = [];
    state.replies = [];
    state.touch = null;
    state.error = "";
    state.mode = "lead";
    if (!pane) return;
    var nameEl = pane.querySelector("[data-messages-name]");
    var role = pane.querySelector("[data-messages-role]");
    var empty = pane.querySelector("[data-messages-empty]");
    var thread = pane.querySelector("[data-messages-thread]");
    if (nameEl) nameEl.textContent = "Messages";
    if (role) { role.hidden = true; role.textContent = ""; }
    var links = pane.querySelector("[data-messages-links]");
    if (links) { links.hidden = true; links.innerHTML = ""; }
    if (empty) empty.hidden = false;
    if (thread) {
      thread.hidden = true;
      thread.removeAttribute("data-thread-ready");
      thread.innerHTML = "";
    }
  }
  function loadLead(leadId) {
    if (!leadId || !token()) { clearThread(); return Promise.resolve(); }
    state.mode = "lead";
    state.loading = true;
    state.error = "";
    state.touch = (window.tinkerMessagesShell && window.tinkerMessagesShell.touchForLead)
      ? window.tinkerMessagesShell.touchForLead(leadId)
      : null;
    renderThread();
    return Promise.all([
      api("lead", { id: leadId }),
      api("drafts"),
      fetch("/api/schedule?action=inbox", {
        headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
      }).then(function (res) { return res.ok ? res.json() : { byLeadId: {} }; }).catch(function () { return { byLeadId: {} }; }),
    ]).then(function (results) {
      state.lead = results[0].lead || null;
      var all = Array.isArray(results[1].drafts) ? results[1].drafts : [];
      if (results[2] && results[2].byLeadId && results[2].byLeadId[leadId]) {
        state.touch = results[2].byLeadId[leadId];
      }
      var nested = results[0].drafts;
      if (Array.isArray(nested) && nested.length) {
        state.drafts = nested.filter(function (d) { return d; });
      } else {
        state.drafts = all.filter(function (d) { return d && d.leadId === leadId; });
      }
      state.replies = parseLoggedReplies(state.lead);
      if (!state.lead) state.error = "That conversation could not be found.";
    }).catch(function (err) {
      state.lead = null;
      state.drafts = [];
      state.replies = [];
      if (err.status === 401 || err.status === 403) state.error = "";
      else state.error = "Thread could not load right now.";
    }).finally(function () {
      state.loading = false;
      if (state.lead) { renderHeader(); renderThread(); }
      else if (state.error) renderThread();
      else clearThread();
    });
  }
  function onSelect(e) {
    if (e && e.detail && e.detail.you) {
      state.mode = "you";
      // Drop person header links so they do not linger on the owner thread.
      var links = pane && pane.querySelector("[data-messages-links]");
      if (links) { links.hidden = true; links.innerHTML = ""; }
      state.lead = null;
      return;
    }
    var id = e && e.detail && e.detail.leadId;
    if (!id) { clearThread(); return; }
    loadLead(id);
  }
  function boot() {
    pane = document.getElementById("messages-pane");
    if (!pane) return;
    window.addEventListener("tinker:messages-select", onSelect);
  }

  window.tinkerMessagesThread = {
    loadLead: loadLead,
    clear: clearThread,
    CHANNEL_LABEL: CHANNEL_LABEL,
    REPLY_STAGES: REPLY_STAGES,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
