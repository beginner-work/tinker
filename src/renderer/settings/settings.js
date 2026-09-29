/* /settings — owner profile title + LinkedIn URL (outreach lives in lead-drafts.js). */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var profile = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function authHeaders() {
    return { Authorization: "Bearer " + token(), Accept: "application/json" };
  }
  function statusEl() {
    return document.querySelector("[data-owner-profile-status]");
  }
  function setStatus(msg, isError) {
    var el = statusEl();
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = msg;
    el.style.color = isError ? "var(--color-danger, #b42318)" : "var(--color-muted)";
  }
  function fillFields() {
    var title = document.querySelector("[data-owner-title]");
    var li = document.querySelector("[data-owner-linkedin]");
    var p = profile || {};
    if (title) title.value = p.title ? String(p.title) : "";
    if (li) li.value = p.linkedInUrl || p.linkedinUrl
      ? String(p.linkedInUrl || p.linkedinUrl)
      : "";
  }
  function load() {
    if (!token()) { setStatus("Sign in to edit your profile.", true); return Promise.resolve(); }
    return fetch("/api/user-data/profile", { headers: authHeaders() })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        profile = json && json.data && typeof json.data === "object" ? json.data : {};
        fillFields();
      })
      .catch(function () {
        profile = {};
        setStatus("Profile could not load right now.", true);
      });
  }
  function save() {
    if (!token()) { setStatus("Sign in to edit your profile.", true); return; }
    var titleInput = document.querySelector("[data-owner-title]");
    var liInput = document.querySelector("[data-owner-linkedin]");
    var title = titleInput ? String(titleInput.value || "").trim() : "";
    var linkedInUrl = liInput ? String(liInput.value || "").trim() : "";
    if (linkedInUrl && !/^https?:\/\//i.test(linkedInUrl)) {
      setStatus("LinkedIn URL must start with http:// or https://.", true);
      return;
    }
    var next = Object.assign({}, profile || {}, {
      title: title,
      linkedInUrl: linkedInUrl,
    });
    delete next.linkedinUrl;
    var btn = document.querySelector("[data-owner-profile-save]");
    if (btn) btn.disabled = true;
    setStatus("Saving…");
    fetch("/api/user-data/profile", {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ data: next }),
    }).then(function (res) {
      if (!res.ok) throw new Error("save-failed");
      profile = next;
      setStatus("Saved.");
    }).catch(function () {
      setStatus("Could not save right now.", true);
    }).finally(function () {
      if (btn) btn.disabled = false;
    });
  }
  function boot() {
    var saveBtn = document.querySelector("[data-owner-profile-save]");
    if (saveBtn) saveBtn.addEventListener("click", save);
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
