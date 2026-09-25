/* /autonomy
 *
 * Same sign-in as the rest of tinker: a Stytch session in
 * localStorage.tinker_jwt. The list comes from GET /api/autonomy.
 * Labels, scope lines, and the send note come from catalog.js
 * (window.tinkerAutonomy), the same list the connector tool reads.
 * Each switch PUTs {autonomous}. A note PUTs {note}. Text is assigned
 * with textContent so a note cannot become HTML.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var listEl = document.getElementById("autonomy-list");
  var statusEl = document.getElementById("autonomy-status");
  var items = [];

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (err) { return ""; }
  }

  function sendHome() {
    try { sessionStorage.setItem(RETURN_KEY, "/autonomy"); }
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

  function catalogDef(key) {
    var items = (window.tinkerAutonomy && window.tinkerAutonomy.AUTONOMY_ITEMS) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].key === key) return items[i];
    }
    return null;
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
      timeZone: "America/Los_Angeles",
    });
    return "Changed by " + who + " on " + date + " PT";
  }

  function applySaved(item, saved) {
    item.autonomous = saved.autonomous;
    item.note = saved.note;
    item.updated_by = saved.updated_by;
    item.updated_at = saved.updated_at;
    if (saved.send_note) item.send_note = saved.send_note;
  }

  function putItem(item, body) {
    return fetch("/api/autonomy/" + encodeURIComponent(item.key), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (payload) {
        return { status: res.status, body: payload };
      }, function () {
        return { status: res.status, body: null };
      });
    });
  }

  function render() {
    listEl.replaceChildren();
    items.forEach(function (item, index) {
      var row = document.createElement("li");
      row.className = "autonomy__row";

      var def = catalogDef(item.key);
      var labelText = def ? def.label : item.label;
      var description = def && def.description ? def.description : "";
      var sendNote = def ? def.send_note : item.send_note;

      var label = document.createElement("span");
      label.className = "autonomy__label";
      label.id = "autonomy-label-" + index;
      label.textContent = labelText;
      if (description) label.setAttribute("data-scope", description);

      var button = document.createElement("button");
      button.type = "button";
      button.className = "autonomy__switch";
      button.setAttribute("role", "switch");
      button.setAttribute("aria-checked", item.autonomous ? "true" : "false");
      button.setAttribute("aria-labelledby", label.id);
      button.addEventListener("click", function () { toggle(item, button); });

      var meta = document.createElement("p");
      meta.className = "autonomy__meta";
      meta.textContent = changedLine(item);

      row.appendChild(label);
      row.appendChild(button);
      row.appendChild(meta);

      if (sendNote) {
        var send = document.createElement("p");
        send.className = "autonomy__send";
        send.textContent = sendNote;
        row.appendChild(send);
      }

      if (!item.autonomous) {
        var form = document.createElement("form");
        form.className = "autonomy__form";
        var input = document.createElement("textarea");
        input.className = "autonomy__input";
        input.rows = 2;
        input.maxLength = 500;
        input.placeholder = "only after X, or tell me first when Y";
        input.value = item.note || "";
        input.setAttribute("aria-label", "Instructions for " + labelText);
        var save = document.createElement("button");
        save.type = "submit";
        save.className = "autonomy__save";
        save.textContent = "Save";
        form.appendChild(input);
        form.appendChild(save);
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          saveNote(item, input, save);
        });
        row.appendChild(form);
      } else if (item.note) {
        var saved = document.createElement("p");
        saved.className = "autonomy__saved";
        saved.textContent = item.note;
        row.appendChild(saved);
      }

      listEl.appendChild(row);
    });
  }

  function toggle(item, button) {
    var previous = {
      autonomous: item.autonomous,
      note: item.note,
      updated_by: item.updated_by,
      updated_at: item.updated_at,
    };
    var next = !item.autonomous;
    item.autonomous = next;
    button.setAttribute("aria-checked", next ? "true" : "false");
    button.disabled = true;
    setStatus("");

    putItem(item, { autonomous: next }).then(function (result) {
      button.disabled = false;
      if (result.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
        sendHome();
        return;
      }
      if (result.status !== 200 || !result.body || typeof result.body.autonomous !== "boolean") {
        item.autonomous = previous.autonomous;
        item.note = previous.note;
        item.updated_by = previous.updated_by;
        item.updated_at = previous.updated_at;
        render();
        setStatus((result.body && result.body.error) || "Could not save. The switch was put back.");
        return;
      }
      applySaved(item, result.body);
      render();
    }).catch(function () {
      item.autonomous = previous.autonomous;
      item.note = previous.note;
      item.updated_by = previous.updated_by;
      item.updated_at = previous.updated_at;
      render();
      setStatus("Could not save. The switch was put back.");
    });
  }

  function saveNote(item, input, save) {
    save.disabled = true;
    setStatus("");
    putItem(item, { note: input.value }).then(function (result) {
      save.disabled = false;
      if (result.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
        sendHome();
        return;
      }
      if (result.status !== 200 || !result.body) {
        setStatus((result.body && result.body.error) || "Could not save the note.");
        return;
      }
      applySaved(item, result.body);
      render();
    }).catch(function () {
      save.disabled = false;
      setStatus("Could not save the note.");
    });
  }

  fetch("/api/autonomy", {
    headers: { Authorization: "Bearer " + token() },
  })
    .then(function (res) {
      return res.json().then(function (body) {
        return { status: res.status, body: body };
      }, function () {
        return { status: res.status, body: null };
      });
    })
    .then(function (result) {
      if (result.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
        sendHome();
        return;
      }
      if (result.status !== 200 || !result.body || !Array.isArray(result.body.items)) {
        setStatus((result.body && result.body.error) || "Could not load autonomy.");
        return;
      }
      items = result.body.items;
      render();
    })
    .catch(function () {
      setStatus("Could not load autonomy.");
    });
})();
