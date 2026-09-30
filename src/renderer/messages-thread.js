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
    referral_follow_up: "referral follow-up",
    recruiter_outreach: "recruiter note",
    hiring_leader_outreach: "eng leader note",
    eng_leader_note: "eng leader note",
    call_follow_up: "call follow-up",
  };
  var STATUS_LABEL = {
    draft: "Draft",
    approved: "Approved",
    approved_to_send: "Handed off",
    sent_by_owner: "Sent",
    send_failed: "Send failed",
  };
  var state = {
    lead: null,
    drafts: [],
    replies: [],
    touch: null,
    loading: false,
    error: "",
    mode: "lead",
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
  function api(action, query) {
    var url = "/api/leads?action=" + encodeURIComponent(action);
    if (query) {
      Object.keys(query).forEach(function (k) {
        if (query[k] != null && query[k] !== "") url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(query[k]);
      });
    }
    return fetch(url, {
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error((body && body.error) || "Request failed");
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }
  function channelLabel(ch) { return CHANNEL_LABEL[ch] || ch || ""; }
  // Viewer-local wall clock (no timeZone override) — PT browser → 3:57 PM
  // for 2026-09-29T22:57:00Z, not 10:57 PM UTC.
  function formatDay(iso) {
    if (!iso) return "";
    var s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      var parts = s.split("-").map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, {
        weekday: "short", month: "short", day: "numeric",
      });
    }
    try {
      var d = new Date(s);
      if (!Number.isFinite(d.getTime())) return "";
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) { return ""; }
  }
  function parseLoggedReplies(lead) {
    var notes = String(lead && lead.notes || "");
    var out = [];
    // Lightweight parse of logged inbound notes; optional.
    notes.split(/\n+/).forEach(function (line) {
      var m = line.match(/^\[reply\]\s*(.+)$/i);
      if (m) out.push({ side: "lead", kind: "reply", body: m[1], at: lead.updatedAt || lead.createdAt });
    });
    return out;
  }
  function isInboundDraft(d) {
    return !!(d && (d.fromLead || d.direction === "inbound" || d.isInboundDraft));
  }
  function collectItems() {
    var items = [];
    state.drafts.forEach(function (d) {
      if (!d) return;
      if (isInboundDraft(d)) {
        items.push({
          side: "lead",
          kind: "reply",
          body: d.body || "",
          at: d.updatedAt || d.createdAt,
          channel: d.channel,
          openable: false,
        });
        return;
      }
      // Sent outreach is UI-hidden (person drops from inbox). Keep data/MCP.
      if (d.status === "sent_by_owner" || d.status === "sent") return;
      var handed = d.status === "approved_to_send";
      // Skip open draft bubbles - writing lives in the invisible notepad.
      if (!handed && d.status !== "send_failed") return;
      items.push({
        side: "owner",
        kind: handed ? "handed" : "sent",
        channel: d.channel,
        subject: "",
        body: handed
          ? "Handed off. Your assistant will send this."
          : ("Send failed" + (d.sentAt ? ", " + formatDay(d.sentAt) : "")),
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
  function iconSvg(kind) {
    // Small muted brand marks for profile links.
    if (kind === "linkedin") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8.5h4V23h-4V8.5zM8.5 8.5h3.8v2h.05c.53-1 1.84-2.05 3.78-2.05 4.04 0 4.79 2.66 4.79 6.12V23h-4v-5.9c0-1.41-.03-3.22-1.96-3.22-1.96 0-2.26 1.53-2.26 3.12V23h-4V8.5z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z"/></svg>';
  }
  function renderProfileLinks(opts) {
    var host = pane && pane.querySelector("[data-messages-links]");
    if (!host) return;
    host.innerHTML = "";
    var linkedIn = String(opts && opts.linkedInUrl || "").trim();
    var github = String(opts && opts.githubUrl || "").trim();
    function addLink(href, kind, label) {
      if (!href) return;
      var a = el("a", "messages-pane__link messages-pane__link--" + kind, {
        href: href,
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": label,
        title: label,
      });
      a.innerHTML = iconSvg(kind);
      host.appendChild(a);
    }
    addLink(linkedIn, "linkedin", "LinkedIn");
    addLink(github, "github", "GitHub");
    host.hidden = !host.childNodes.length;
  }
  function clearProfileLinks() {
    var host = pane && pane.querySelector("[data-messages-links]");
    if (host) { host.hidden = true; host.innerHTML = ""; }
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
      role.textContent = line || "";
    }
    renderProfileLinks({
      linkedInUrl: lead.linkedInUrl,
      githubUrl: lead.githubUrl,
    });
    // No initials circles in the chat header. Company logo only when it resolves.
    if (avatar) {
      avatar.hidden = true;
      avatar.innerHTML = "";
      avatar.classList.remove("messages-avatar--photo", "messages-avatar--brand");
      var company = window.tinkerMessagesShell && typeof window.tinkerMessagesShell.companyForLead === "function"
        ? window.tinkerMessagesShell.companyForLead(lead)
        : null;
      if (company && window.tinkerMessagesShell && typeof window.tinkerMessagesShell.fillCompanyLogo === "function") {
        window.tinkerMessagesShell.fillCompanyLogo(avatar, company, {
          hideOnFail: true,
          eager: true,
          onReady: function (ok) { avatar.hidden = !ok; },
        });
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
    if (item.subject) {
      var subj = el("div", "messages-thread__subject");
      subj.textContent = item.subject;
      bubble.appendChild(subj);
    }
    var body = el("div", "messages-thread__body");
    body.textContent = item.body || "";
    bubble.appendChild(body);
    var meta = el("div", "messages-thread__meta");
    meta.textContent = metaLine([
      STATUS_LABEL[item.status] || (item.kind === "reply" ? "Reply" : ""),
      channelLabel(item.channel),
      formatDay(item.at),
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
    if (state.mode === "you") return;
    if (empty) empty.hidden = true;
    thread.hidden = false;
    thread.setAttribute("data-thread-ready", "1");
    // Only the owner's writing and quiet sent/handed-off lines - no planning bubbles.
    var existingNotepad = thread.querySelector("[data-messages-notepad]");
    thread.innerHTML = "";
    if (existingNotepad) thread.appendChild(existingNotepad);
    if (state.error) {
      thread.appendChild(Object.assign(el("p", "messages-thread__error"), { textContent: state.error }));
      return;
    }
    // Never flash Loading… over an already-mounted notepad (composer may
    // have hydrated the lead while the thread fetch is still in flight).
    if (state.loading && !state.lead && !existingNotepad) {
      thread.appendChild(Object.assign(el("p", "messages-thread__empty"), { textContent: "Loading…" }));
      return;
    }
    if (state.loading && !state.lead && existingNotepad) return;
    var items = collectItems();
    if (!items.length) return;
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
    clearProfileLinks();
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
      state.lead = null;
      state.drafts = [];
      state.replies = [];
      // Drop person header links so they do not linger on the owner thread.
      clearProfileLinks();
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
    clearProfileLinks: clearProfileLinks,
    renderProfileLinks: renderProfileLinks,
    CHANNEL_LABEL: CHANNEL_LABEL,
    REPLY_STAGES: REPLY_STAGES,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
