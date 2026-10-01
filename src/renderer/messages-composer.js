/* Lead/person chat: owner notes + Keep crafting interview turns.
 * Outreach recipient/body stay data-only via MCP. Keep crafting asks a new
 * person-scoped question (never a repeat). This is everything saves notes
 * and shows one read-only Subject card (generated subject on the gmail draft
 * for Clair). No To/Body review UI, no edit/send controls.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var DONE_MARKER = "__done__";
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
    preamble: "",
    transcript: [],
    pending: "",
    queue: [],
    draft: "",
    saving: false,
    asking: false,
    done: false,
    proposedSubject: "",
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
    var api = interviewApi();
    var person = String(lead && lead.personName || "").trim() || "them";
    var co = String((company && company.name) || (lead && lead.company) || "").trim();
    if (api && typeof api.defaultPersonQuestion === "function") {
      return api.defaultPersonQuestion(person, co);
    }
    if (co) return "What are you curious about in " + person + "'s work at " + co + "?";
    return "What are you curious about in " + person + "'s work?";
  }
  function serializeNotes(preamble, transcript, pending, draft, queue) {
    var parts = [];
    var head = String(preamble || "").replace(/\n+$/, "");
    if (head) {
      parts.push(head);
      parts.push("");
    }
    (transcript || []).forEach(function (turn) {
      if (!turn || !turn.q) return;
      parts.push("### " + String(turn.q).trim());
      parts.push(String(turn.a || "").trim());
      parts.push("");
    });
    if (pending) {
      parts.push("### " + String(pending).trim());
      parts.push(String(draft || "").trim());
      parts.push("");
    } else if (String(draft || "").trim()) {
      parts.push(String(draft).trim());
      parts.push("");
    }
    (queue || []).forEach(function (q) {
      var text = String(q || "").trim();
      if (!text) return;
      parts.push("### " + text);
      parts.push("");
    });
    return parts.join("\n").replace(/\n+$/, "");
  }
  function serializeDoneNotes(preamble, transcript) {
    var parts = [];
    var head = String(preamble || "").replace(/\n+$/, "");
    if (head) {
      parts.push(head);
      parts.push("");
    }
    (transcript || []).forEach(function (turn) {
      if (!turn || !turn.q) return;
      parts.push("### " + String(turn.q).trim());
      parts.push(String(turn.a || "").trim());
      parts.push("");
    });
    parts.push("### " + DONE_MARKER);
    parts.push("");
    return parts.join("\n").replace(/\n+$/, "");
  }
  function parseNotes(raw, lead, company) {
    var text = String(raw || "").replace(/\r\n/g, "\n");
    var fallbackQ = defaultQuestion(lead, company);
    if (!text.trim()) {
      return { preamble: "", transcript: [], pending: fallbackQ, queue: [], draft: "", done: false };
    }
    if (!/^###\s+/m.test(text)) {
      // Legacy freeform notes = draft under the default prompt.
      return { preamble: "", transcript: [], pending: fallbackQ, queue: [], draft: text.trim(), done: false };
    }
    var done = new RegExp("(?:^|\\n)###\\s*" + DONE_MARKER + "\\s*(?:\\n|$)").test(text);
    var firstHeading = text.search(/^###\s+/m);
    var preamble = firstHeading > 0 ? text.slice(0, firstHeading).replace(/\n+$/, "") : "";
    var body = firstHeading >= 0 ? text.slice(firstHeading) : text;
    var chunks = body.split(/^###\s+/m).filter(function (c) { return String(c || "").trim(); });
    var transcript = [];
    var unanswered = [];
    chunks.forEach(function (chunk) {
      var nl = chunk.indexOf("\n");
      var q = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
      var a = (nl === -1 ? "" : chunk.slice(nl + 1)).replace(/^\n+/, "").replace(/\n+$/, "");
      if (!q || q === DONE_MARKER) return;
      if (a.trim()) transcript.push({ q: q, a: a });
      else unanswered.push(q);
    });
    if (done) {
      return { preamble: preamble, transcript: transcript, pending: "", queue: [], draft: "", done: true };
    }
    var pending = unanswered[0] || fallbackQ;
    var queue = unanswered.slice(1);
    return { preamble: preamble, transcript: transcript, pending: pending, queue: queue, draft: "", done: false };
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
  function appendTurns(opening) {
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
  }
  function buildOpening(lead, company) {
    // Display-only: do not render the italic "Notes for …" label, company
    // logo mark, company-notes paragraph, or interview-prep preamble.
    // researchProse / state.preamble / lead.notes still feed Keep crafting +
    // subject prompts via buildPersonUserMessage and resolveSubject:
    // hide UI, keep prompt context. Seeded prep: answered turns + one
    // pending question. Remaining queued ### headings stay hidden until advance.
    var opening = el("div", "messages-notepad__opening");
    void company;
    appendTurns(opening);
    var q = el("h2", "messages-notepad__question", { "data-notepad-question": "1" });
    q.textContent = state.pending || defaultQuestion(lead, company);
    opening.appendChild(q);
    return opening;
  }
  function buildSubjectCard(subject) {
    var card = el("div", "messages-notepad__subject", { "data-notepad-subject": "1" });
    var label = el("p", "messages-notepad__subject-label");
    label.textContent = "Subject";
    var text = el("p", "messages-notepad__subject-text");
    text.textContent = String(subject || "").trim();
    card.appendChild(label);
    card.appendChild(text);
    return card;
  }
  function buildDoneOpening(lead, company, subject) {
    // Same display rule as buildOpening: no "Notes for …" chrome; turns +
    // Subject card only. Company/person notes remain in prompt helpers.
    var opening = el("div", "messages-notepad__opening");
    void lead;
    void company;
    appendTurns(opening);
    opening.appendChild(buildSubjectCard(subject));
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
  function keepCraftingModel() {
    var api = interviewApi();
    return (api && api.KEEP_CRAFTING_MODEL) || "claude-opus-4-8";
  }
  function fallbackSubject() {
    var api = interviewApi();
    var person = String(state.lead && state.lead.personName || "").trim();
    var co = String((state.company && state.company.name) || (state.lead && state.lead.company) || "").trim();
    if (api && typeof api.fallbackOutreachSubject === "function") {
      return api.fallbackOutreachSubject(person, co);
    }
    return co ? ("Quick note - " + (person || "you") + " at " + co) : ("Quick note - " + (person || "you"));
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
    if (state.done) {
      np.mount(host, {
        primaryLabel: "",
        secondaryLabel: "",
        heading: "",
        value: "",
        hideInput: true,
        hideFoot: true,
        metaNode: buildDoneOpening(state.lead, state.company, state.proposedSubject || fallbackSubject()),
        onInput: null,
        onPrimary: null,
        onSecondary: null,
      });
      setTimeout(scrollSubjectIntoView, 80);
      return;
    }
    np.mount(host, {
      primaryLabel: "This is everything",
      secondaryLabel: "Keep crafting",
      heading: "",
      value: state.draft,
      hideInput: false,
      hideFoot: false,
      metaNode: buildOpening(state.lead, state.company),
      onInput: function (value) {
        if (state.done) return;
        state.draft = value;
        state.notes = serializeNotes(state.preamble, state.transcript, state.pending, state.draft, state.queue);
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
  function scrollSubjectIntoView() {
    var host = threadHost();
    var card = host && host.querySelector("[data-notepad-subject], .messages-notepad__subject");
    if (!card) return;
    try { card.scrollIntoView({ behavior: "smooth", block: "center" }); }
    catch (e) { try { card.scrollIntoView(true); } catch (e2) { /* ignore */ } }
  }
  function unmountNotepad() {
    var np = notepad();
    if (np) np.unmount();
    stripReviewUi(threadHost());
    document.body.classList.remove("messages-notepad-active");
  }
  function persistNotes(opts) {
    var asDone = !!(opts && opts.done) || state.done;
    state.notes = asDone
      ? serializeDoneNotes(state.preamble, state.transcript)
      : serializeNotes(state.preamble, state.transcript, state.pending, state.draft, state.queue);
    if (state.lead) state.lead.notes = state.notes;
    return api("/api/leads", "PATCH", "edit", { notes: state.notes }, { id: state.leadId }).then(function (res) {
      if (res && res.lead) {
        state.lead = res.lead;
        var parsed = parseNotes(res.lead.notes || state.notes, state.lead, state.company);
        // Keep in-memory pending/transcript authoritative after Keep crafting / done.
        if (!state.asking && !asDone) {
          state.preamble = parsed.preamble || "";
          state.transcript = parsed.transcript;
          state.pending = parsed.pending;
          state.queue = parsed.queue || [];
          state.draft = parsed.draft;
          state.notes = res.lead.notes || state.notes;
        } else if (asDone) {
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
  function resolveSubject() {
    var api = interviewApi();
    var maxAttempts = 3;
    var system = (api && api.SUBJECT_SYSTEM_PROMPT) ||
      'Return JSON { "subject": string } for one short outreach email subject.';
    var person = String(state.lead && state.lead.personName || "").trim();
    var co = String((state.company && state.company.name) || (state.lead && state.lead.company) || "").trim();
    function attempt(i) {
      if (!window.tinker || typeof window.tinker.callClaude !== "function") {
        return Promise.resolve(fallbackSubject());
      }
      var prepContext = String(state.preamble || "").trim();
      var companyContext = researchProse(state.company) || "";
      if (prepContext) {
        companyContext = companyContext
          ? (companyContext + "\n\nPrep context: " + prepContext)
          : ("Prep context: " + prepContext);
      }
      var user = api && typeof api.buildSubjectUserMessage === "function"
        ? api.buildSubjectUserMessage({
            personName: person,
            personTitle: state.lead && state.lead.personTitle,
            companyName: co,
            companyContext: companyContext,
            transcript: state.transcript,
          })
        : "Propose a short email subject for outreach to " + person + ".";
      return window.tinker.callClaude({
        system: system,
        messages: [{ role: "user", content: user }],
        model: keepCraftingModel(),
        maxTokens: 256,
      }).then(function (result) {
        var parsed = api && typeof api.parseSubjectResponse === "function"
          ? api.parseSubjectResponse(result && result.text)
          : (function () {
              try { return JSON.parse(String(result && result.text || "{}")); }
              catch (e) { return { subject: String(result && result.text || "").trim() }; }
            })();
        var subject = api && typeof api.normalizeOutreachSubject === "function"
          ? api.normalizeOutreachSubject(parsed, person, co)
          : String(parsed && parsed.subject || "").trim().slice(0, 90);
        if (subject) return subject;
        if (i + 1 < maxAttempts) return attempt(i + 1);
        return fallbackSubject();
      }).catch(function () {
        if (i + 1 < maxAttempts) return attempt(i + 1);
        return fallbackSubject();
      });
    }
    return attempt(0);
  }
  function persistProposedSubject(subject) {
    return api("/api/leads", "POST", "proposed-subject", {
      leadId: state.leadId,
      subject: subject,
    }).then(function (res) {
      if (res && res.draft && res.draft.subject) {
        state.proposedSubject = String(res.draft.subject).trim();
      }
      return res;
    });
  }
  function saveNotes(mode) {
    if (state.saving || state.asking || !state.leadId || state.done) return;
    state.saving = true;
    var np = notepad();
    if (np) {
      np.setPrimaryEnabled(false);
      var secondary = np.el().querySelector("[data-notepad-secondary]");
      if (secondary) secondary.disabled = true;
    }
    if (np) state.draft = np.getValue();
    // Fold the current answer into the transcript so the subject sees it.
    var answer = String(state.draft || "").trim();
    if (answer && state.pending) {
      state.transcript = state.transcript.concat([{ q: state.pending, a: answer }]);
    }
    state.pending = "";
    state.queue = [];
    state.draft = "";
    // Mark done before any async work so onInput / notes-folder / Keep crafting
    // cannot re-serialize the transcript without ### __done__ and overwrite it.
    if (mode === "done") {
      state.done = true;
      state.notes = serializeDoneNotes(state.preamble, state.transcript);
      if (state.lead) state.lead.notes = state.notes;
      mountNotepad();
    }
    persistNotes({ done: true }).then(function () {
      if (mode !== "done") {
        mountNotepad();
        return null;
      }
      // Subject is generated once. Skip Claude if a draft subject already exists.
      if (state.proposedSubject) {
        mountNotepad();
        return null;
      }
      return resolveSubject().then(function (subject) {
        state.proposedSubject = String(subject || fallbackSubject()).trim() || fallbackSubject();
        return persistProposedSubject(state.proposedSubject).catch(function () {
          // Subject card still renders even if draft write fails.
          return null;
        });
      }).then(function () {
        mountNotepad();
      });
    }).catch(function () {
      // Notes persist failed - stay done in-memory so we do not wipe the marker
      // via a non-done re-serialize; owner can reload if the server write missed.
      mountNotepad();
    }).finally(function () {
      state.saving = false;
      var n = notepad();
      if (n && !state.done) {
        n.setPrimaryEnabled(true);
        var secondary = n.el().querySelector("[data-notepad-secondary]");
        if (secondary) secondary.disabled = false;
      }
    });
  }
  function askedQuestions() {
    var api = interviewApi();
    var pending = state.pending || "";
    var queued = Array.isArray(state.queue) ? state.queue.filter(Boolean) : [];
    var base;
    if (api && typeof api.collectAskedQuestions === "function") {
      base = api.collectAskedQuestions(state.transcript, [], pending);
    } else {
      base = state.transcript.map(function (t) { return t.q; }).filter(Boolean).concat(pending ? [pending] : []);
    }
    return base.concat(queued);
  }
  function buildPersonUserMessage(asked, tighter) {
    var api = interviewApi();
    var person = String(state.lead && state.lead.personName || "").trim() || "this person";
    var co = String((state.company && state.company.name) || (state.lead && state.lead.company) || "").trim();
    var title = String(state.lead && state.lead.personTitle || "").trim();
    var research = researchProse(state.company);
    // Prep preamble stays out of the thread UI but still grounds prompts lightly.
    var prepContext = String(state.preamble || "").trim();
    if (api && typeof api.buildPersonUserMessage === "function") {
      return api.buildPersonUserMessage({
        personName: person,
        personTitle: title,
        companyName: co,
        companyContext: research,
        prepContext: prepContext,
        transcript: state.transcript,
        pendingQuestion: state.pending,
        draftAnswer: state.draft,
        asked: asked,
        keepCrafting: true,
        keepCraftingTighter: !!tighter,
      });
    }
    var lines = [];
    lines.push("The owner is crafting personal outreach notes about a specific person.");
    lines.push("Person: " + person + (title ? " (" + title + ")" : "") + (co ? " at " + co : "") + ".");
    if (research) lines.push("Company context (light background only — do not turn into business talk): " + research.slice(0, 1200));
    if (prepContext) lines.push("Prep context (light background only): " + prepContext.slice(0, 1200));
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
    lines.push(
      'The owner pressed "Keep crafting" — return a non-empty next_question that has not been asked yet. Set done false. Do not stitch.'
    );
    lines.push(
      "Ask about curiosity, how they know them, something shared or admired, or what would make a conversation feel natural — not what they want " +
        person +
        " to understand about them."
    );
    return lines.join("\n");
  }
  function resolveNextQuestion(asked) {
    var api = interviewApi();
    var maxAttempts = 3;
    var system = (api && api.PERSON_SYSTEM_PROMPT) ||
      "You help the owner connect personally with one person. Ask one short warm question. Never resume or career framing. Return JSON {next_question, done:false}.";
    function attempt(i) {
      if (!window.tinker || typeof window.tinker.callClaude !== "function") {
        return Promise.reject(new Error("Anthropic client unavailable. Reload the page."));
      }
      return window.tinker.callClaude({
        system: system,
        messages: [{ role: "user", content: buildPersonUserMessage(asked, i > 0) }],
        model: keepCraftingModel(),
        maxTokens: 1024,
      }).then(function (result) {
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
        if (q) return q;
        if (i + 1 < maxAttempts) return attempt(i + 1);
        var fallback = api && typeof api.fallbackPersonKeepCraftingQuestion === "function"
          ? api.fallbackPersonKeepCraftingQuestion(state.transcript.length, asked)
          : "What else are you curious about in them?";
        return fallback;
      });
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
    if (state.saving || state.asking || !state.leadId || state.done) return;
    var np = notepad();
    if (np) state.draft = np.getValue();
    var answer = String(state.draft || "").trim();
    if (!answer) {
      showNudge("Type an answer first. Keep crafting asks the next question from what you wrote.");
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
    // Seeded prep queue advances one question at a time (no model call).
    if (state.queue && state.queue.length) {
      state.pending = String(state.queue[0] || "").trim();
      state.queue = state.queue.slice(1);
      state.notes = serializeNotes(state.preamble, state.transcript, state.pending, state.draft, state.queue);
      persistNotes().then(function () {
        mountNotepad();
        setTimeout(scrollQuestionIntoView, 80);
        setTimeout(scrollQuestionIntoView, 320);
      }).catch(function (err) {
        var last = state.transcript[state.transcript.length - 1];
        if (last && last.q === currentQ && last.a === answer) {
          state.transcript = state.transcript.slice(0, -1);
          state.draft = answer;
          state.queue = [state.pending].concat(state.queue || []);
          state.pending = currentQ;
        }
        mountNotepad();
        showNudge((err && err.message) || "Could not advance to the next question. Try Keep crafting again.");
      }).finally(function () {
        state.asking = false;
        var n = notepad();
        if (n) {
          n.setPrimaryEnabled(true);
          var secondaryBtn = n.el().querySelector("[data-notepad-secondary]");
          if (secondaryBtn) secondaryBtn.disabled = false;
        }
      });
      return;
    }
    var asked = askedQuestions();
    resolveNextQuestion(asked).then(function (nextQ) {
      var q = String(nextQ || "").trim();
      var api = interviewApi();
      if (!q || (api && typeof api.isRepeatQuestion === "function" && api.isRepeatQuestion(q, asked))) {
        q = api && typeof api.fallbackPersonKeepCraftingQuestion === "function"
          ? api.fallbackPersonKeepCraftingQuestion(state.transcript.length, asked)
          : "What else are you curious about in them?";
      }
      state.pending = q;
      state.notes = serializeNotes(state.preamble, state.transcript, state.pending, state.draft, state.queue);
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
  function subjectFromDrafts(drafts) {
    var rows = Array.isArray(drafts) ? drafts.slice() : [];
    rows.sort(function (a, b) {
      var aG = a && a.channel === "gmail_outreach" ? 0 : 1;
      var bG = b && b.channel === "gmail_outreach" ? 0 : 1;
      if (aG !== bG) return aG - bG;
      return String(b && b.updatedAt || "").localeCompare(String(a && a.updatedAt || ""));
    });
    for (var i = 0; i < rows.length; i++) {
      var status = String(rows[i] && rows[i].status || "");
      if (status === "sent_by_owner") continue;
      var subject = String(rows[i] && rows[i].subject || "").trim();
      if (subject) return subject;
    }
    return "";
  }
  function hydrateFromLead(lead, drafts) {
    var parsed = parseNotes(lead && lead.notes || "", lead, state.company);
    state.preamble = parsed.preamble || "";
    state.transcript = parsed.transcript;
    state.pending = parsed.pending;
    state.queue = parsed.queue || [];
    state.draft = parsed.draft;
    state.done = !!parsed.done;
    state.proposedSubject = subjectFromDrafts(drafts);
    if (state.done) {
      state.pending = "";
      state.queue = [];
      state.draft = "";
      state.notes = serializeDoneNotes(state.preamble, state.transcript);
      if (!state.proposedSubject) state.proposedSubject = fallbackSubject();
    } else {
      state.notes = serializeNotes(state.preamble, state.transcript, state.pending, state.draft, state.queue);
    }
  }
  function setLead(leadId, lead, touch, drafts) {
    state.leadId = leadId || "";
    state.lead = lead || null;
    state.company = companyForLead(lead);
    state.touch = touch || null;
    state.asking = false;
    state.saving = false;
    if (!leadId) {
      state.preamble = "";
      state.transcript = [];
      state.pending = "";
      state.queue = [];
      state.draft = "";
      state.notes = "";
      state.done = false;
      state.proposedSubject = "";
      unmountNotepad();
      return;
    }
    hydrateFromLead(lead, drafts);
    mountNotepad();
    setTimeout(state.done ? scrollSubjectIntoView : scrollQuestionIntoView, 100);
  }
  function setYouMode(on) {
    if (on) {
      state.leadId = "";
      state.lead = null;
      state.company = null;
      state.touch = null;
      state.notes = "";
      state.preamble = "";
      state.transcript = [];
      state.pending = "";
      state.queue = [];
      state.draft = "";
      state.done = false;
      state.proposedSubject = "";
      unmountNotepad();
      hideLegacyComposer();
    }
  }
  function onSelect(e) {
    if (e && e.detail && e.detail.you) {
      setYouMode(true);
      return;
    }
    if (e && e.detail && e.detail.reading) {
      setYouMode(true);
      return;
    }
    var id = e && e.detail && e.detail.leadId;
    var touch = e && e.detail && e.detail.touch;
    if (!id) { setYouMode(false); setLead("", null, null); return; }
    api("/api/leads", "GET", "lead", null, { id: id }).then(function (res) {
      var lead = res.lead || { id: id };
      setLead(id, lead, touch || null, res.drafts || []);
    }).catch(function () {
      setLead(id, { id: id }, touch || null, []);
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
