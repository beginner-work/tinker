/* LinkedIn draft — topic or bullets in, copy out.
 *
 * Sidebar → LinkedIn draft. Posts to the existing /api/claude/converse
 * route with mode "linkedin", so the server owns the voice and niche.
 * The same function backs the MCP
 * tool draft_linkedin_post. This panel does not post to LinkedIn;
 * Stanley still publishes.
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

  function close() {
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
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

  function field(labelText, input) {
    var wrap = el("label", "linkedin-draft__field");
    var label = el("span", "linkedin-draft__label");
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function open() {
    close();
    var saved = loadState();

    overlay = el("div", "linkedin-draft-overlay", {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "LinkedIn draft",
    });

    var backdrop = el("div", "linkedin-draft-overlay__backdrop");
    backdrop.addEventListener("click", close);
    overlay.appendChild(backdrop);

    var panel = el("div", "linkedin-draft-overlay__panel");

    var closeBtn = el("button", "linkedin-draft-overlay__close", {
      type: "button",
      "aria-label": "Close",
    });
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", close);
    panel.appendChild(closeBtn);

    var title = el("h2", "linkedin-draft__title");
    title.textContent = "LinkedIn draft";
    panel.appendChild(title);

    var sub = el("p", "linkedin-draft__sub");
    sub.textContent = "Topic or bullets in. Draft out, in your LinkedIn voice. Posting still goes through Stanley.";
    panel.appendChild(sub);

    var form = el("form", "linkedin-draft", { novalidate: "" });

    var notes = el("textarea", "linkedin-draft__input linkedin-draft__notes", {
      name: "notes",
      rows: "5",
      placeholder: "The point, or a few bullets.",
      required: "",
    });
    notes.value = saved.notes;

    var draft = el("textarea", "linkedin-draft__input linkedin-draft__post", {
      name: "currentDraft",
      rows: "8",
      placeholder: "A draft lands here. Edit it, then revise.",
    });
    draft.value = saved.draft;

    var instruction = el("input", "linkedin-draft__input", {
      type: "text",
      name: "instruction",
      placeholder: "Shorter, or lead with the portal.",
      maxlength: "1000",
    });
    instruction.value = saved.instruction;

    form.appendChild(field("Topic or bullet notes", notes));
    form.appendChild(field("Draft", draft));

    var clearBtn = el("button", "linkedin-draft__clear", { type: "button" });
    clearBtn.textContent = "Clear draft";
    form.appendChild(clearBtn);

    form.appendChild(field("What to change (optional)", instruction));

    var status = el("p", "linkedin-draft__status", { role: "status", "aria-live": "polite" });
    status.setAttribute("hidden", "");
    form.appendChild(status);

    var actions = el("div", "linkedin-draft__actions");
    var submit = el("button", "linkedin-draft__submit", { type: "submit" });
    var copy = el("button", "linkedin-draft__copy", { type: "button" });
    copy.textContent = "Copy";
    actions.appendChild(submit);
    actions.appendChild(copy);
    form.appendChild(actions);

    function snapshot() {
      return {
        notes: notes.value,
        draft: draft.value,
        instruction: instruction.value,
      };
    }

    function showStatus(text, kind) {
      status.textContent = text;
      status.classList.toggle("linkedin-draft__status--error", kind === "error");
      status.classList.toggle("linkedin-draft__status--ok", kind === "ok");
      status.removeAttribute("hidden");
    }

    function syncButtons() {
      var revising = draft.value.trim().length > 0;
      submit.textContent = revising ? "Revise draft" : "Draft post";
      copy.disabled = !revising;
      clearBtn.disabled = !revising;
    }

    function persist() {
      saveState(snapshot());
      syncButtons();
    }

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
      var done = function () { showStatus("Copied. Stanley still posts this.", "ok"); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          showStatus("Couldn’t copy. Select the draft and copy it yourself.", "error");
        });
        return;
      }
      showStatus("Couldn’t copy. Select the draft and copy it yourself.", "error");
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
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
      var payload = { mode: "linkedin", notes: state.notes };
      if (revising) payload.currentDraft = state.draft;
      if (state.instruction.trim()) payload.instruction = state.instruction.trim();

      submit.disabled = true;
      submit.textContent = revising ? "Revising…" : "Drafting…";
      status.setAttribute("hidden", "");

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
            showStatus("Session expired — sign in again.", "error");
            if (window.tinkerAuth && typeof window.tinkerAuth.showGate === "function") {
              window.tinkerAuth.showGate();
            }
          } else if (r.ok && r.json && typeof r.json.post === "string" && r.json.post.trim()) {
            draft.value = r.json.post.trim();
            persist();
            showStatus(r.json.revised ? "Revised. Copy it when it’s ready — Stanley posts." : "Draft ready. Copy it when it’s ready — Stanley posts.", "ok");
          } else {
            var msg = (r.json && r.json.error) || "Couldn’t draft that. Try again in a moment.";
            showStatus(msg, "error");
          }
          submit.disabled = false;
          syncButtons();
        })
        .catch(function () {
          showStatus("Couldn’t reach the server. Check your connection and try again.", "error");
          submit.disabled = false;
          syncButtons();
        });
    });

    panel.appendChild(form);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);
    setTimeout(function () { try { notes.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  function bind() {
    var btn = document.getElementById("nav-linkedin-draft");
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function () {
      open();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.tinkerLinkedInDraft = { open: open, close: close };
})();
