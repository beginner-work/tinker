/* email.js — send an email from the founder's beginner.work address.
 *
 * A small compose overlay (To / Subject / Message) opened from the profile
 * menu. Sending goes through POST /api/email/send with the founder's Stytch
 * session token — the server relays to the beginner mcp Worker, which owns
 * the Cloudflare Send Email binding on the beginner.work zone. No mail
 * credential ever reaches the browser; the founder's identity is the
 * signed-in session, the From address is the domain's configured sender.
 *
 * Prefill is best-effort from what profile.js already rendered into the
 * popover (.profile-popover__name / __email): the name becomes the From
 * display name, the account email becomes Reply-To, so answers land in the
 * founder's real inbox.
 *
 * Inherited constraint (Cloudflare Email Routing): delivery only reaches
 * verified destination addresses on the account. The server passes the
 * Worker's actionable error through and the composer shows it verbatim —
 * a failed send never closes the overlay or loses the draft.
 *
 * window.tinkerEmail = { open, close }; the profile menu's "Send an email"
 * calls open(). Matches back-me.js / wallet.js overlay conventions.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }

  // What profile.js rendered into the popover — the closest thing to a
  // client-side profile read without another fetch.
  function popoverText(selector) {
    var el = document.querySelector(selector);
    return el && el.textContent ? el.textContent.trim() : "";
  }

  // ── Overlay ──────────────────────────────────────────────────────────
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
    var wrap = el("label", "email-compose__field");
    var label = el("span", "email-compose__label");
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function open() {
    close();

    var name = popoverText(".profile-popover__name");
    var accountEmail = popoverText(".profile-popover__email");

    overlay = el("div", "email-overlay", {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Send an email",
    });

    var backdrop = el("div", "email-overlay__backdrop");
    backdrop.addEventListener("click", close);
    overlay.appendChild(backdrop);

    var panel = el("div", "email-overlay__panel");

    var closeBtn = el("button", "email-overlay__close", { type: "button", "aria-label": "Close" });
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", close);
    panel.appendChild(closeBtn);

    var title = el("h2", "email-compose__title");
    title.textContent = "Send an email";
    panel.appendChild(title);

    var sub = el("p", "email-compose__sub");
    sub.textContent = name
      ? "Goes out as " + name + ", from your beginner.work address."
      : "Goes out from your beginner.work address.";
    panel.appendChild(sub);

    var form = el("form", "email-compose", { novalidate: "" });

    var to = el("input", "email-compose__input", {
      type: "email", name: "to", placeholder: "who@example.com",
      autocomplete: "email", required: "",
    });
    var subject = el("input", "email-compose__input", {
      type: "text", name: "subject", placeholder: "Subject", required: "",
    });
    var message = el("textarea", "email-compose__input email-compose__message", {
      name: "text", placeholder: "Write your message…", rows: "8", required: "",
    });

    form.appendChild(field("To", to));
    form.appendChild(field("Subject", subject));
    form.appendChild(field("Message", message));

    var status = el("p", "email-compose__status", { role: "status", "aria-live": "polite" });
    status.setAttribute("hidden", "");
    form.appendChild(status);

    var send = el("button", "email-compose__send", { type: "submit" });
    send.textContent = "Send";
    form.appendChild(send);

    function showStatus(text, kind) {
      status.textContent = text;
      status.classList.toggle("email-compose__status--error", kind === "error");
      status.classList.toggle("email-compose__status--ok", kind === "ok");
      status.removeAttribute("hidden");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var t = token();
      if (!t) {
        showStatus("Sign in to tinker on the web to send email.", "error");
        return;
      }
      if (!EMAIL_RE.test(to.value.trim())) {
        showStatus("Enter a valid recipient address.", "error");
        to.focus();
        return;
      }
      if (!subject.value.trim()) {
        showStatus("A subject is required.", "error");
        subject.focus();
        return;
      }
      if (!message.value.trim()) {
        showStatus("Write a message first.", "error");
        message.focus();
        return;
      }

      var payload = {
        to: to.value.trim(),
        subject: subject.value.trim(),
        text: message.value,
      };
      if (name) payload.fromName = name;
      if (EMAIL_RE.test(accountEmail)) payload.replyTo = accountEmail;

      send.disabled = true;
      send.textContent = "Sending…";
      status.setAttribute("hidden", "");

      fetch("/api/email/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer " + t,
        },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().catch(function () { return null; }).then(function (json) {
            return { ok: res.ok, json: json };
          });
        })
        .then(function (r) {
          if (r.ok && r.json && r.json.sent) {
            showStatus("Sent to " + (r.json.to || payload.to) + " ✓", "ok");
            send.textContent = "Send another";
            to.value = "";
            subject.value = "";
            message.value = "";
          } else {
            var msg = (r.json && r.json.error) || "Send failed. Try again in a moment.";
            showStatus(msg, "error");
            send.textContent = "Send";
          }
          send.disabled = false;
        })
        .catch(function () {
          showStatus("Couldn’t reach the server. Check your connection and try again.", "error");
          send.textContent = "Send";
          send.disabled = false;
        });
    });

    panel.appendChild(form);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);
    setTimeout(function () { try { to.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  window.tinkerEmail = { open: open, close: close };
})();
