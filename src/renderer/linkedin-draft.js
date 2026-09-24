/* LinkedIn draft: topic or bullets in, copy out.
 *
 * Sidebar, LinkedIn draft. The surface is the writing stage: it reuses
 * .writing, .writing-card, .writing-input, and the pill footer. No
 * private stylesheet. Posts to /api/claude/converse with mode
 * "linkedin", so the server owns the voice and niche. The same function
 * backs the MCP tool draft_linkedin_post. This panel does not post.
 * Tinker keeps the list. You post it on LinkedIn.
 *
 * A direct message is the same panel. Start the notes with "DM:" or
 * put "DM" in What to change. wantsDm matches notesAskForDm on the server.
 *
 * Auth is the Stytch session already in localStorage (tinker_jwt), the
 * same bearer the writing UI sends.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var STORE_KEY = "tinker.linkedinDraft.v1";

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }

  function loadState() {
    var empty = { notes: "", draft: "", instruction: "" };
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return empty;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return empty;
      return {
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
        draft: typeof parsed.draft === "string" ? parsed.draft : "",
        instruction: typeof parsed.instruction === "string" ? parsed.instruction : "",
      };
    } catch (e) {
      return empty;
    }
  }

  function saveState(state) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { /* ignore quota */ }
  }

  var overlay = null;
  // Stage sections under the draft (welcome location grid, essay
  // #writing, read) and the fixed mode switch. Restored on close.
  var concealed = [];
  var migrationFlight = null;

  function apiSend(method, payload) {
    var t = token();
    if (!t) return Promise.resolve({ ok: false, status: 401, json: { error: "Sign in to keep drafts." } });
    var opts = { method: method, headers: { Authorization: "Bearer " + t } };
    if (payload) {
      opts.headers["content-type"] = "application/json";
      opts.body = JSON.stringify(payload);
    }
    return fetch("/api/linkedin-drafts", opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        return { ok: res.ok, status: res.status, json: json };
      });
    });
  }

  function attachList(p) {
    var rows = [];
    var selectedId = "";
    var filterKind = "all";
    var listBox = el("div");
    var detail = el("p", "writing-note");
    var approveBtn = el("button", "writing-action", { type: "button" });
    approveBtn.textContent = "Approve";
    var saveBtn = el("button", "writing-action", { type: "button" });
    saveBtn.textContent = "Save text";
    var postedBtn = el("button", "writing-action", { type: "button" });
    postedBtn.textContent = "Mark posted";
    var whenWrap = el("div");
    var whenLabel = el("p", "writing-note");
    whenLabel.textContent = "Scheduled date and time";
    var whenInput = el("input", "writing-input", { type: "datetime-local", name: "scheduledAt" });
    whenWrap.appendChild(whenLabel);
    whenWrap.appendChild(whenInput);
    var listCard = el("div", "writing-card");
    var listTitle = el("h2", "writing-question");
    listTitle.textContent = "Drafts";
    var listNote = el("p", "writing-note");
    listNote.textContent = "Posts and DMs in one list. Tinker keeps the list. You post on LinkedIn.";
    var filterRow = el("div");
    [["all", "All"], ["post", "Posts"], ["dm", "DMs"]].forEach(function (pair) {
      var button = el("button", "writing-action", { type: "button" });
      button.textContent = pair[1];
      button.setAttribute("data-kind", pair[0]);
      button.addEventListener("click", function () { filterKind = pair[0]; renderList(); });
      filterRow.appendChild(button);
    });
    var newBtn = el("button", "writing-action", { type: "button" });
    newBtn.textContent = "New draft";
    listCard.appendChild(listTitle);
    listCard.appendChild(listNote);
    listCard.appendChild(filterRow);
    listCard.appendChild(newBtn);
    listCard.appendChild(listBox);
    function place(parent, node, before) {
      if (typeof parent.insertBefore === "function") parent.insertBefore(node, before);
      else parent.appendChild(node);
    }
    place(p.column, listCard, p.card);
    place(p.card, detail, p.notesLabel);
    place(p.card, approveBtn, p.notesLabel);
    place(p.card, saveBtn, p.notesLabel);
    place(p.card, postedBtn, p.notesLabel);
    place(p.card, whenWrap, p.notesLabel);

    function current() {
      for (var i = 0; i < rows.length; i++) if (rows[i].id === selectedId) return rows[i];
      return null;
    }
    function renderList() {
      while (listBox.children.length) listBox.children[0].remove();
      var shown = [];
      for (var i = 0; i < rows.length; i++) {
        if (filterKind === "all" || rows[i].kind === filterKind) shown.push(rows[i]);
      }
      if (!shown.length) {
        var empty = el("p", "writing-note");
        empty.textContent = "No drafts in this filter yet.";
        listBox.appendChild(empty);
        return;
      }
      for (var j = 0; j < shown.length; j++) {
        var row = shown[j];
        var kind = row.kind === "dm" ? "DM" : "Post";
        var state = row.status === "approved" ? "Approved" : row.status === "scheduled" ? "Scheduled" : row.status === "posted" ? "Posted" : "Draft";
        var when = "";
        if (row.scheduledAt) {
          var at = new Date(row.scheduledAt);
          if (!isNaN(at.getTime())) when = " · " + at.toLocaleString();
        }
        var line = String(row.body || "").trim().split("\n")[0];
        var btn = el("button", "writing-action", { type: "button" });
        btn.className = row.id === selectedId ? "writing-action writing-action--primary" : "writing-action";
        btn.style.height = "auto";
        btn.style.whiteSpace = "normal";
        btn.style.textAlign = "left";
        btn.style.width = "100%";
        btn.textContent = kind + " · " + state + when + " · " + line.slice(0, 72);
        btn.addEventListener("click", (function (id) { return function () { selectRow(id); }; })(row.id));
        listBox.appendChild(btn);
      }
    }
    function syncDetail() {
      var row = current();
      var state = row ? row.status : "";
      approveBtn.hidden = !row || state !== "draft";
      postedBtn.hidden = !row || state === "posted";
      whenWrap.hidden = !row || (state !== "approved" && state !== "scheduled");
      if (!row) detail.textContent = "New draft. It joins the list when you save or draft.";
      else if (state === "draft") detail.textContent = "Draft. Approve it before you set a time.";
      else if (state === "approved") detail.textContent = "Approved. Set a date and time, or mark it posted after you paste it.";
      else if (state === "scheduled") detail.textContent = "Scheduled. Tinker stores the time. It does not post.";
      else detail.textContent = "Posted. Marked by hand. Tinker did not send it.";
      if (row && !whenWrap.hidden) {
        var d = row.scheduledAt ? new Date(row.scheduledAt) : null;
        if (d && !isNaN(d.getTime())) {
          function pad(n) { return (n < 10 ? "0" : "") + n; }
          whenInput.value = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
        } else whenInput.value = "";
      }
    }
    function remember(row) {
      var next = [];
      var found = false;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === row.id) { next.push(row); found = true; }
        else next.push(rows[i]);
      }
      if (!found) next.unshift(row);
      rows = next;
      selectedId = row.id;
      p.draft.value = row.body || "";
      p.notes.value = row.notes || "";
      renderList();
      syncDetail();
      p.syncButtons();
    }
    function selectRow(id) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id !== id) continue;
        selectedId = id;
        p.notes.value = rows[i].notes || "";
        p.draft.value = rows[i].body || "";
        p.instruction.value = "";
        renderList();
        syncDetail();
        p.syncButtons();
        return;
      }
    }
    function apply(r, okText) {
      if (r.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
        p.showStatus("Session expired. Sign in again.", "error");
        if (window.tinkerAuth && typeof window.tinkerAuth.showGate === "function") window.tinkerAuth.showGate();
        return;
      }
      if (!r.ok || !r.json || !r.json.draft) {
        p.showStatus((r.json && r.json.error) || "Couldn’t update that draft.", "error");
        return;
      }
      remember(r.json.draft);
      if (okText) p.showStatus(okText, "ok");
    }
    function send(method, payload, okText) {
      p.hideStatus();
      return apiSend(method, payload).then(function (r) { apply(r, okText); });
    }
    newBtn.addEventListener("click", function () {
      selectedId = "";
      p.notes.value = "";
      p.draft.value = "";
      p.instruction.value = "";
      p.hideStatus();
      renderList();
      syncDetail();
      p.syncButtons();
    });
    approveBtn.addEventListener("click", function () {
      if (selectedId) send("PATCH", { id: selectedId, status: "approved" }, "Approved. Set a time, or mark it posted when you have pasted it.");
    });
    postedBtn.addEventListener("click", function () {
      if (selectedId) send("PATCH", { id: selectedId, status: "posted" }, "Marked posted. Tinker did not send it.");
    });
    saveBtn.addEventListener("click", function () {
      var body = p.draft.value.trim();
      if (!body) { p.showStatus("Draft text is required.", "error"); return; }
      var payload = { body: body, notes: p.notes.value, kind: wantsDm(p.notes.value, p.instruction.value) ? "dm" : "post" };
      if (selectedId) send("PATCH", Object.assign({ id: selectedId }, payload), "Saved. Tinker keeps it until you post it.");
      else send("POST", payload, "Saved. Tinker keeps it until you post it.");
    });
    whenInput.addEventListener("change", function () {
      if (!selectedId) return;
      send("PATCH", { id: selectedId, scheduledAt: whenInput.value ? new Date(whenInput.value).toISOString() : null }, whenInput.value ? "Time stored. Tinker does not post it." : "Schedule cleared.");
    });
    renderList();
    syncDetail();
    var saved = p.saved;
    var chain = Promise.resolve(null);
    if (token() && saved.draft && saved.draft.trim()) {
      if (!migrationFlight) {
        migrationFlight = apiSend("POST", {
          body: saved.draft.trim(),
          notes: saved.notes,
          kind: wantsDm(saved.notes, saved.instruction) ? "dm" : "post",
        }).then(function (r) {
          if (!r.ok || !r.json || !r.json.draft) { migrationFlight = null; throw new Error((r.json && r.json.error) || "Couldn’t save the on-device draft."); }
          try { localStorage.removeItem(STORE_KEY); } catch (e2) { /* ignore */ }
          return r.json.draft;
        });
      }
      chain = migrationFlight;
    }
    var mine = overlay;
    chain.then(function (migrated) {
      if (!token()) return { migrated: migrated, list: [] };
      return apiSend("GET").then(function (r) {
        if (!r.ok) throw new Error((r.json && r.json.error) || "Couldn’t load drafts.");
        return { migrated: migrated, list: (r.json && r.json.drafts) || [] };
      });
    }).then(function (packed) {
      if (!packed || overlay !== mine) return;
      rows = packed.list || [];
      if (packed.migrated) remember(packed.migrated);
      else { renderList(); syncDetail(); }
    }).catch(function (err) {
      if (overlay !== mine) return;
      p.showStatus(err.message || "Couldn’t load drafts.", "error");
    });
    return function saveGenerated(json) {
      var payload = {
        body: p.draft.value.trim(),
        notes: p.notes.value,
        kind: json && json.kind === "dm" ? "dm" : "post",
      };
      if (selectedId) payload.id = selectedId;
      return apiSend(selectedId ? "PATCH" : "POST", payload).then(function (r) {
        apply(r, json && json.revised
          ? "Revised and saved. Tinker keeps it until you post it."
          : "Draft saved. Tinker keeps it until you post it.");
      });
    };
  }

  function surfaceSnapshot(node) {
    return {
      node: node,
      display: node.style.display,
      pointerEvents: node.style.pointerEvents,
      hidden: !!node.hidden,
      active: node.hasAttribute("data-active"),
      inert: node.hasAttribute("inert"),
      ariaHidden: node.getAttribute("aria-hidden"),
    };
  }

  function concealNode(node) {
    if (node.hasAttribute("data-active")) node.removeAttribute("data-active");
    node.hidden = true;
    node.setAttribute("inert", "");
    node.setAttribute("aria-hidden", "true");
    node.style.display = "none";
    node.style.pointerEvents = "none";
  }

  function concealSurfaces() {
    var saved = [];
    var stage = document.getElementById("stage");
    if (stage) {
      for (var i = 0; i < stage.children.length; i++) {
        var child = stage.children[i];
        if (child.getAttribute("aria-label") === "LinkedIn draft") continue;
        saved.push(surfaceSnapshot(child));
        concealNode(child);
      }
    }
    var modeNav = document.getElementById("mode-nav");
    if (modeNav) {
      saved.push(surfaceSnapshot(modeNav));
      concealNode(modeNav);
    }
    return saved;
  }

  function restoreSurfaces(saved) {
    for (var i = 0; i < saved.length; i++) {
      var item = saved[i];
      var node = item.node;
      node.style.display = item.display;
      node.style.pointerEvents = item.pointerEvents;
      node.hidden = item.hidden;
      if (item.inert) node.setAttribute("inert", "");
      else node.removeAttribute("inert");
      if (item.ariaHidden == null) node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden", item.ariaHidden);
      if (item.active) node.setAttribute("data-active", "");
      else node.removeAttribute("data-active");
    }
  }

  function close() {
    if (concealed.length) {
      restoreSurfaces(concealed);
      concealed = [];
    }
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }

  // Keep in sync with notesAskForDm in api/_lib/linkedin-draft.js.
  function wantsDm(notes, instruction) {
    var head = String(notes || "").split(/\r?\n/, 1)[0].trim();
    if (/^(dm|direct message)\b/i.test(head)) return true;
    var change = String(instruction || "").trim();
    if (/^(dm|direct message)\b/i.test(change)) return true;
    if (/\b(?:as|into) a (?:dm|direct message)\b/i.test(change)) return true;
    if (/\bmake (?:this|it) a (?:dm|direct message)\b/i.test(change)) return true;
    return false;
  }

  function copyWithSelection(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); }
    catch (e) { ok = false; }
    area.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
  }

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function closeIcon() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M6 6l12 12M18 6L6 18");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);
    return svg;
  }

  function open() {
    close();
    var saved = loadState();
    var stage = document.getElementById("stage") || document.body;

    overlay = el("section", "writing", {
      role: "region",
      "aria-label": "LinkedIn draft",
    });

    var header = el("header", "writing__top");
    var closeBtn = el("button", "writing__close", {
      type: "button",
      "aria-label": "Close",
    });
    closeBtn.appendChild(closeIcon());
    closeBtn.addEventListener("click", close);
    var step = el("div", "writing__step");
    step.textContent = "LinkedIn draft";
    header.appendChild(closeBtn);
    header.appendChild(step);

    var body = el("div", "writing__body");
    var column = el("div", "writing__stage");
    var card = el("div", "writing-card");

    var title = el("h2", "writing-question");
    title.textContent = "What should this post say?";
    var sub = el("p", "writing-note");
    sub.textContent = "Topic or bullets in. A post or a DM out. Start the notes with DM: for a message. Tinker keeps the list. You post it on LinkedIn.";

    var notesLabel = el("p", "writing-note");
    notesLabel.textContent = "Topic or bullet notes";
    var notes = el("textarea", "writing-input", {
      name: "notes",
      rows: "6",
      placeholder: "The point, or a few bullets.",
    });
    notes.value = saved.notes;

    var draftLabel = el("p", "writing-note");
    draftLabel.textContent = "Draft";
    var draft = el("textarea", "writing-input", {
      name: "currentDraft",
      rows: "8",
      placeholder: "A draft lands here. Edit it, then revise.",
    });
    draft.value = saved.draft;

    var changeLabel = el("p", "writing-note");
    changeLabel.textContent = "What to change";
    var instruction = el("textarea", "writing-input", {
      name: "instruction",
      rows: "3",
      placeholder: "Shorter, or lead with the portal.",
      maxlength: "1000",
    });
    instruction.value = saved.instruction;

    var statusWrap = el("div");
    var status = el("p", "writing-note", { role: "status", "aria-live": "polite" });
    statusWrap.hidden = true;
    statusWrap.appendChild(status);

    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(notesLabel);
    card.appendChild(notes);
    card.appendChild(draftLabel);
    card.appendChild(draft);
    card.appendChild(changeLabel);
    card.appendChild(instruction);
    card.appendChild(statusWrap);
    column.appendChild(card);
    body.appendChild(column);

    var foot = el("footer", "writing__foot");
    var clearBtn = el("button", "writing__end", { type: "button" });
    clearBtn.textContent = "Clear draft";
    var copy = el("button", "writing__end", { type: "button" });
    copy.textContent = "Copy";
    var submit = el("button", "writing__next", { type: "button" });
    foot.appendChild(clearBtn);
    foot.appendChild(copy);
    foot.appendChild(submit);

    function snapshot() {
      return {
        notes: notes.value,
        draft: draft.value,
        instruction: instruction.value,
      };
    }

    function showStatus(text, kind) {
      status.textContent = text;
      if (kind === "error") {
        status.className = "writing-error";
        statusWrap.className = "writing-card writing-card--error";
      } else {
        status.className = "writing-note";
        statusWrap.className = "";
      }
      statusWrap.hidden = false;
      try { status.scrollIntoView({ block: "nearest" }); } catch (e) { /* ignore */ }
    }

    function hideStatus() {
      statusWrap.hidden = true;
      status.textContent = "";
    }

    function syncButtons() {
      var revising = draft.value.trim().length > 0;
      var dm = wantsDm(notes.value, instruction.value);
      submit.textContent = revising ? "Revise draft" : (dm ? "Draft DM" : "Draft post");
      title.textContent = dm ? "What should this message say?" : "What should this post say?";
      copy.disabled = !revising;
      clearBtn.disabled = !revising;
    }

    function persist() {
      if (!token()) saveState(snapshot());
      syncButtons();
    }

    var saveGenerated = attachList({
      column: column,
      card: card,
      notesLabel: notesLabel,
      notes: notes,
      draft: draft,
      instruction: instruction,
      showStatus: showStatus,
      hideStatus: hideStatus,
      syncButtons: syncButtons,
      saved: saved,
    });

    notes.addEventListener("input", persist);
    draft.addEventListener("input", persist);
    instruction.addEventListener("input", persist);
    syncButtons();

    clearBtn.addEventListener("click", function () {
      draft.value = "";
      persist();
      draft.focus();
    });

    copy.addEventListener("click", function () {
      var text = draft.value.trim();
      if (!text) return;
      var done = function () { showStatus("Copied. Tinker does not post this.", "ok"); };
      var fail = function () {
        showStatus("Couldn’t copy. Select the draft and copy it yourself.", "error");
      };
      var write = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text).catch(function () { return copyWithSelection(text); })
        : copyWithSelection(text);
      Promise.resolve(write).then(done).catch(fail);
    });

    function submitDraft() {
      var state = snapshot();
      if (!state.notes.trim()) {
        showStatus("Add a topic or some bullet notes.", "error");
        notes.focus();
        return;
      }
      if (window.tinkerFreewrite && typeof window.tinkerFreewrite.isOn === "function" && window.tinkerFreewrite.isOn()) {
        showStatus("Turn AI mode on to draft a LinkedIn post.", "error");
        return;
      }
      var t = token();
      if (!t) {
        showStatus("Sign in to draft. This uses the same sign-in as the rest of tinker.", "error");
        if (window.tinkerAuth && typeof window.tinkerAuth.showGate === "function") {
          window.tinkerAuth.showGate();
        }
        return;
      }

      var revising = state.draft.trim().length > 0;
      var payload = {
        mode: "linkedin",
        notes: state.notes,
        kind: wantsDm(state.notes, state.instruction) ? "dm" : "post",
      };
      if (revising) payload.currentDraft = state.draft;
      if (state.instruction.trim()) payload.instruction = state.instruction.trim();

      submit.disabled = true;
      submit.textContent = revising ? "Revising…" : "Drafting…";
      hideStatus();

      fetch("/api/claude/converse", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer " + t,
        },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().catch(function () { return null; }).then(function (json) {
            return { ok: res.ok, status: res.status, json: json };
          });
        })
        .then(function (r) {
          if (r.status === 401) {
            try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
            showStatus("Session expired. Sign in again.", "error");
            if (window.tinkerAuth && typeof window.tinkerAuth.showGate === "function") {
              window.tinkerAuth.showGate();
            }
          } else if (r.ok && r.json && typeof r.json.post === "string" && r.json.post.trim()) {
            draft.value = r.json.post.trim();
            return saveGenerated(r.json);
          } else {
            var msg = (r.json && r.json.error) || "Couldn’t draft that. Try again in a moment.";
            showStatus(msg, "error");
          }
        })
        .then(function () {
          submit.disabled = false;
          syncButtons();
        })
        .catch(function () {
          showStatus("Couldn’t reach the server. Check your connection and try again.", "error");
          submit.disabled = false;
          syncButtons();
        });
    }

    submit.addEventListener("click", submitDraft);

    overlay.appendChild(header);
    overlay.appendChild(body);
    overlay.appendChild(foot);
    concealed = concealSurfaces();
    stage.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);
    setTimeout(function () { try { notes.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  function bind() {
    var btn = document.getElementById("nav-linkedin-draft");
    if (btn && btn.dataset.bound !== "1") {
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        open();
      });
    }
    var sidebar = document.getElementById("sidebar");
    if (sidebar && sidebar.dataset.linkedinBound !== "1") {
      sidebar.dataset.linkedinBound = "1";
      sidebar.addEventListener("click", function (e) {
        if (!overlay) return;
        if (e.target.closest && e.target.closest("#nav-linkedin-draft")) return;
        close();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.tinkerLinkedInDraft = { open: open, close: close };
})();
