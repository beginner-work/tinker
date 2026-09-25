/* /approvals
 *
 * Same sign-in as the rest of tinker: a Stytch session in
 * localStorage.tinker_jwt. The list comes from GET /api/approvals.
 * Each switch PUTs {required}. The row flips immediately and reverts
 * if the save fails.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var listEl = document.getElementById("approvals-list");
  var statusEl = document.getElementById("approvals-status");
  var items = [];

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (err) { return ""; }
  }

  function sendHome() {
    try { sessionStorage.setItem(RETURN_KEY, "/approvals"); }
    catch (err) { /* the sign-in page still works without the return */ }
    window.location.assign("/");
  }

  if (!token()) {
    sendHome();
    return;
  }

  function setStatus(text) {
    statusEl.textContent = text || "";
  }

  function changedLine(item) {
    if (!item.updated_by && !item.updated_at) return "Default, never changed";
    var who = item.updated_by || "someone";
    if (!item.updated_at) return "Changed by " + who;
    var when = new Date(item.updated_at);
    if (Number.isNaN(when.getTime())) return "Changed by " + who;
    var date = when.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return "Changed by " + who + " on " + date;
  }

  function render() {
    listEl.replaceChildren();
    items.forEach(function (item, index) {
      var row = document.createElement("li");
      row.className = "approvals__row";

      var label = document.createElement("span");
      label.className = "approvals__label";
      label.id = "approval-label-" + index;
      label.textContent = item.label;

      var button = document.createElement("button");
      button.type = "button";
      button.className = "approvals__switch";
      button.setAttribute("role", "switch");
      button.setAttribute("aria-checked", item.required ? "true" : "false");
      button.setAttribute("aria-labelledby", label.id);
      button.addEventListener("click", function () { toggle(item, button); });

      var meta = document.createElement("p");
      meta.className = "approvals__meta";
      meta.textContent = changedLine(item);

      row.appendChild(label);
      row.appendChild(button);
      row.appendChild(meta);

      if (item.send_note) {
        var note = document.createElement("p");
        note.className = "approvals__note";
        note.textContent = item.send_note;
        row.appendChild(note);
      }

      listEl.appendChild(row);
    });
  }

  function applySaved(item, saved) {
    item.required = saved.required;
    item.updated_by = saved.updated_by;
    item.updated_at = saved.updated_at;
    if (saved.send_note) item.send_note = saved.send_note;
  }

  function toggle(item, button) {
    var previous = {
      required: item.required,
      updated_by: item.updated_by,
      updated_at: item.updated_at,
    };
    var next = !item.required;
    item.required = next;
    button.setAttribute("aria-checked", next ? "true" : "false");
    button.disabled = true;
    setStatus("");

    fetch("/api/approvals/" + encodeURIComponent(item.key), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
      },
      body: JSON.stringify({ required: next }),
    }).then(function (res) {
      return res.json().then(function (body) {
        return { status: res.status, body: body };
      }, function () {
        return { status: res.status, body: null };
      });
    }).then(function (result) {
      button.disabled = false;
      if (result.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
        sendHome();
        return;
      }
      if (result.status !== 200 || !result.body || typeof result.body.required !== "boolean") {
        item.required = previous.required;
        item.updated_by = previous.updated_by;
        item.updated_at = previous.updated_at;
        render();
        setStatus((result.body && result.body.error) || "Could not save. The switch was put back.");
        return;
      }
      applySaved(item, result.body);
      render();
    }).catch(function () {
      item.required = previous.required;
      item.updated_by = previous.updated_by;
      item.updated_at = previous.updated_at;
      render();
      setStatus("Could not save. The switch was put back.");
    });
  }

  fetch("/api/approvals")
    .then(function (res) {
      return res.json().then(function (body) {
        return { ok: res.ok, body: body };
      });
    })
    .then(function (result) {
      if (!result.ok || !result.body || !Array.isArray(result.body.items)) {
        setStatus((result.body && result.body.error) || "Could not load approvals.");
        return;
      }
      items = result.body.items;
      render();
    })
    .catch(function () {
      setStatus("Could not load approvals.");
    });
})();
