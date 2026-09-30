/* /settings — owner profile + reflection webhook (outreach lives in lead-drafts.js). */
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
  function setStatus(sel, msg, isError) {
    var el = document.querySelector(sel);
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
      ? String(p.linkedInUrl || p.linkedinUrl) : "";
  }
  function load() {
    if (!token()) { setStatus("[data-owner-profile-status]", "Sign in to edit your profile.", true); return Promise.resolve(); }
    return fetch("/api/user-data/profile", { headers: authHeaders() })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        profile = json && json.data && typeof json.data === "object" ? json.data : {};
        fillFields();
      })
      .catch(function () {
        profile = {};
        setStatus("[data-owner-profile-status]", "Profile could not load right now.", true);
      });
  }
  function save() {
    if (!token()) { setStatus("[data-owner-profile-status]", "Sign in to edit your profile.", true); return; }
    var titleInput = document.querySelector("[data-owner-title]");
    var liInput = document.querySelector("[data-owner-linkedin]");
    var title = titleInput ? String(titleInput.value || "").trim() : "";
    var linkedInUrl = liInput ? String(liInput.value || "").trim() : "";
    if (linkedInUrl && !/^https?:\/\//i.test(linkedInUrl)) {
      setStatus("[data-owner-profile-status]", "LinkedIn URL must start with http:// or https://.", true);
      return;
    }
    var next = Object.assign({}, profile || {}, { title: title, linkedInUrl: linkedInUrl });
    delete next.linkedinUrl;
    var btn = document.querySelector("[data-owner-profile-save]");
    if (btn) btn.disabled = true;
    setStatus("[data-owner-profile-status]", "Saving…");
    fetch("/api/user-data/profile", {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ data: next }),
    }).then(function (res) {
      if (!res.ok) throw new Error("save-failed");
      profile = next;
      setStatus("[data-owner-profile-status]", "Saved.");
    }).catch(function () {
      setStatus("[data-owner-profile-status]", "Could not save right now.", true);
    }).finally(function () { if (btn) btn.disabled = false; });
  }
  function showWebhookHints(json) {
    [["url", json && json.urlHint], ["auth", json && json.authorizationHint]].forEach(function (pair) {
      var el = document.querySelector("[data-reflection-webhook-" + pair[0] + "-hint]");
      if (!el) return;
      if (json && json.configured && pair[1]) {
        el.hidden = false;
        el.textContent = "Saved: " + pair[1];
      } else { el.hidden = true; el.textContent = ""; }
    });
  }
  function loadWebhook() {
    if (!token()) return Promise.resolve();
    return fetch("/api/reflection-webhook", { headers: authHeaders() })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(showWebhookHints)
      .catch(function () { /* ignore */ });
  }
  function saveWebhook() {
    if (!token()) { setStatus("[data-reflection-webhook-status]", "Sign in to save the webhook.", true); return; }
    var urlEl = document.querySelector("[data-reflection-webhook-url]");
    var authEl = document.querySelector("[data-reflection-webhook-auth]");
    var url = urlEl ? String(urlEl.value || "").trim() : "";
    var authorization = authEl ? String(authEl.value || "").trim() : "";
    if (!url || !authorization) {
      setStatus("[data-reflection-webhook-status]", "Both URL and Authorization are required.", true);
      return;
    }
    var btn = document.querySelector("[data-reflection-webhook-save]");
    if (btn) btn.disabled = true;
    setStatus("[data-reflection-webhook-status]", "Saving…");
    fetch("/api/reflection-webhook", {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ url: url, authorization: authorization }),
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error((json && json.error) || "save-failed");
        return json;
      });
    }).then(function (json) {
      showWebhookHints(json);
      if (urlEl) urlEl.value = "";
      if (authEl) authEl.value = "";
      setStatus("[data-reflection-webhook-status]", "Saved. Secrets are masked above.");
    }).catch(function (err) {
      setStatus("[data-reflection-webhook-status]", (err && err.message) || "Could not save right now.", true);
    }).finally(function () { if (btn) btn.disabled = false; });
  }
  function clearWebhook() {
    if (!token()) { setStatus("[data-reflection-webhook-status]", "Sign in to clear the webhook.", true); return; }
    var btn = document.querySelector("[data-reflection-webhook-clear]");
    if (btn) btn.disabled = true;
    setStatus("[data-reflection-webhook-status]", "Clearing…");
    fetch("/api/reflection-webhook", { method: "DELETE", headers: authHeaders() })
      .then(function (res) {
        if (!res.ok) throw new Error("clear-failed");
        return res.json();
      })
      .then(function (json) {
        showWebhookHints(json);
        var urlEl = document.querySelector("[data-reflection-webhook-url]");
        var authEl = document.querySelector("[data-reflection-webhook-auth]");
        if (urlEl) urlEl.value = "";
        if (authEl) authEl.value = "";
        setStatus("[data-reflection-webhook-status]", "Cleared.");
      })
      .catch(function () {
        setStatus("[data-reflection-webhook-status]", "Could not clear right now.", true);
      })
      .finally(function () { if (btn) btn.disabled = false; });
  }
  function boot() {
    var saveBtn = document.querySelector("[data-owner-profile-save]");
    if (saveBtn) saveBtn.addEventListener("click", save);
    var whSave = document.querySelector("[data-reflection-webhook-save]");
    var whClear = document.querySelector("[data-reflection-webhook-clear]");
    if (whSave) whSave.addEventListener("click", saveWebhook);
    if (whClear) whClear.addEventListener("click", clearWebhook);
    load();
    loadWebhook();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
