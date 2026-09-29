/* Messaging thread view (TYL-65 slice 2). One thread per lead: drafts and
 * touch status in time order, each message tagged with its channel.
 * Listens for tinker:messages-select from messages-shell.js.
 * Reuses draft store/channels from TYL-63. Tinker never sends.
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
  var STATUS_LABEL = {
    draft: "Drafted",
    approved: "Ready — pull via your assistant",
    sent_by_owner: "Marked sent",
  };
  var state = { lead: null, drafts: [], loading: false, error: "" };
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
  function statusLabel(st) {
    return STATUS_LABEL[st] || String(st || "");
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
  function sortedDrafts() {
    return state.drafts.slice().sort(function (a, b) {
      return String(a.createdAt || a.updatedAt || "") < String(b.createdAt || b.updatedAt || "") ? -1 : 1;
    });
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
  function renderThread() {
    if (!pane) return;
    var empty = pane.querySelector("[data-messages-empty]");
    var thread = pane.querySelector("[data-messages-thread]");
    if (!thread) return;
    thread.setAttribute("data-thread-ready", "1");
    if (empty) empty.hidden = true;
    thread.hidden = false;
    thread.innerHTML = "";

    if (state.error) {
      var err = el("p", "messages-thread__error");
      err.textContent = state.error;
      thread.appendChild(err);
      return;
    }
    if (state.loading) {
      thread.appendChild(Object.assign(el("p", "messages-thread__empty"), { textContent: "Loading…" }));
      return;
    }

    var items = sortedDrafts();
    if (!items.length) {
      var none = el("p", "messages-thread__empty");
      none.textContent = "No drafts yet for this person. Compose one below once the composer lands — for now open Drafts in the sidebar.";
      thread.appendChild(none);
      return;
    }

    var list = el("ol", "messages-thread__list");
    items.forEach(function (draft) {
      var li = el("li", "messages-thread__item messages-thread__item--" + (draft.status || "draft"));
      var meta = el("div", "messages-thread__meta");
      var channel = el("span", "messages-thread__channel");
      channel.textContent = channelLabel(draft.channel);
      var status = el("span", "messages-thread__status");
      status.textContent = statusLabel(draft.status);
      var when = el("span", "messages-thread__when");
      when.textContent = formatWhen(draft.updatedAt || draft.createdAt);
      meta.appendChild(channel);
      meta.appendChild(status);
      meta.appendChild(when);

      var bubble = el("button", "messages-thread__bubble", {
        type: "button",
        title: "Open draft",
      });
      if (draft.channel === "gmail_outreach" && draft.subject) {
        var subj = el("div", "messages-thread__subject");
        subj.textContent = draft.subject;
        bubble.appendChild(subj);
      }
      var body = el("div", "messages-thread__body");
      body.textContent = String(draft.body || "").trim() || "(empty draft)";
      bubble.appendChild(body);
      bubble.addEventListener("click", function () { openDraft(draft.id); });

      li.appendChild(meta);
      li.appendChild(bubble);
      list.appendChild(li);
    });
    thread.appendChild(list);
  }
  function clearThread() {
    state.lead = null;
    state.drafts = [];
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
      state.drafts = all.filter(function (d) { return d && d.leadId === leadId; });
      if (!state.lead) state.error = "That conversation could not be found.";
    }).catch(function (err) {
      state.lead = null;
      state.drafts = [];
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
    STATUS_LABEL: STATUS_LABEL,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
