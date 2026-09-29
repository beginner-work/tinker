/* Bottom composer for the messaging shell (TYL-65/66).
 * Modern chat bar: growing textarea, channel/date as chips inside the shell,
 * Next (keep drafting), Ship (final / approved), and Gmail Send + confirm
 * (queues for your assistant). LinkedIn stays draft only.
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
    touch: null,
    parts: [],
    selectedParts: {},
    channel: "gmail_outreach",
    subject: "",
    body: "",
    plannedDate: "",
    bookingUrl: "",
    defaultFrom: "",
    saving: false,
    status: "",
    error: "",
    youMode: false,
    sendingEnabled: false,
    confirmSend: false,
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
    counter.textContent = n + " / " + meta.charLimit + (over ? " (over LinkedIn free note limit)" : "");
    counter.classList.toggle("messages-composer__counter--over", over);
  }
  function growTextarea() {
    var area = root && root.querySelector("[data-composer-body]");
    if (!area) return;
    area.style.height = "auto";
    var next = Math.min(Math.max(area.scrollHeight, 44), 180);
    area.style.height = next + "px";
  }
  function setActionEnabled() {
    var empty = !String(state.body || "").trim();
    var ship = root && root.querySelector("[data-composer-ship]");
    var next = root && root.querySelector("[data-composer-next]");
    var send = root && root.querySelector("[data-composer-send]");
    var confirm = root && root.querySelector("[data-composer-send-confirm]");
    var gmail = state.channel === "gmail_outreach" && !state.youMode;
    if (ship) {
      ship.hidden = !!state.confirmSend;
      ship.disabled = state.saving || empty || state.confirmSend;
    }
    if (next) {
      next.hidden = !!state.confirmSend;
      next.disabled = state.saving || empty || state.confirmSend;
    }
    if (send) {
      send.hidden = !gmail || !!state.confirmSend;
      send.disabled = state.saving || empty || !gmail;
    }
    if (confirm) confirm.hidden = !gmail || !state.confirmSend;
  }
  function renderParts() {
    var box = root && root.querySelector("[data-composer-parts]");
    if (!box) return;
    box.innerHTML = "";
    if (state.youMode) { box.hidden = true; return; }
    box.hidden = false;
    if (!state.parts.length) {
      box.appendChild(Object.assign(el("p", "messages-composer__hint"), {
        textContent: "No story parts yet. Add some, then tap a chip to insert.",
      }));
      return;
    }
    state.parts.forEach(function (part) {
      var id = part.id;
      var chip = el("button", "messages-composer__chip" + (state.selectedParts[id] ? " messages-composer__chip--on" : ""), {
        type: "button",
        "data-part-id": id,
      });
      var stage = (part.stageKey || part.stage)
        ? String(part.stageKey || part.stage).replace(/_/g, " ")
        : "Part";
      var preview = partText(part);
      chip.textContent = stage + (preview ? " · " + (preview.length > 28 ? preview.slice(0, 27) + "…" : preview) : "");
      chip.title = preview || stage;
      chip.setAttribute("aria-pressed", state.selectedParts[id] ? "true" : "false");
      chip.addEventListener("click", function () {
        if (state.selectedParts[id]) delete state.selectedParts[id];
        else state.selectedParts[id] = true;
        rebuildBodyFromParts();
        var area = root.querySelector("[data-composer-body]");
        if (area) area.value = state.body;
        syncCounter();
        growTextarea();
        renderParts();
        setActionEnabled();
      });
      box.appendChild(chip);
    });
  }
  function dateInputValue(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }
  function formatChipDate(value) {
    if (!value) return "Date";
    var d = new Date(value + "T12:00:00");
    if (Number.isNaN(d.getTime())) return value;
    try {
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (e) {
      return value;
    }
  }
  function syncDateChip() {
    var btn = root && root.querySelector("[data-composer-date-btn]");
    var label = root && root.querySelector("[data-composer-date-label]");
    var wrap = root && root.querySelector("[data-composer-date-wrap]");
    var hasTouch = !!(state.touch && state.touch.touch) && !state.youMode;
    if (wrap) wrap.hidden = !hasTouch;
    if (btn) btn.hidden = !hasTouch;
    if (label) label.textContent = formatChipDate(state.plannedDate || dateInputValue(state.touch && state.touch.touch && state.touch.touch.date));
  }
  function render() {
    if (!root) return;
    root.hidden = !state.leadId && !state.youMode;
    root.classList.toggle("messages-composer--you", !!state.youMode);
    if (!state.leadId && !state.youMode) return;
    var channel = root.querySelector("[data-composer-channel]");
    var subjectWrap = root.querySelector("[data-composer-subject-wrap]");
    var subject = root.querySelector("[data-composer-subject]");
    var dateInput = root.querySelector("[data-composer-date]");
    var body = root.querySelector("[data-composer-body]");
    var booking = root.querySelector("[data-composer-booking]");
    var toolbar = root.querySelector(".messages-composer__toolbar");
    if (toolbar) toolbar.hidden = !!state.youMode;
    if (channel && document.activeElement !== channel) channel.value = state.channel;
    if (subjectWrap) subjectWrap.hidden = state.youMode || state.channel !== "gmail_outreach";
    if (subject && document.activeElement !== subject) subject.value = state.subject;
    if (dateInput && document.activeElement !== dateInput) {
      dateInput.value = state.plannedDate || dateInputValue(state.touch && state.touch.touch && state.touch.touch.date);
    }
    syncDateChip();
    if (body && document.activeElement !== body) body.value = state.body;
    if (booking) {
      booking.hidden = state.youMode || !isReply();
      booking.disabled = !state.bookingUrl;
    }
    setActionEnabled();
    syncCounter();
    renderParts();
    growTextarea();
  }
  function savePlannedDate(value) {
    if (!state.touch || !state.touch.touch || !state.touch.touch.id) return;
    var day = String(value || "").trim();
    if (!day) return;
    var iso = new Date(day + "T12:00:00.000Z").toISOString();
    showStatus("Updating plan…");
    fetch("/api/schedule?action=nudge-date", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ date: iso, weekStart: iso }),
    }).then(function (res) { return res.json().then(function (payload) { return { ok: res.ok, payload: payload }; }); })
      .then(function (out) {
        var next = (out.ok && out.payload && out.payload.date) ? out.payload.date : iso;
        var nudged = !!(out.ok && out.payload && out.payload.nudged);
        return fetch("/api/schedule?action=touch", {
          method: "PATCH",
          headers: {
            Authorization: "Bearer " + token(),
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: state.touch.touch.id, date: next }),
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (payload) {
            if (!res.ok) throw new Error(payload.error || "Could not update date.");
            state.touch = { touch: payload.touch, company: state.touch.company };
            state.plannedDate = dateInputValue(payload.touch.date);
            showStatus(nudged
              ? "Moved off a busy day to " + state.plannedDate + "."
              : "Next touch set for " + state.plannedDate + ".");
            if (window.tinkerMessagesShell && window.tinkerMessagesShell.refresh) window.tinkerMessagesShell.refresh();
            if (window.tinkerMessagesThread && state.leadId) window.tinkerMessagesThread.loadLead(state.leadId);
            render();
          });
        });
      }).catch(function (err) {
        showStatus(err.message || "Could not update date.", "error");
      });
  }
  function persistDraft(mode) {
    var body = String(state.body || "").trim();
    var meta = channelMeta(state.channel);
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
    return api("/api/leads", "POST", "draft", payload).then(function (res) {
      var draft = res && res.draft;
      if ((mode === "ship" || mode === "send") && draft && draft.id) {
        return api("/api/leads", "POST", "approve", {}, { id: draft.id }).then(function () {
          return draft;
        });
      }
      return draft;
    });
  }
  function clearComposerFields() {
    state.body = "";
    state.subject = "";
    state.selectedParts = {};
    state.confirmSend = false;
  }
  function refreshAfterSave() {
    if (window.tinkerMessagesThread && state.leadId) window.tinkerMessagesThread.loadLead(state.leadId);
    if (window.tinkerMessagesShell && window.tinkerMessagesShell.refresh) window.tinkerMessagesShell.refresh();
    if (window.tinkerLeadDrafts && window.tinkerLeadDrafts.refresh) window.tinkerLeadDrafts.refresh();
  }
  function saveDraft(mode) {
    if (state.youMode) {
      try {
        window.dispatchEvent(new CustomEvent("tinker:messages-you-action", { detail: { action: mode } }));
      } catch (e) { /* ignore */ }
      return;
    }
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
    state.confirmSend = false;
    state.saving = true;
    showStatus(mode === "ship" ? "Marking ready…" : "Saving draft…");
    render();
    persistDraft(mode).then(function () {
      showStatus(mode === "ship" ? "Ready. This draft is final." : "Saved. Keep drafting when you are ready.");
      clearComposerFields();
      refreshAfterSave();
    }).catch(function (err) {
      showStatus(err.message || "Could not save draft.", "error");
    }).finally(function () {
      state.saving = false;
      render();
    });
  }
  function queueComposerSend() {
    if (state.youMode || state.saving) return;
    if (state.channel !== "gmail_outreach") return;
    var body = String(state.body || "").trim();
    if (!body) { showStatus("Write something before sending.", "error"); return; }
    if (!state.leadId) { showStatus("Pick a conversation first.", "error"); return; }
    if (!state.sendingEnabled) {
      showStatus("Sending is off. Turn on Sending enabled under Outreach first.", "error");
      state.confirmSend = false;
      render();
      return;
    }
    state.saving = true;
    showStatus("Queuing for your assistant…");
    render();
    persistDraft("send").then(function (draft) {
      if (!draft || !draft.id) throw new Error("Could not save draft.");
      return api("/api/leads", "POST", "queue-send", {}, { id: draft.id });
    }).then(function () {
      showStatus("Queued. Your assistant sends it through your Gmail.");
      clearComposerFields();
      refreshAfterSave();
    }).catch(function (err) {
      showStatus(err.message || "Could not queue send.", "error");
      state.confirmSend = false;
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
      state.sendingEnabled = !!(res.settings && res.settings.sendingEnabled);
    }).catch(function () { /* ignore */ });
  }
  function setLead(leadId, lead, touch) {
    state.youMode = false;
    state.leadId = leadId || "";
    state.lead = lead || null;
    state.touch = touch || null;
    state.plannedDate = dateInputValue(touch && touch.touch && touch.touch.date);
    state.status = "";
    state.error = "";
    render();
  }
  function setYouMode(on) {
    state.youMode = !!on;
    if (on) {
      state.leadId = "";
      state.lead = null;
      state.touch = null;
    }
    state.status = "";
    state.error = "";
    render();
  }
  function onSelect(e) {
    if (e && e.detail && e.detail.you) {
      setYouMode(true);
      return;
    }
    var id = e && e.detail && e.detail.leadId;
    var touch = e && e.detail && e.detail.touch;
    if (!id) { setYouMode(false); setLead("", null, null); return; }
    state.youMode = false;
    api("/api/leads", "GET", "lead", null, { id: id }).then(function (res) {
      setLead(id, res.lead || null, touch || null);
    }).catch(function () {
      setLead(id, { id: id }, touch || null);
    });
  }
  function bind() {
    if (!root || root.getAttribute("data-bound")) return;
    root.setAttribute("data-bound", "1");
    var channel = root.querySelector("[data-composer-channel]");
    var subject = root.querySelector("[data-composer-subject]");
    var body = root.querySelector("[data-composer-body]");
    var booking = root.querySelector("[data-composer-booking]");
    var ship = root.querySelector("[data-composer-ship]");
    var next = root.querySelector("[data-composer-next]");
    var send = root.querySelector("[data-composer-send]");
    var sendYes = root.querySelector("[data-composer-send-yes]");
    var sendNo = root.querySelector("[data-composer-send-no]");
    var dateInput = root.querySelector("[data-composer-date]");
    var dateBtn = root.querySelector("[data-composer-date-btn]");
    if (channel) {
      CHANNELS.forEach(function (c) {
        var opt = el("option", "", { value: c.key });
        opt.textContent = c.label;
        channel.appendChild(opt);
      });
      channel.value = state.channel;
      channel.addEventListener("change", function () {
        state.channel = channel.value;
        state.confirmSend = false;
        render();
      });
    }
    if (subject) subject.addEventListener("input", function () { state.subject = subject.value; });
    if (dateBtn && dateInput) {
      dateBtn.addEventListener("click", function () {
        try {
          if (typeof dateInput.showPicker === "function") dateInput.showPicker();
          else dateInput.click();
        } catch (e) {
          dateInput.focus();
          dateInput.click();
        }
      });
    }
    if (dateInput) {
      dateInput.addEventListener("change", function () {
        state.plannedDate = dateInput.value;
        savePlannedDate(dateInput.value);
      });
    }
    if (body) {
      body.addEventListener("input", function () {
        state.body = body.value;
        syncCounter();
        growTextarea();
        setActionEnabled();
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
        setActionEnabled();
        showStatus("Booking link inserted. Ship or Next when it reads right.");
      });
    }
    if (ship) ship.addEventListener("click", function () { saveDraft("ship"); });
    if (next) next.addEventListener("click", function () { saveDraft("next"); });
    if (send) {
      send.addEventListener("click", function () {
        if (state.channel !== "gmail_outreach" || state.youMode) return;
        if (!String(state.body || "").trim()) {
          showStatus("Write something before sending.", "error");
          return;
        }
        if (!state.sendingEnabled) {
          showStatus("Sending is off. Turn on Sending enabled under Outreach first.", "error");
          return;
        }
        state.confirmSend = true;
        showStatus("Queue this Gmail for your assistant to send?");
        render();
      });
    }
    if (sendYes) sendYes.addEventListener("click", function () { queueComposerSend(); });
    if (sendNo) {
      sendNo.addEventListener("click", function () {
        state.confirmSend = false;
        showStatus("");
        render();
      });
    }
  }
  function boot() {
    root = document.getElementById("messages-composer");
    if (!root) return;
    bind();
    root.hidden = true;
    Promise.all([loadParts(), loadSettings()]).then(render);
    window.addEventListener("tinker:messages-select", onSelect);
    window.addEventListener("tinker:sending-enabled", function (e) {
      state.sendingEnabled = !!(e && e.detail && e.detail.sendingEnabled);
    });
  }

  window.tinkerMessagesComposer = {
    setLead: setLead,
    setYouMode: setYouMode,
    refreshParts: loadParts,
    CHANNELS: CHANNELS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
