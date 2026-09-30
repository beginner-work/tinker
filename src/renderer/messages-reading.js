/* Reading workbook thread: one pre-read question + notepad + Keep crafting.
 * Reuses tinkerMessagesNotepad. No review UI, no sent bubbles, no subject card.
 * Persist via /api/reading-thread (merge-safe notes). Advance marks section done.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var DONE_MARKER = "__done__";
  var state = {
    threadId: "",
    thread: null,
    notes: "",
    transcript: [],
    pending: "",
    draft: "",
    saving: false,
    asking: false,
    done: false,
  };

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function api(method, action, body, query) {
    var q = new URLSearchParams(Object.assign({ action: action }, query || {}));
    var opts = {
      method: method,
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    };
    if (method !== "GET") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body || {});
    }
    return fetch("/api/reading-thread?" + q.toString(), opts).then(function (res) {
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
  function notepad() { return window.tinkerMessagesNotepad || null; }
  function interviewApi() { return window.tinkerInterview || null; }
  function threadHost() {
    return document.querySelector("#messages-pane [data-messages-thread]");
  }
  function keepCraftingModel() {
    var api = interviewApi();
    return (api && api.KEEP_CRAFTING_MODEL) || "claude-opus-4-8";
  }
  function parseNotes(text, thread) {
    var raw = String(text || "").replace(/\r\n/g, "\n");
    var done = new RegExp("(?:^|\\n)###\\s*" + DONE_MARKER + "\\s*(?:\\n|$)").test(raw);
    var body = raw.replace(new RegExp("(?:\\n*)###\\s*" + DONE_MARKER + "\\s*(?:\\n|$)", "g"), "\n").replace(/\n+$/, "");
    var parts = body.split(/\n(?=###\s+)/);
    var transcript = [];
    var pending = "";
    var draft = "";
    parts.forEach(function (chunk) {
      var m = String(chunk || "").match(/^###\s+([^\n]+)\n?([\s\S]*)$/);
      if (!m) return;
      var q = String(m[1] || "").trim();
      var a = String(m[2] || "").replace(/^\n+/, "").replace(/\n+$/, "");
      if (!q || q === DONE_MARKER) return;
      if (a.trim()) transcript.push({ q: q, a: a });
      else pending = q;
    });
    if (!pending && !done) {
      pending = (thread && thread.currentSection && thread.currentSection.preReadQuestion)
        || defaultQuestion(thread);
    }
    return { transcript: transcript, pending: pending, draft: draft, done: done };
  }
  function serializeNotes(transcript, pending, draft) {
    var lines = [];
    (transcript || []).forEach(function (t) {
      lines.push("### " + t.q);
      lines.push(t.a || "");
      lines.push("");
    });
    if (pending) {
      lines.push("### " + pending);
      if (String(draft || "").trim()) lines.push(String(draft).trim());
      lines.push("");
    }
    return lines.join("\n");
  }
  function serializeDoneNotes(transcript) {
    var body = serializeNotes(transcript, "", "");
    return (body ? body.replace(/\n+$/, "") + "\n\n" : "") + "### " + DONE_MARKER + "\n";
  }
  function defaultQuestion(thread) {
    var section = thread && thread.currentSection;
    if (section && section.preReadQuestion) return section.preReadQuestion;
    var title = String(thread && thread.title || "this book").trim();
    var sec = String(section && section.title || "the next section").trim();
    return "Before you open " + sec + " in " + title + ", what do you want to notice as you read?";
  }
  function appendTurns(host) {
    (state.transcript || []).forEach(function (t) {
      var block = el("div", "messages-notepad__turn");
      var q = el("p", "messages-notepad__question");
      q.textContent = t.q;
      var a = el("p", "messages-notepad__answer");
      a.textContent = t.a || "";
      block.appendChild(q);
      block.appendChild(a);
      host.appendChild(block);
    });
  }
  function buildOpening(thread) {
    var opening = el("div", "messages-notepad__opening");
    var section = thread && thread.currentSection;
    if (section && section.title) {
      var label = el("p", "messages-notepad__section");
      label.setAttribute("data-reading-section", "1");
      label.textContent = section.title;
      opening.appendChild(label);
    }
    appendTurns(opening);
    if (state.pending) {
      var q = el("p", "messages-notepad__question");
      q.setAttribute("data-notepad-question", "1");
      q.textContent = state.pending;
      opening.appendChild(q);
    }
    return opening;
  }
  function buildDoneOpening() {
    var opening = el("div", "messages-notepad__opening");
    appendTurns(opening);
    var done = el("p", "messages-notepad__done");
    done.textContent = "Reading complete.";
    opening.appendChild(done);
    return opening;
  }
  function scrollQuestionIntoView() {
    var host = threadHost();
    var q = host && host.querySelector("[data-notepad-question], .messages-notepad__question");
    if (!q) return;
    try { q.scrollIntoView({ behavior: "smooth", block: "center" }); }
    catch (e) { try { q.scrollIntoView(true); } catch (e2) { /* ignore */ } }
  }
  function mountNotepad() {
    var np = notepad();
    var host = threadHost();
    if (!np || !host || !state.threadId || !state.thread) return;
    document.body.classList.add("messages-notepad-active");
    document.body.classList.remove("messages-you-active");
    host.hidden = false;
    host.setAttribute("data-thread-ready", "1");
    host.classList.add("messages-thread");
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
        metaNode: buildDoneOpening(),
        onInput: null,
        onPrimary: null,
        onSecondary: null,
      });
      return;
    }
    np.mount(host, {
      primaryLabel: "Section done",
      secondaryLabel: "Keep crafting",
      heading: "",
      value: state.draft,
      hideInput: false,
      hideFoot: false,
      metaNode: buildOpening(state.thread),
      onInput: function (value) {
        if (state.done) return;
        state.draft = value;
        state.notes = serializeNotes(state.transcript, state.pending, state.draft);
      },
      onPrimary: function () { sectionDone(); },
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
    document.body.classList.remove("messages-notepad-active");
  }
  function persistNotes() {
    state.notes = serializeNotes(state.transcript, state.pending, state.draft);
    return api("POST", "edit", { notes: state.notes }, { id: state.threadId }).then(function (res) {
      if (res && res.thread) {
        state.thread = res.thread;
        state.notes = res.thread.notes || state.notes;
      }
      if (window.tinkerMessagesShell && window.tinkerMessagesShell.refresh) {
        window.tinkerMessagesShell.refresh();
      }
      return res;
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
  function buildReadingUserMessage(asked, tighter) {
    var api = interviewApi();
    var book = String(state.thread && state.thread.title || "this book").trim();
    var author = String(state.thread && state.thread.author || "").trim();
    var section = state.thread && state.thread.currentSection;
    var lines = [];
    lines.push("The founder is preparing to read a book section in a reading workbook.");
    lines.push("Book: " + book + (author ? " by " + author : "") + ".");
    if (section && section.title) lines.push("Current section: " + section.title + ".");
    lines.push("");
    lines.push("Interview so far:");
    if (!state.transcript.length) lines.push("(no answered turns yet)");
    else {
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
      : 'The founder pressed "Keep crafting" — return a non-empty next_question. Set done false.';
    lines.push(instr);
    lines.push("Ask another pre-read question that gets them ready for this section — concrete, not a repeat.");
    return lines.join("\n");
  }
  function resolveNextQuestion(asked) {
    var api = interviewApi();
    var maxAttempts = 3;
    var system = (api && api.SYSTEM_PROMPT) || "You are an interviewer. Return JSON {next_question, done:false}.";
    function attempt(i) {
      if (!window.tinker || typeof window.tinker.callClaude !== "function") {
        return Promise.reject(new Error("Anthropic client unavailable. Reload the page."));
      }
      return window.tinker.callClaude({
        system: system,
        messages: [{ role: "user", content: buildReadingUserMessage(asked, i > 0) }],
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
        }
        if (q) return q;
        if (i + 1 < maxAttempts) return attempt(i + 1);
        return "What else do you want to notice when you read this section?";
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
    if (state.saving || state.asking || !state.threadId || state.done) return;
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
    var currentQ = state.pending || defaultQuestion(state.thread);
    state.transcript = state.transcript.concat([{ q: currentQ, a: answer }]);
    state.draft = "";
    var asked = askedQuestions();
    resolveNextQuestion(asked).then(function (nextQ) {
      state.pending = String(nextQ || "").trim() || "What else do you want to notice when you read this section?";
      state.notes = serializeNotes(state.transcript, state.pending, state.draft);
      return persistNotes();
    }).then(function () {
      mountNotepad();
      setTimeout(scrollQuestionIntoView, 80);
    }).catch(function (err) {
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
  function sectionDone() {
    if (state.saving || state.asking || !state.threadId || state.done) return;
    var np = notepad();
    if (np) state.draft = np.getValue();
    var answer = String(state.draft || "").trim();
    if (answer && state.pending) {
      state.transcript = state.transcript.concat([{ q: state.pending, a: answer }]);
      state.draft = "";
      state.pending = "";
    }
    state.notes = serializeNotes(state.transcript, "", "");
    state.saving = true;
    if (np) {
      np.setPrimaryEnabled(false);
      var secondary = np.el().querySelector("[data-notepad-secondary]");
      if (secondary) secondary.disabled = true;
    }
    api("POST", "advance", { notes: state.notes }, { id: state.threadId }).then(function (res) {
      var thread = res && res.thread;
      if (!thread) return;
      state.thread = thread;
      state.done = !!thread.done;
      if (state.done) {
        state.pending = "";
        state.draft = "";
        state.notes = serializeDoneNotes(state.transcript);
      } else {
        var parsed = parseNotes(thread.notes || state.notes, thread);
        // Prefer server notes for completed turns; pending comes from next section.
        state.transcript = parsed.transcript.length ? parsed.transcript : state.transcript;
        state.pending = (thread.currentSection && thread.currentSection.preReadQuestion)
          || parsed.pending
          || defaultQuestion(thread);
        state.draft = "";
        state.notes = serializeNotes(state.transcript, state.pending, "");
        return api("POST", "edit", { notes: state.notes }, { id: state.threadId }).then(function (edited) {
          if (edited && edited.thread) state.thread = edited.thread;
        });
      }
    }).then(function () {
      mountNotepad();
      setTimeout(scrollQuestionIntoView, 80);
      if (window.tinkerMessagesShell && window.tinkerMessagesShell.refresh) {
        window.tinkerMessagesShell.refresh();
      }
    }).catch(function (err) {
      mountNotepad();
      showNudge((err && err.message) || "Could not mark the section done.");
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
  function hydrate(thread) {
    state.thread = thread || null;
    state.threadId = thread && thread.id || "";
    state.asking = false;
    state.saving = false;
    if (!thread) {
      state.notes = "";
      state.transcript = [];
      state.pending = "";
      state.draft = "";
      state.done = false;
      unmountNotepad();
      return;
    }
    var parsed = parseNotes(thread.notes || "", thread);
    state.transcript = parsed.transcript;
    state.done = !!thread.done || !!parsed.done;
    if (state.done) {
      state.pending = "";
      state.draft = "";
      state.notes = serializeDoneNotes(state.transcript);
    } else {
      state.pending = parsed.pending || defaultQuestion(thread);
      state.draft = parsed.draft || "";
      state.notes = serializeNotes(state.transcript, state.pending, state.draft);
    }
    mountNotepad();
    setTimeout(scrollQuestionIntoView, 100);
  }
  function close() {
    hydrate(null);
  }
  function onSelect(e) {
    if (e && e.detail && e.detail.reading && e.detail.threadId) {
      if (window.tinkerMessagesComposer && typeof window.tinkerMessagesComposer.setYouMode === "function") {
        window.tinkerMessagesComposer.setYouMode(true);
      }
      api("GET", "get", null, { id: e.detail.threadId }).then(function (res) {
        hydrate(res.thread || { id: e.detail.threadId });
      }).catch(function () {
        hydrate({ id: e.detail.threadId, title: "Reading", sections: [], currentSection: null, notes: "" });
      });
      return;
    }
    close();
  }
  function boot() {
    window.addEventListener("tinker:messages-select", onSelect);
  }

  window.tinkerMessagesReading = {
    close: close,
    open: function (threadId) {
      onSelect({ detail: { reading: true, threadId: threadId } });
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
