/* Messaging thread (TYL-65/66): chat bubbles per lead.
 * Owner sent → solid right; drafts → lighter right; queued Gmail → dashed;
 * lead replies → left. Meta under each bubble. Gmail Send queues for your
 * assistant. LinkedIn stays draft only.
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
    hiring_leader_outreach: "eng leader note",
    recruiter_outreach: "recruiter note",
    referral_follow_up: "follow-up",
    call_follow_up: "follow-up",
  };
  var STATUS_LABEL = {
    draft: "Draft",
    approved: "Ready",
    queued_to_send: "Queued",
    sent_by_owner: "Sent",
    send_failed: "Failed",
  };
  var state = {
    lead: null, drafts: [], replies: [], touch: null, loading: false, error: "", mode: "lead",
    sendingEnabled: false, confirmId: "",
  };
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
  function api(action, query, method, body) {
    var q = new URLSearchParams(Object.assign({ action: action }, query || {}));
    var opts = {
      method: method || "GET",
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    };
    if (method && method !== "GET") {
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
      var kind = "draft";
      if (d.status === "sent_by_owner") kind = "sent";
      else if (d.status === "queued_to_send") kind = "queued";
      else if (d.status === "send_failed") kind = "failed";
      var body = String(d.body || "").trim();
      var subject = d.subject || "";
      if (kind === "queued" || kind === "failed") {
        if (d.queuedBody != null && d.queuedBody !== "") body = String(d.queuedBody).trim();
        if (d.queuedSubject != null && d.queuedSubject !== "") subject = d.queuedSubject;
      }
      items.push({
        id: d.id,
        side: "owner",
        kind: kind,
        channel: d.channel,
        subject: subject,
        body: body,
        at: d.queuedAt || d.updatedAt || d.createdAt,
        status: d.status,
        openable: kind === "draft" || kind === "failed",
        draftId: d.id,
        sendable: d.channel === "gmail_outreach" && (d.status === "draft" || d.status === "approved" || d.status === "send_failed"),
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
  function renderHeader() {
    if (!pane || !state.lead) return;
    var nameEl = pane.querySelector("[data-messages-name]");
    var role = pane.querySelector("[data-messages-role]");
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
  }
  function openDraft(id) {
    if (window.tinkerLeadDrafts && typeof window.tinkerLeadDrafts.openDraft === "function") {
      window.tinkerLeadDrafts.openDraft(id);
    }
  }
  function refreshSendingFlag() {
    if (window.tinkerLeadDrafts && typeof window.tinkerLeadDrafts.isSendingEnabled === "function") {
      state.sendingEnabled = !!window.tinkerLeadDrafts.isSendingEnabled();
      return Promise.resolve(state.sendingEnabled);
    }
    return api("settings").then(function (res) {
      state.sendingEnabled = !!(res.settings && res.settings.sendingEnabled);
      return state.sendingEnabled;
    }).catch(function () {
      state.sendingEnabled = false;
    });
  }
  function queueSend(draftId) {
    return api("queue-send", { id: draftId }, "POST", {}).then(function () {
      state.confirmId = "";
      return loadLead(state.lead && state.lead.id);
    });
  }
  function renderSendControls(item, li) {
    if (!item.sendable || !item.draftId) return;
    var wrap = el("div", "messages-thread__send");
    if (state.confirmId === item.draftId) {
      var confirm = el("div", "messages-thread__confirm");
      confirm.appendChild(Object.assign(el("p", "messages-thread__send-note"), {
        textContent: "Queue for your assistant to send through Gmail?",
      }));
      var yes = el("button", "messages-thread__send-btn", { type: "button" });
      yes.textContent = "Confirm send";
      yes.addEventListener("click", function () {
        queueSend(item.draftId).catch(function (err) {
          state.error = (err && err.message) || "Could not queue send.";
          state.confirmId = "";
          renderThread();
        });
      });
      var no = el("button", "messages-thread__send-btn", { type: "button" });
      no.textContent = "Cancel";
      no.addEventListener("click", function () {
        state.confirmId = "";
        renderThread();
      });
      confirm.appendChild(yes);
      confirm.appendChild(no);
      wrap.appendChild(confirm);
    } else {
      var btn = el("button", "messages-thread__send-btn", { type: "button" });
      btn.textContent = "Send";
      if (!state.sendingEnabled) {
        btn.disabled = true;
        wrap.appendChild(Object.assign(el("p", "messages-thread__send-note"), {
          textContent: "Sending is off. Turn on Sending enabled under Outreach.",
        }));
      }
      btn.addEventListener("click", function () {
        state.confirmId = item.draftId;
        renderThread();
      });
      wrap.appendChild(btn);
    }
    li.appendChild(wrap);
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
    else if (item.kind === "queued") statusBit = "Queued";
    else if (item.kind === "failed") statusBit = "Failed";
    var meta = el("div", "messages-thread__meta");
    meta.textContent = grouped
      ? formatWhen(item.at)
      : metaLine([statusBit, channelLabel(item.channel), formatWhen(item.at)]);
    bubble.appendChild(meta);

    li.appendChild(bubble);
    if (item.kind === "draft" || item.kind === "failed") renderSendControls(item, li);
    return li;
  }
  function renderScheduledBubble(entry) {
    var touch = entry.touch;
    var li = el("li", "messages-thread__item messages-thread__item--owner messages-thread__item--scheduled");
    var bubble = el("div", "messages-thread__bubble messages-thread__bubble--scheduled");
    var draft = null;
    if (touch.draftId) {
      for (var i = 0; i < state.drafts.length; i++) {
        if (state.drafts[i] && state.drafts[i].id === touch.draftId) { draft = state.drafts[i]; break; }
      }
    }
    var body = el("div", "messages-thread__body");
    body.textContent = draft && draft.body
      ? String(draft.body).replace(/\s+/g, " ").trim().slice(0, 180)
      : ("Next " + (TOUCH_LABEL[touch.touchType] || "touch") + " planned. Write the draft below.");
    bubble.appendChild(body);
    var meta = el("div", "messages-thread__meta");
    meta.textContent = metaLine([
      "Scheduled",
      TOUCH_LABEL[touch.touchType] || String(touch.touchType || "").replace(/_/g, " "),
      draft && draft.channel ? channelLabel(draft.channel) : "",
      formatDay(touch.date),
    ]);
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
    if (!items.length && !(state.touch && state.touch.touch)) {
      thread.appendChild(Object.assign(el("p", "messages-thread__empty"), {
        textContent: "No messages yet for this person. Write a draft below. Your assistant sends Gmail after you press Send.",
      }));
      return;
    }
    var prevKey = "";
    items.forEach(function (item) {
      var key = groupKey(item);
      var grouped = key === prevKey;
      list.appendChild(renderBubble(item, grouped));
      prevKey = key;
    });
    if (state.touch && state.touch.touch) {
      list.appendChild(renderScheduledBubble(state.touch));
    }
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
    state.confirmId = "";
    if (!pane) return;
    var nameEl = pane.querySelector("[data-messages-name]");
    var role = pane.querySelector("[data-messages-role]");
    var empty = pane.querySelector("[data-messages-empty]");
    var thread = pane.querySelector("[data-messages-thread]");
    if (nameEl) nameEl.textContent = "Messages";
    if (role) { role.hidden = true; role.textContent = ""; }
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
      refreshSendingFlag(),
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
    window.addEventListener("tinker:sending-enabled", function (e) {
      state.sendingEnabled = !!(e && e.detail && e.detail.sendingEnabled);
      if (state.lead) renderThread();
    });
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
