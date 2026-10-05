/* /exercises - owner-only list of learning modules from the manifest.
 *
 * Sign-in is the same Stytch session as the rest of tinker. Nothing is
 * stored about visitors here. Open in IDE uses the desktop bridge when
 * present; otherwise it falls back to GitHub.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var statusEl = document.getElementById("exercises-status");
  var listEl = document.getElementById("exercises-list");
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

  function githubUrl(moduleId) {
    if (openApi && typeof openApi.githubModuleUrl === "function") {
      return openApi.githubModuleUrl(moduleId);
    }
    return "https://github.com/tlindow/lindowlabs/tree/main/exercises/" +
      encodeURIComponent(moduleId);
  }

  function onOpenClick(moduleId, button) {
    if (!openApi || typeof openApi.openModule !== "function") return;
    button.disabled = true;
    setStatus("Opening…");
    openApi.openModule(moduleId).then(function (result) {
      button.disabled = false;
      if (result && result.ok === false) {
        setStatus(result.error || "Could not open that module.", true);
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

  function render() {
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
      openBtn.textContent = "Open in IDE";
      openBtn.addEventListener("click", function () {
        onOpenClick(id, openBtn);
      });
      actions.appendChild(openBtn);

      var gh = document.createElement("a");
      gh.className = "exercises__github";
      gh.href = githubUrl(id);
      gh.target = "_blank";
      gh.rel = "noopener noreferrer";
      gh.textContent = "View on GitHub";
      actions.appendChild(gh);

      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  render();
})();
