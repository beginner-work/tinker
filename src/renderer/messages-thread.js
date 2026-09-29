/* Messaging thread (TYL-65): chat bubbles per lead.
 * Owner sent → solid right; saved drafts → lighter right with Draft label;
 * lead replies (when present in data) → left. Channel + time on each bubble.
 * Composer stays Save draft only. Tinker never sends.
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
  var state = { lead: null, drafts: [], replies: [], loading: false, error: "" };
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
    /* Convention: lines/blocks starting with "Reply:" (optional channel) are logged replies. */
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
      items.push({
        id: d.id,
        side: "owner",
        kind: sent ? "sent" : "draft",
        channel: d.channel,
        subject: d.subject || "",
        body: String(d.body || "").trim(),
        at: d.updatedAt || d.createdAt,
        status: d.status,
        openable: true,
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
  function renderHeader() {
    if (!pane || !state.lead) return;
    var title = pane.querySelector(".messages-pane__title");
    var sub = pane.querySelector(".messages-pane__sub");
    var lead = state.lead;
    var name = String(lead.personName || "").trim() || "Someone";
    if (title) title.textContent = name;
    if (sub) {
      var bits = [];
      if (lead.personTitle) bits.push(String(lead.personTitle).trim());
      if (lead.company) bits.push(String(lead.company).trim());
      if (lead.contactType) bits.push(String(lead.contactType).replace(/_/g, " "));
      if (lead.stage) bits.push("Stage: " + lead.stage);
      bits.push("You save drafts here — Tinker never sends.");
      sub.textContent = bits.join(" · ");
    }
  }
  function openDraft(id) {
    if (window.tinkerLeadDrafts && typeof window.tinkerLeadDrafts.openDraft === "function") {
      window.tinkerLeadDrafts.openDraft(id);
    }
  }
  function renderBubble(item, grouped) {
    var li = el("li", "messages-thread__item messages-thread__item--" + item.side + " messages-thread__item--" + item.kind + (grouped ? " messages-thread__item--grouped" : ""));
    var meta = el("div", "messages-thread__meta");
    if (item.kind === "draft") {
      var draftTag = el("span", "messages-thread__draft-tag");
      draftTag.textContent = "Draft";
      meta.appendChild(draftTag);
    }
    var channel = el("span", "messages-thread__channel");
    channel.textContent = channelLabel(item.channel);
    meta.appendChild(channel);
    var when = el("span", "messages-thread__when");
    when.textContent = formatWhen(item.at);
    meta.appendChild(when);

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

    if (!grouped) li.appendChild(meta);
    else {
      /* Grouped: keep a slim time under the bubble for the last of a run via CSS; still attach meta visually compact */
      var slim = el("div", "messages-thread__meta messages-thread__meta--slim");
      slim.appendChild(when.cloneNode(true));
      li.appendChild(bubble);
      li.appendChild(slim);
      return li;
    }
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
    if (!items.length) {
      thread.appendChild(Object.assign(el("p", "messages-thread__empty"), {
        textContent: "No messages yet for this person. Save a draft below — your assistant can pull it. Tinker never sends.",
      }));
      return;
    }

    var list = el("ol", "messages-thread__list", { "aria-label": "Conversation" });
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
    state.error = "";
    if (!pane) return;
    var title = pane.querySelector(".messages-pane__title");
    var sub = pane.querySelector(".messages-pane__sub");
    var empty = pane.querySelector("[data-messages-empty]");
    var thread = pane.querySelector("[data-messages-thread]");
    if (title) title.textContent = "Messages";
    if (sub) sub.textContent = "Pick someone on the left. You save drafts here — Tinker never sends.";
    if (empty) empty.hidden = false;
    if (thread) {
      thread.hidden = true;
      thread.removeAttribute("data-thread-ready");
      thread.innerHTML = "";
    }
  }
  function loadLead(leadId) {
    if (!leadId || !token()) { clearThread(); return Promise.resolve(); }
    state.loading = true;
    state.error = "";
    renderThread();
    return Promise.all([
      api("lead", { id: leadId }),
      api("drafts"),
    ]).then(function (results) {
      state.lead = results[0].lead || null;
      var all = Array.isArray(results[1].drafts) ? results[1].drafts : [];
      /* Prefer drafts nested on the lead payload when present. */
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
