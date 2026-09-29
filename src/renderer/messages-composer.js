/* Bottom composer for the messaging shell (TYL-65 slice 3).
 * Builds a draft from story parts + channel. Save draft only — never sends.
 * Drafts in progress live here; the sidebar draft list is removed.
 * Reuses draft channels, settings, and booking link from TYL-63.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var LINKEDIN_CONNECTION_NOTE_LIMIT = 200;
  var CHANNELS = [
    { key: "linkedin_connection", label: "LinkedIn connection request", charLimit: LINKEDIN_CONNECTION_NOTE_LIMIT },
    { key: "gmail_outreach", label: "Gmail" },
    { key: "linkedin_post", label: "LinkedIn post", needsLead: false },
  ];
  var REPLY_STAGES = { replied: 1, call: 1, interview: 1, offer: 1 };
  var state = {
    leadId: "",
    lead: null,
    parts: [],
    selectedParts: {},
    channel: "gmail_outreach",
    subject: "",
    body: "",
    bookingUrl: "",
    defaultFrom: "",
    saving: false,
    status: "",
    error: "",
  };
  var root = null;

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
  function channelMeta(key) {
    for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].key === key) return CHANNELS[i];
    return CHANNELS[0];
  }
  function isReply() {
    var stage = state.lead && state.lead.stage;
    return !!(stage && REPLY_STAGES[stage]) && state.channel !== "linkedin_post";
  }
  function partText(part) {
    if (!part) return "";
    if (part.body) return String(part.body).trim();
    if (part.text) return String(part.text).trim();
    var fields = part.fields || {};
    var bits = [];
    if (fields.start || fields.number || fields.cause) {
      bits.push([fields.start, fields.number, fields.cause].filter(Boolean).join(" "));
    }
    if (fields.teamOrRole) bits.push(fields.teamOrRole);
    Object.keys(fields).forEach(function (k) {
      if (k === "start" || k === "number" || k === "cause" || k === "teamOrRole") return;
      if (fields[k]) bits.push(fields[k]);
    });
    return bits.join("\n").trim() || String(part.id || "");
  }
  function rebuildBodyFromParts() {
    var chunks = [];
    state.parts.forEach(function (part) {
      if (state.selectedParts[part.id]) {
        var t = partText(part);
        if (t) chunks.push(t);
      }
    });
    if (chunks.length) state.body = chunks.join("\n\n");
  }
  function showStatus(msg, kind) {
    state.status = msg || "";
    state.error = kind === "error" ? msg : "";
    var node = root && root.querySelector("[data-composer-status]");
    if (!node) return;
    node.hidden = !msg;
    node.textContent = msg || "";
    node.className = "messages-composer__status" + (kind === "error" ? " messages-composer__status--error" : "");
  }
  function syncCounter() {
    var counter = root && root.querySelector("[data-composer-counter]");
    if (!counter) return;
    var meta = channelMeta(state.channel);
    if (!meta.charLimit) { counter.hidden = true; return; }
    counter.hidden = false;
    var n = state.body.length;
    var over = n > meta.charLimit;
    counter.textContent = n + " / " + meta.charLimit + (over ? " — over LinkedIn’s free note limit" : "");
    counter.classList.toggle("messages-composer__counter--over", over);
  }
  function renderParts() {
    var box = root && root.querySelector("[data-composer-parts]");
    if (!box) return;
    box.innerHTML = "";
    if (!state.parts.length) {
      box.appendChild(Object.assign(el("p", "messages-composer__hint"), {
        textContent: "No story parts yet. Add some in your writing flow, then insert them here.",
      }));
      return;
    }
    state.parts.forEach(function (part) {
      var id = part.id;
      var label = el("label", "messages-composer__part");
      var cb = el("input", "", { type: "checkbox" });
      cb.checked = !!state.selectedParts[id];
      cb.addEventListener("change", function () {
        if (cb.checked) state.selectedParts[id] = true;
        else delete state.selectedParts[id];
        rebuildBodyFromParts();
        var area = root.querySelector("[data-composer-body]");
        if (area) area.value = state.body;
        syncCounter();
      });
      var text = el("span", "messages-composer__part-text");
      var stage = part.stage ? String(part.stage).replace(/_/g, " ") + " · " : "";
      var preview = partText(part);
      text.textContent = stage + (preview.length > 72 ? preview.slice(0, 71) + "…" : preview);
      label.appendChild(cb);
      label.appendChild(text);
      box.appendChild(label);
    });
  }
  function render() {
    if (!root) return;
    root.hidden = !state.leadId;
    if (!state.leadId) return;
    var channel = root.querySelector("[data-composer-channel]");
    var subjectWrap = root.querySelector("[data-composer-subject-wrap]");
    var subject = root.querySelector("[data-composer-subject]");
    var body = root.querySelector("[data-composer-body]");
    var booking = root.querySelector("[data-composer-booking]");
    var save = root.querySelector("[data-composer-save]");
    if (channel && document.activeElement !== channel) channel.value = state.channel;
    if (subjectWrap) subjectWrap.hidden = state.channel !== "gmail_outreach";
    if (subject && document.activeElement !== subject) subject.value = state.subject;
    if (body && document.activeElement !== body) body.value = state.body;
    if (booking) {
      booking.hidden = !isReply();
      booking.disabled = !state.bookingUrl;
    }
    if (save) save.disabled = state.saving || !String(state.body || "").trim();
    syncCounter();
    renderParts();
  }
  function saveDraft() {
    if (state.saving) return;
    var body = String(state.body || "").trim();
    if (!body) { showStatus("Write something before saving a draft.", "error"); return; }
    var meta = channelMeta(state.channel);
    if (meta.needsLead === false) {
      /* linkedin_post may omit lead */
    } else if (!state.leadId) {
      showStatus("Pick a conversation first.", "error");
      return;
    }
    state.saving = true;
    showStatus("Saving draft…");
    render();
    var payload = {
      channel: state.channel,
      body: body,
      storyPartIds: Object.keys(state.selectedParts),
    };
    if (meta.needsLead !== false) payload.leadId = state.leadId;
    if (state.channel === "gmail_outreach") {
      payload.subject = state.subject;
      payload.fromAddress = state.defaultFrom || "";
    }
    api("/api/leads", "POST", "draft", payload).then(function () {
      showStatus("Draft saved. Your connected assistant can pull it — Tinker never sends.");
      state.body = "";
      state.subject = "";
      state.selectedParts = {};
      if (window.tinkerMessagesThread && state.leadId) window.tinkerMessagesThread.loadLead(state.leadId);
      if (window.tinkerMessagesShell && window.tinkerMessagesShell.refresh) window.tinkerMessagesShell.refresh();
      if (window.tinkerLeadDrafts && window.tinkerLeadDrafts.refresh) window.tinkerLeadDrafts.refresh();
    }).catch(function (err) {
      showStatus(err.message || "Could not save draft.", "error");
    }).finally(function () {
      state.saving = false;
      render();
    });
  }
  function loadParts() {
    if (!token()) return Promise.resolve();
    return api("/api/story-parts", "GET", "list", null, { status: "ready" }).catch(function () {
      return api("/api/story-parts", "GET", "list");
    }).then(function (res) {
      state.parts = Array.isArray(res.parts) ? res.parts : [];
    }).catch(function () {
      state.parts = [];
    });
  }
  function loadSettings() {
    return api("/api/leads", "GET", "settings").then(function (res) {
      state.defaultFrom = (res.settings && res.settings.defaultFromAddress) || "";
      state.bookingUrl = (res.settings && res.settings.bookingUrl) || "";
    }).catch(function () { /* ignore */ });
  }
  function setLead(leadId, lead) {
    state.leadId = leadId || "";
    state.lead = lead || null;
    state.status = "";
    state.error = "";
    render();
  }
  function onSelect(e) {
    var id = e && e.detail && e.detail.leadId;
    if (!id) { setLead("", null); return; }
    api("/api/leads", "GET", "lead", null, { id: id }).then(function (res) {
      setLead(id, res.lead || null);
    }).catch(function () {
      setLead(id, { id: id });
    });
  }
  function bind() {
    if (!root || root.getAttribute("data-bound")) return;
    root.setAttribute("data-bound", "1");
    var channel = root.querySelector("[data-composer-channel]");
    var subject = root.querySelector("[data-composer-subject]");
    var body = root.querySelector("[data-composer-body]");
    var booking = root.querySelector("[data-composer-booking]");
    var save = root.querySelector("[data-composer-save]");
    if (channel) {
      CHANNELS.forEach(function (c) {
        var opt = el("option", "", { value: c.key });
        opt.textContent = c.label;
        channel.appendChild(opt);
      });
      channel.value = state.channel;
      channel.addEventListener("change", function () {
        state.channel = channel.value;
        render();
      });
    }
    if (subject) subject.addEventListener("input", function () { state.subject = subject.value; });
    if (body) {
      body.addEventListener("input", function () {
        state.body = body.value;
        syncCounter();
        var saveBtn = root.querySelector("[data-composer-save]");
        if (saveBtn) saveBtn.disabled = state.saving || !String(state.body || "").trim();
      });
    }
    if (booking) {
      booking.addEventListener("click", function () {
        var url = String(state.bookingUrl || "").trim();
        if (!url) { showStatus("Set your booking link under Messages settings first.", "error"); return; }
        var cur = state.body || "";
        var gap = cur && !/\s$/.test(cur) ? "\n\n" : (cur ? "\n" : "");
        state.body = cur + gap + url;
        if (body) body.value = state.body;
        syncCounter();
        showStatus("Booking link inserted. Save when it reads right.");
      });
    }
    if (save) save.addEventListener("click", saveDraft);
  }
  function boot() {
    root = document.getElementById("messages-composer");
    if (!root) return;
    bind();
    root.hidden = true;
    Promise.all([loadParts(), loadSettings()]).then(render);
    window.addEventListener("tinker:messages-select", onSelect);
  }

  window.tinkerMessagesComposer = {
    setLead: setLead,
    refreshParts: loadParts,
    CHANNELS: CHANNELS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
