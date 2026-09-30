/* Lead/person chat: owner notes + Keep crafting interview turns.
 * Outreach recipient/subject/body stay data-only via MCP. Review happens
 * outside Tinker. Keep crafting asks a new person-scoped question (never a
 * repeat) and scrolls it into view. This is everything saves notes only.
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
    transcript: [],
    pending: "",
    draft: "",
    saving: false,
    asking: false,
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
  function interviewApi() {
    return window.tinkerInterview || null;
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
  function defaultQuestion(lead, company) {
    var person = String(lead && lead.personName || "").trim() || "them";
    var co = String((company && company.name) || (lead && lead.company) || "").trim();
    if (co) return "What do you want " + person + " at " + co + " to understand about you?";
    return "What do you want " + person + " to understand about you?";
  }
  function serializeNotes(transcript, pending, draft) {
    var parts = [];
    (transcript || []).forEach(function (turn) {
      if (!turn || !turn.q) return;
      parts.push("### " + String(turn.q).trim());
      parts.push(String(turn.a || "").trim());
      parts.push("");
    });
    if (pending) {
      parts.push("### " + String(pending).trim());
      parts.push(String(draft || "").trim());
    } else if (String(draft || "").trim()) {
      parts.push(String(draft).trim());
    }
    return parts.join("\n").replace(/\n+$/, "");
  }
  function parseNotes(raw, lead, company) {
    var text = String(raw || "").replace(/\r\n/g, "\n");
    var fallbackQ = defaultQuestion(lead, company);
    if (!text.trim()) {
      return { transcript: [], pending: fallbackQ, draft: "" };
    }
    if (!/^###\s+/m.test(text)) {
      // Legacy freeform notes = draft under the default prompt.
      return { transcript: [], pending: fallbackQ, draft: text.trim() };
    }
    var chunks = text.split(/^###\s+/m).filter(function (c) { return String(c || "").trim(); });
    var transcript = [];
    var pending = fallbackQ;
    var draft = "";
    chunks.forEach(function (chunk, i) {
      var nl = chunk.indexOf("\n");
      var q = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
      var a = (nl === -1 ? "" : chunk.slice(nl + 1)).replace(/^\n+/, "").replace(/\n+$/, "");
      if (!q) return;
      var isLast = i === chunks.length - 1;
      if (isLast) {
        pending = q;
        draft = a;
      } else {
        transcript.push({ q: q, a: a });
      }
    });
    return { transcript: transcript, pending: pending || fallbackQ, draft: draft };
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
    state.transcript.forEach(function (turn) {
      if (!turn || !turn.q) return;
      var block = el("div", "messages-notepad__turn");
      var qEl = el("h3", "messages-notepad__turn-q");
      qEl.textContent = turn.q;
      block.appendChild(qEl);
      if (String(turn.a || "").trim()) {
        var aEl = el("p", "messages-notepad__turn-a");
        aEl.textContent = turn.a;
        block.appendChild(aEl);
      }
      opening.appendChild(block);
    });
    var q = el("h2", "messages-notepad__question", { "data-notepad-question": "1" });
    q.textContent = state.pending || defaultQuestion(lead, company);
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
  function scrollQuestionIntoView() {
    var host = threadHost();
    var q = host && host.querySelector("[data-notepad-question], .messages-notepad__question");
    if (!q) return;
    try {
      q.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      try { q.scrollIntoView(true); } catch (e2) { /* ignore */ }
    }
    var thread = host;
    if (thread) {
      try {
        var top = q.offsetTop || 0;
        thread.scrollTop = Math.max(0, top - 24);
      } catch (e3) { /* ignore */ }
    }
  }
  function syncNotesFolder() {
    if (!window.tinkerNotesFolder || !state.lead) return;
    window.tinkerNotesFolder.scheduleWrite({
      id: state.leadId,
      personName: state.lead.personName,
      companyName: (state.company && state.company.name) || state.lead.company || "",
      companyId: state.lead.companyId || (state.company && state.company.id) || "",
      body: state.notes,
      updatedAt: new Date().toISOString(),
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
    // Drop stray thread Loading… lines once the notepad is mounting.
    host.querySelectorAll(".messages-thread__empty").forEach(function (node) {
      if (/loading/i.test(node.textContent || "") && node.parentNode) node.parentNode.removeChild(node);
    });
    np.mount(host, {
      primaryLabel: "This is everything",
      secondaryLabel: "Keep crafting",
      heading: "",
      value: state.draft,
      metaNode: buildOpening(state.lead, state.company),
      onInput: function (value) {
        state.draft = value;
        state.notes = serializeNotes(state.transcript, state.pending, state.draft);
        syncNotesFolder();
      },
      onPrimary: function () { saveNotes("done"); },
      onSecondary: function () { keepCrafting(); },
    });
    np.setPrimaryEnabled(!state.saving && !state.asking);
    var secondary = np.el && np.el().querySelector("[data-notepad-secondary]");
    if (secondary) secondary.disabled = !!(state.saving || state.asking);
    setTimeout(function () { np.focus(); }, 60);
  }
  function unmountNotepad() {
    var np = notepad();
    if (np) np.unmount();
    stripReviewUi(threadHost());
    document.body.classList.remove("messages-notepad-active");
  }
  function persistNotes() {
    state.notes = serializeNotes(state.transcript, state.pending, state.draft);
    if (state.lead) state.lead.notes = state.notes;
    return api("/api/leads", "PATCH", "edit", { notes: state.notes }, { id: state.leadId }).then(function (res) {
      if (res && res.lead) {
        state.lead = res.lead;
        var parsed = parseNotes(res.lead.notes || state.notes, state.lead, state.company);
        // Keep in-memory pending/transcript authoritative after Keep crafting.
        if (!state.asking) {
          state.transcript = parsed.transcript;
          state.pending = parsed.pending;
          state.draft = parsed.draft;
          state.notes = res.lead.notes || state.notes;
        }
      }
      syncNotesFolder();
      if (window.tinkerMessagesShell && window.tinkerMessagesShell.refresh) {
        window.tinkerMessagesShell.refresh();
      }
      return res;
    });
  }
  function saveNotes(mode) {
    if (state.saving || state.asking || !state.leadId) return;
    state.saving = true;
    var np = notepad();
    if (np) {
      np.setPrimaryEnabled(false);
      var secondary = np.el().querySelector("[data-notepad-secondary]");
      if (secondary) secondary.disabled = true;
    }
    if (np) state.draft = np.getValue();
    persistNotes().then(function () {
      mountNotepad();
      return mode;
    }).catch(function () {
      mountNotepad();
    }).finally(function () {
      state.saving = false;
      var n = notepad();
      if (n) {
        n.setPrimaryEnabled(true);
        var secondary = n.el().querySelector("[data-notepad-secondary]");
        if (secondary) secondary.disabled = false;
      }
    });
  }
  function askedQuestions() {
    var api = interviewApi();
    var pending = state.pending || "";
    if (api && typeof api.collectAskedQuestions === "function") {
      return api.collectAskedQuestions(state.transcript, [], pending);
    }
    return state.transcript.map(function (t) { return t.q; }).filter(Boolean).concat(pending ? [pending] : []);
  }
  function buildPersonUserMessage(asked, tighter) {
    var api = interviewApi();
    var person = String(state.lead && state.lead.personName || "").trim() || "this person";
    var co = String((state.company && state.company.name) || (state.lead && state.lead.company) || "").trim();
    var title = String(state.lead && state.lead.personTitle || "").trim();
    var lines = [];
    lines.push("The founder is crafting personal outreach notes about a specific person.");
    lines.push("Person: " + person + (title ? " (" + title + ")" : "") + (co ? " at " + co : "") + ".");
    var research = researchProse(state.company);
    if (research) lines.push("Company context: " + research.slice(0, 1200));
    lines.push("");
    lines.push("Interview so far:");
    if (!state.transcript.length) {
      lines.push("(no answered turns yet)");
    } else {
      state.transcript.forEach(function (t, i) {
        lines.push("Q" + (i + 1) + ": " + t.q);
        lines.push("A" + (i + 1) + ": " + (t.a || ""));
      });
    }
    if (state.pending) lines.push("Current question: " + state.pending);
    if (String(state.draft || "").trim()) lines.push("Current draft answer: " + String(state.draft).trim());
    lines.push("");
    if (asked && asked.length) {
      lines.push("Questions already asked (do not repeat or lightly rephrase):");
      asked.forEach(function (q) { lines.push("- " + q); });
      lines.push("");
    }
    var instr = api && typeof api.keepCraftingUserInstruction === "function"
      ? api.keepCraftingUserInstruction({ tighter: !!tighter })
      : 'The founder pressed "Keep crafting" — return a non-empty next_question that has not been asked yet. Set done false. Do not stitch.';
    lines.push(instr);
    lines.push("Ask about what the founder wants " + person + " to understand — learning-focused, concrete, not a repeat.");
    return lines.join("\n");
  }
  function keepCraftingModelId() {
    var od = window.tinkerOnDeviceLlm;
    if (od && typeof od.fallbackModel === "function") return od.fallbackModel();
    if (od && od.FALLBACK_MODEL) return od.FALLBACK_MODEL;
    return "claude-opus-4-8";
  }
  function resolveNextQuestion(asked) {
    var api = interviewApi();
    var maxAttempts = 3;
    var system = (api && api.SYSTEM_PROMPT) || "You are an interviewer. Return JSON {next_question, done:false}.";
    var userContent = null;
    function parseQuestion(result) {
      var parsed = api && typeof api.parseInterviewResponse === "function"
        ? api.parseInterviewResponse(result && result.text)
        : (function () {
            try { return JSON.parse(String(result && result.text || "{}")); }
            catch (e) { return { next_question: null, done: false }; }
          })();
      var q = null;
      if (api && typeof api.normalizeKeepCraftingQuestion === "function") {
        q = api.normalizeKeepCraftingQuestion(parsed, asked);
      } else {
        q = String(parsed && parsed.next_question || "").trim() || null;
        if (q && api && typeof api.isRepeatQuestion === "function" && api.isRepeatQuestion(q, asked)) q = null;
      }
      return q;
    }
    function viaFallbackModel(i) {
      if (!window.tinker || typeof window.tinker.callClaude !== "function") {
        return Promise.reject(new Error("Anthropic client unavailable. Reload the page."));
      }
      return window.tinker.callClaude({
        system: system,
        messages: [{ role: "user", content: userContent || buildPersonUserMessage(asked, i > 0) }],
        model: keepCraftingModelId(),
        maxTokens: 1024,
      }).then(function (result) {
        var q = parseQuestion(result);
        if (q) return q;
        if (i + 1 < maxAttempts) return attempt(i + 1);
        var fallback = api && typeof api.fallbackKeepCraftingQuestion === "function"
          ? api.fallbackKeepCraftingQuestion(state.transcript.length, asked)
          : "What else are you learning about what they should understand?";
        return fallback;
      });
    }
    function attempt(i) {
      userContent = buildPersonUserMessage(asked, i > 0);
      var od = window.tinkerOnDeviceLlm;
      // On-device Gemma only when the capability gate says yes; otherwise
      // KEEP_CRAFTING_MODEL (Opus). Gate rejects iOS Safari for E2B.
      if (
        i === 0 &&
        od &&
        typeof od.canRunGemma3nE2B === "function" &&
        od.canRunGemma3nE2B() &&
        typeof od.generateKeepCrafting === "function"
      ) {
        return od.generateKeepCrafting(userContent).then(function (text) {
          var q = parseQuestion({ text: text });
          if (q) return q;
          return viaFallbackModel(i);
        }).catch(function () {
          return viaFallbackModel(i);
        });
      }
      return viaFallbackModel(i);
    }
    return attempt(0);
  }
  function showNudge(msg) {
    var host = threadHost();
    var meta = host && host.querySelector("[data-notepad-meta]");
    if (!meta) return;
    var note = meta.querySelector("[data-keep-crafting-nudge]");
    if (!note) {
      note = el("p", "messages-notepad__nudge");
      note.setAttribute("data-keep-crafting-nudge", "1");
      meta.appendChild(note);
    }
    note.textContent = msg;
  }
  function keepCrafting() {
    if (state.saving || state.asking || !state.leadId) return;
    var np = notepad();
    if (np) state.draft = np.getValue();
    var answer = String(state.draft || "").trim();
    if (!answer) {
      showNudge("Type an answer first — Keep crafting asks the next question from what you wrote.");
      return;
    }
    state.asking = true;
    if (np) {
      np.setPrimaryEnabled(false);
      var secondary = np.el().querySelector("[data-notepad-secondary]");
      if (secondary) secondary.disabled = true;
    }
    var currentQ = state.pending || defaultQuestion(state.lead, state.company);
    state.transcript = state.transcript.concat([{ q: currentQ, a: answer }]);
    state.draft = "";
    var asked = askedQuestions();
    resolveNextQuestion(asked).then(function (nextQ) {
      var q = String(nextQ || "").trim();
      var api = interviewApi();
      if (!q || (api && typeof api.isRepeatQuestion === "function" && api.isRepeatQuestion(q, asked))) {
        q = api && typeof api.fallbackKeepCraftingQuestion === "function"
          ? api.fallbackKeepCraftingQuestion(state.transcript.length, asked)
          : "What else are you learning about what they should understand?";
      }
      state.pending = q;
      state.notes = serializeNotes(state.transcript, state.pending, state.draft);
      return persistNotes();
    }).then(function () {
      mountNotepad();
      setTimeout(scrollQuestionIntoView, 80);
      setTimeout(scrollQuestionIntoView, 320);
    }).catch(function (err) {
      // Roll back the committed turn on hard failure so the draft isn't lost.
      var last = state.transcript[state.transcript.length - 1];
      if (last && last.q === currentQ && last.a === answer) {
        state.transcript = state.transcript.slice(0, -1);
        state.draft = answer;
        state.pending = currentQ;
      }
      mountNotepad();
      showNudge((err && err.message) || "Could not ask the next question. Try Keep crafting again.");
    }).finally(function () {
      state.asking = false;
      var n = notepad();
      if (n) {
        n.setPrimaryEnabled(true);
        var secondary = n.el().querySelector("[data-notepad-secondary]");
        if (secondary) secondary.disabled = false;
      }
    });
  }
  function hydrateFromLead(lead) {
    var parsed = parseNotes(lead && lead.notes || "", lead, state.company);
    state.transcript = parsed.transcript;
    state.pending = parsed.pending;
    state.draft = parsed.draft;
    state.notes = serializeNotes(state.transcript, state.pending, state.draft);
  }
  function setLead(leadId, lead, touch) {
    state.leadId = leadId || "";
    state.lead = lead || null;
    state.company = companyForLead(lead);
    state.touch = touch || null;
    state.asking = false;
    state.saving = false;
    if (!leadId) {
      state.transcript = [];
      state.pending = "";
      state.draft = "";
      state.notes = "";
      unmountNotepad();
      return;
    }
    hydrateFromLead(lead);
    mountNotepad();
    setTimeout(scrollQuestionIntoView, 100);
  }
  function setYouMode(on) {
    if (on) {
      state.leadId = "";
      state.lead = null;
      state.company = null;
      state.touch = null;
      state.notes = "";
      state.transcript = [];
      state.pending = "";
      state.draft = "";
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
    hydrateFromLead(Object.assign({}, state.lead || {}, { notes: body || "" }));
    mountNotepad();
  }

  window.tinkerMessagesComposer = {
    setLead: setLead,
    setYouMode: setYouMode,
    applyImportedBody: applyImportedBody,
    keepCrafting: keepCrafting,
    refreshParts: function () { return Promise.resolve(); },
    CHANNELS: CHANNELS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
