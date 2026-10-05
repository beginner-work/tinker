/* /exercises - owner-only list of Tinker learning modules from the manifest.
 *
 * Sign-in is the same Stytch session as the rest of tinker. Nothing is
 * stored about visitors here. Open in IDE uses the desktop bridge when
 * present; otherwise it falls back to GitHub. External modules open their
 * link. Tinker never stores non-owners' writing.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var statusEl = document.getElementById("exercises-status");
  var listEl = document.getElementById("exercises-list");
  var readingEl = document.getElementById("exercises-reading-list");
  var manifest = window.tinkerExercisesManifest;
  var openApi = window.tinkerExercisesOpen;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (err) { return ""; }
  }

  function sendHome() {
    try { sessionStorage.setItem(RETURN_KEY, "/exercises"); }
    catch (err) { /* sign-in still works without the return */ }
    window.location.assign("/");
  }

  if (!token()) {
    sendHome();
    return;
  }

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    if (isError) statusEl.classList.add("is-error");
    else statusEl.classList.remove("is-error");
  }

  function moduleUrl(mod) {
    if (mod && mod.externalUrl) return String(mod.externalUrl);
    if (openApi && typeof openApi.githubModuleUrl === "function") {
      return openApi.githubModuleUrl(mod && mod.id);
    }
    if (mod && mod.path) {
      return (
        "https://github.com/beginner-work/tinker/blob/main/" +
        String(mod.path).replace(/^\/+/, "")
      );
    }
    return (
      "https://github.com/beginner-work/tinker/tree/main/exercises/" +
      encodeURIComponent(String(mod && mod.id || ""))
    );
  }

  function onOpenClick(mod, button) {
    if (!openApi || typeof openApi.openModule !== "function") return;
    var id = String(mod && mod.id || "").trim();
    button.disabled = true;
    setStatus("Opening…");
    openApi.openModule(id).then(function (result) {
      button.disabled = false;
      if (window.tinkerExercisesPick && typeof window.tinkerExercisesPick.markOpened === "function") {
        window.tinkerExercisesPick.markOpened(id, window.localStorage);
      }
      if (result && result.ok === false) {
        setStatus(result.error || "Could not open that module.", true);
        return;
      }
      if (result && result.via === "external") {
        setStatus("Opened externally.");
        return;
      }
      if (result && result.via === "github") {
        setStatus("Opened on GitHub (local IDE open needs the desktop app).");
        return;
      }
      setStatus(result && result.message ? result.message : "Opened.");
    }).catch(function (err) {
      button.disabled = false;
      setStatus((err && err.message) || "Could not open that module.", true);
    });
  }

  function metaLine(topic, status) {
    var parts = [];
    if (status) parts.push(String(status));
    if (topic) parts.push(String(topic));
    return parts.join(" · ");
  }

  function renderModules() {
    if (!listEl) return;
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    var modules = (manifest && Array.isArray(manifest.modules)) ? manifest.modules : [];
    if (!modules.length) {
      var empty = document.createElement("li");
      empty.className = "exercises__row";
      var emptyText = document.createElement("p");
      emptyText.className = "exercises__desc";
      emptyText.textContent = "No modules in the manifest yet.";
      empty.appendChild(emptyText);
      listEl.appendChild(empty);
      return;
    }

    modules.forEach(function (mod) {
      var id = String(mod.id || "").trim();
      if (!id) return;
      var row = document.createElement("li");
      row.className = "exercises__row";
      row.setAttribute("data-module-id", id);

      var meta = document.createElement("p");
      meta.className = "exercises__meta";
      meta.textContent = metaLine(mod.topic, mod.status);
      if (meta.textContent) row.appendChild(meta);

      var name = document.createElement("h2");
      name.className = "exercises__name";
      name.textContent = String(mod.name || id);
      row.appendChild(name);

      var desc = document.createElement("p");
      desc.className = "exercises__desc";
      desc.textContent = String(mod.description || "");
      row.appendChild(desc);

      var actions = document.createElement("div");
      actions.className = "exercises__actions";

      var openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "exercises__open";
      openBtn.textContent = mod.externalUrl ? "Open link" : "Open in IDE";
      openBtn.addEventListener("click", function () {
        onOpenClick(mod, openBtn);
      });
      actions.appendChild(openBtn);

      var gh = document.createElement("a");
      gh.className = "exercises__github";
      gh.href = moduleUrl(mod);
      gh.target = "_blank";
      gh.rel = "noopener noreferrer";
      gh.textContent = mod.externalUrl ? "Open Formation" : "View on GitHub";
      actions.appendChild(gh);

      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function externalAnchor(href, label, className) {
    var a = document.createElement("a");
    a.className = className || "exercises__reading-link";
    a.href = String(href || "");
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = String(label || href || "");
    return a;
  }

  function renderReadings() {
    if (!readingEl) return;
    while (readingEl.firstChild) readingEl.removeChild(readingEl.firstChild);
    // Manifest order is the reading plan order.
    var readings = (manifest && Array.isArray(manifest.readings)) ? manifest.readings : [];
    if (!readings.length) {
      var empty = document.createElement("li");
      empty.className = "exercises__row";
      var emptyText = document.createElement("p");
      emptyText.className = "exercises__desc";
      emptyText.textContent = "No readings in the manifest yet.";
      empty.appendChild(emptyText);
      readingEl.appendChild(empty);
      return;
    }

    readings.forEach(function (book) {
      var row = document.createElement("li");
      row.className = "exercises__row";
      if (book.id) row.setAttribute("data-reading-id", String(book.id));

      var topic = String(book.topic || "").trim();
      if (topic) {
        var meta = document.createElement("p");
        meta.className = "exercises__meta";
        meta.textContent = topic;
        row.appendChild(meta);
      }

      var name = document.createElement("h3");
      name.className = "exercises__name";
      var title = String(book.name || "");
      var topLink = String(book.link || "").trim();
      if (topLink) {
        name.appendChild(externalAnchor(topLink, title, "exercises__reading-title-link"));
      } else {
        name.textContent = title;
      }
      row.appendChild(name);

      if (book.author) {
        var author = document.createElement("p");
        author.className = "exercises__author";
        author.textContent = String(book.author);
        row.appendChild(author);
      }

      if (book.note) {
        var note = document.createElement("p");
        note.className = "exercises__desc";
        note.textContent = String(book.note);
        row.appendChild(note);
      }

      var childLinks = Array.isArray(book.links) ? book.links : [];
      if (childLinks.length) {
        var linkList = document.createElement("ul");
        linkList.className = "exercises__reading-links";
        childLinks.forEach(function (item) {
          if (!item || !item.url) return;
          var li = document.createElement("li");
          li.className = "exercises__reading-links-item";
          li.appendChild(
            externalAnchor(item.url, item.label || item.url, "exercises__reading-link")
          );
          linkList.appendChild(li);
        });
        row.appendChild(linkList);
      }

      readingEl.appendChild(row);
    });
  }

  renderModules();
  renderReadings();
})();
