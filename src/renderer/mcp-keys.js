/* mcp-keys.js. Connect Clay.
 *
 * Profile menu → Connect Clay. The signed-in owner mints a connector
 * key. The plaintext is shown once, in this panel, with copy buttons.
 * Leaving or refreshing drops it. The server stores a hash only, so a
 * later visit can list and revoke, and cannot show the key again.
 *
 * Clay's connector is two fields:
 *   URL    https://tinker.beginner.work/api/mcp
 *   Header Authorization: Bearer mcp_…
 *
 * The app's own sign-in is sent on mint and revoke. The screen never
 * asks anyone to copy that session.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var MCP_URL = "https://tinker.beginner.work/api/mcp";
  var HEADER_PREFIX = "Authorization: Bearer ";
  var HEADER_PLACEHOLDER = HEADER_PREFIX + "mcp_…";

  var overlay = null;
  var plaintext = "";
  var freshRow = null;
  var loadGen = 0;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
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

  function forgetKey() {
    plaintext = "";
    if (!overlay) return;
    var header = overlay.querySelector("[data-header-value]");
    if (header) header.textContent = HEADER_PLACEHOLDER;
    var copyHeader = overlay.querySelector("[data-copy-header]");
    if (copyHeader) {
      copyHeader.disabled = true;
      copyHeader.textContent = "Copy header";
    }
    var tokenBtn = overlay.querySelector("[data-copy-token]");
    if (tokenBtn) tokenBtn.setAttribute("hidden", "");
    var reveal = overlay.querySelector("[data-reveal]");
    if (reveal) reveal.setAttribute("hidden", "");
    var done = overlay.querySelector("[data-done]");
    if (done) done.setAttribute("hidden", "");
  }

  function close() {
    forgetKey();
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }

  function copyText(text, button, idleLabel) {
    function done() {
      button.textContent = "Copied";
      setTimeout(function () {
        if (button.isConnected) button.textContent = idleLabel;
      }, 1600);
    }
    function fallback() {
      var area = el("textarea", "connector-copy-fallback");
      area.value = text;
      overlay.appendChild(area);
      area.select();
      try { document.execCommand("copy"); } catch (err) { /* ignore */ }
      area.remove();
      done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function errorText(result, fallback) {
    var json = (result && result.json) || {};
    var msg = json.error || fallback;
    if (json.userId) msg += " Account id: " + json.userId + ".";
    return msg;
  }

  function showStatus(status, text, kind) {
    status.textContent = text || "";
    status.classList.toggle("connector-status--error", kind === "error");
    status.classList.toggle("connector-status--ok", kind === "ok");
    if (text) status.removeAttribute("hidden");
    else status.setAttribute("hidden", "");
  }

  function formatWhen(iso) {
    if (!iso) return "";
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function paintHeader() {
    var header = overlay.querySelector("[data-header-value]");
    var copyHeader = overlay.querySelector("[data-copy-header]");
    var tokenBtn = overlay.querySelector("[data-copy-token]");
    var reveal = overlay.querySelector("[data-reveal]");
    if (plaintext) {
      if (header) header.textContent = HEADER_PREFIX + plaintext;
      if (copyHeader) copyHeader.disabled = false;
      if (tokenBtn) tokenBtn.removeAttribute("hidden");
      if (reveal) reveal.removeAttribute("hidden");
    } else {
      forgetKey();
    }
  }

  function renderList(list, rows) {
    list.textContent = "";
    if (!rows.length) {
      var empty = el("p", "connector-empty");
      empty.textContent = "No keys yet.";
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      list.appendChild(renderRow(row, list));
    });
  }

  function renderRow(row, list) {
    var item = el("div", "connector-key");
    var meta = el("div", "connector-key__meta");
    var name = el("span", "connector-key__label");
    name.textContent = row.label || "Key";
    var state = el("span", row.revokedAt ? "connector-key__state connector-key__state--off" : "connector-key__state");
    state.textContent = row.revokedAt ? "Revoked" : "Active";
    meta.appendChild(name);
    meta.appendChild(state);
    var when = el("span", "connector-key__when");
    when.textContent = formatWhen(row.revokedAt || row.createdAt);
    meta.appendChild(when);
    item.appendChild(meta);

    if (!row.revokedAt) {
      var actions = el("div", "connector-key__actions");
      var revoke = el("button", "connector-revoke", { type: "button" });
      revoke.textContent = "Revoke";
      var keep = null;
      revoke.addEventListener("click", function () {
        if (revoke.dataset.armed !== "1") {
          revoke.dataset.armed = "1";
          revoke.textContent = "Revoke now";
          revoke.classList.add("connector-revoke--armed");
          if (!keep) {
            keep = el("button", "connector-keep", { type: "button" });
            keep.textContent = "Keep";
            keep.addEventListener("click", function () {
              revoke.dataset.armed = "";
              revoke.textContent = "Revoke";
              revoke.classList.remove("connector-revoke--armed");
              keep.remove();
              keep = null;
            });
            actions.appendChild(keep);
          }
          return;
        }
        revoke.disabled = true;
        revoke.textContent = "Revoking…";
        api("DELETE", { id: row.id }).then(function (result) {
          if (!result.ok) {
            revoke.disabled = false;
            revoke.textContent = "Revoke now";
            var status = overlay && overlay.querySelector("[data-status]");
            if (status) showStatus(status, errorText(result, "Could not revoke that key."), "error");
            return;
          }
          if (plaintext && freshRow && freshRow.id === row.id) forgetKey();
          row.revokedAt = (result.json && result.json.revokedAt) || new Date().toISOString();
          var next = renderRow(row, list);
          item.replaceWith(next);
        });
      });
      actions.appendChild(revoke);
      item.appendChild(actions);
    }
    return item;
  }

  function api(method, body) {
    var t = token();
    if (!t) {
      return Promise.resolve({ ok: false, json: { error: "Sign in to tinker, then open Connect Clay again." } });
    }
    return fetch("/api/mcp-keys", {
      method: method,
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer " + t,
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        return { ok: res.ok, status: res.status, json: json };
      });
    }).catch(function () {
      return { ok: false, json: { error: "Couldn't reach tinker. Check your connection and try again." } };
    });
  }

  function open() {
    close();
    plaintext = "";

    overlay = el("div", "connector-overlay", {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Connect Clay",
    });

    var backdrop = el("div", "connector-overlay__backdrop");
    backdrop.addEventListener("click", close);
    overlay.appendChild(backdrop);

    var panel = el("div", "connector-overlay__panel");

    var closeBtn = el("button", "connector-overlay__close", { type: "button", "aria-label": "Close" });
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", close);
    panel.appendChild(closeBtn);

    var title = el("h2", "connector-title");
    title.textContent = "Connect Clay";
    panel.appendChild(title);

    var sub = el("p", "connector-sub");
    sub.textContent = "Paste the URL and the header into Clay. Mint the key here. It is shown once.";
    panel.appendChild(sub);

    panel.appendChild(copyRow("URL", MCP_URL, "Copy URL", false));

    var headerRow = el("div", "connector-row");
    var headerLabel = el("span", "connector-label");
    headerLabel.textContent = "Header";
    var headerValue = el("code", "connector-value", { "data-header-value": "" });
    headerValue.textContent = HEADER_PLACEHOLDER;
    var copyHeader = el("button", "connector-copy", { type: "button", "data-copy-header": "" });
    copyHeader.textContent = "Copy header";
    copyHeader.disabled = true;
    copyHeader.addEventListener("click", function () {
      if (!plaintext) return;
      copyText(HEADER_PREFIX + plaintext, copyHeader, "Copy header");
    });
    headerRow.appendChild(headerLabel);
    headerRow.appendChild(headerValue);
    headerRow.appendChild(copyHeader);
    panel.appendChild(headerRow);

    var tokenBtn = el("button", "connector-textbtn", { type: "button", "data-copy-token": "" });
    tokenBtn.textContent = "Copy token only";
    tokenBtn.setAttribute("hidden", "");
    tokenBtn.addEventListener("click", function () {
      if (!plaintext) return;
      copyText(plaintext, tokenBtn, "Copy token only");
    });
    panel.appendChild(tokenBtn);

    var reveal = el("p", "connector-reveal", { "data-reveal": "", role: "status" });
    reveal.textContent = "Copy this header into Clay now. The full key will not be shown again.";
    reveal.setAttribute("hidden", "");
    panel.appendChild(reveal);

    var done = el("button", "connector-done", { type: "button", "data-done": "" });
    done.textContent = "Done";
    done.setAttribute("hidden", "");
    done.addEventListener("click", function () {
      forgetKey();
      done.setAttribute("hidden", "");
    });
    panel.appendChild(done);

    var form = el("form", "connector-mint");
    var labelInput = el("input", "connector-input", {
      type: "text",
      name: "label",
      value: "Clay",
      maxlength: "80",
      autocomplete: "off",
      "aria-label": "Key label",
    });
    var mint = el("button", "connector-mint__go", { type: "submit" });
    mint.textContent = "Mint key";
    form.appendChild(labelInput);
    form.appendChild(mint);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var label = (labelInput.value || "").trim();
      if (!label) {
        showStatus(status, "Name this key.", "error");
        labelInput.focus();
        return;
      }
      mint.disabled = true;
      mint.textContent = "Minting…";
      showStatus(status, "", "");
      api("POST", { label: label }).then(function (result) {
        mint.disabled = false;
        mint.textContent = "Mint key";
        var json = result.json || {};
        if (!result.ok || !json.key) {
          showStatus(status, errorText(result, "Could not mint a key."), "error");
          return;
        }
        plaintext = json.key;
        freshRow = {
          id: json.id,
          label: json.label,
          createdAt: json.createdAt,
          revokedAt: null,
        };
        paintHeader();
        done.removeAttribute("hidden");
        var list = overlay.querySelector("[data-list]");
        var empty = list && list.querySelector(".connector-empty");
        if (empty) empty.remove();
        if (list) {
          list.insertBefore(renderRow({
            id: json.id,
            label: json.label,
            createdAt: json.createdAt,
            revokedAt: null,
          }, list), list.firstChild);
        }
        showStatus(status, "", "");
      });
    });
    panel.appendChild(form);

    var status = el("p", "connector-status", { "data-status": "", role: "status" });
    status.setAttribute("hidden", "");
    panel.appendChild(status);

    var listHeading = el("h3", "connector-list-title");
    listHeading.textContent = "Keys";
    panel.appendChild(listHeading);

    var list = el("div", "connector-list", { "data-list": "" });
    var loading = el("p", "connector-empty");
    loading.textContent = "Loading keys…";
    list.appendChild(loading);
    panel.appendChild(list);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);

    var gen = ++loadGen;
    api("GET").then(function (result) {
      if (!overlay || gen !== loadGen) return;
      if (!result.ok) {
        list.textContent = "";
        showStatus(status, errorText(result, "Could not load keys."), "error");
        if (result.status === 403 || result.status === 503) {
          form.setAttribute("hidden", "");
        }
        return;
      }
      var keys = (result.json && result.json.keys) || [];
      if (freshRow && !keys.some(function (row) { return row.id === freshRow.id; })) {
        keys.unshift(freshRow);
      }
      renderList(list, keys.map(function (row) {
        return {
          id: row.id,
          label: row.label,
          createdAt: row.createdAt,
          revokedAt: row.revokedAt || null,
        };
      }));
    });

    setTimeout(function () { try { labelInput.select(); } catch (err) { /* ignore */ } }, 0);
  }

  function copyRow(labelText, value, buttonLabel, disabled) {
    var row = el("div", "connector-row");
    var label = el("span", "connector-label");
    label.textContent = labelText;
    var code = el("code", "connector-value");
    code.textContent = value;
    var button = el("button", "connector-copy", { type: "button" });
    button.textContent = buttonLabel;
    if (disabled) button.disabled = true;
    button.addEventListener("click", function () {
      copyText(value, button, buttonLabel);
    });
    row.appendChild(label);
    row.appendChild(code);
    row.appendChild(button);
    return row;
  }

  window.tinkerMcpKeys = {
    open: open,
    close: close,
    url: MCP_URL,
  };
})();
