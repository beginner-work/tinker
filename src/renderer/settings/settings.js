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

  function exercisesBridge() {
    var tinker = window.tinker;
    if (!tinker || typeof tinker.getExerciseLabSettings !== "function") return null;
    return tinker;
  }

  function fillExercisesLab(settings) {
    var pathInput = document.querySelector("[data-exercises-clone-path]");
    var ideInput = document.querySelector("[data-exercises-ide-command]");
    var defHint = document.querySelector("[data-exercises-clone-default]");
    if (pathInput) pathInput.value = settings && settings.clonePath ? String(settings.clonePath) : "";
    if (ideInput) ideInput.value = settings && settings.ideCommand ? String(settings.ideCommand) : "";
    if (defHint && settings && settings.defaultClonePath) {
      defHint.textContent = "Default when blank: " + settings.defaultClonePath;
    }
  }

  function loadExercisesLab() {
    var section = document.getElementById("settings-exercises");
    var bridge = exercisesBridge();
    if (!section) return Promise.resolve();
    if (!bridge) {
      section.hidden = true;
      return Promise.resolve();
    }
    section.hidden = false;
    return bridge.getExerciseLabSettings().then(function (settings) {
      fillExercisesLab(settings || {});
    }).catch(function () {
      setStatus("[data-exercises-lab-status]", "Could not load exercises settings.", true);
    });
  }

  function saveExercisesLab() {
    var bridge = exercisesBridge();
    if (!bridge || typeof bridge.setExerciseLabSettings !== "function") {
      setStatus("[data-exercises-lab-status]", "Exercises settings need the desktop app.", true);
      return;
    }
    var pathInput = document.querySelector("[data-exercises-clone-path]");
    var ideInput = document.querySelector("[data-exercises-ide-command]");
    var btn = document.querySelector("[data-exercises-lab-save]");
    if (btn) btn.disabled = true;
    setStatus("[data-exercises-lab-status]", "Saving…");
    bridge.setExerciseLabSettings({
      clonePath: pathInput ? String(pathInput.value || "").trim() : "",
      ideCommand: ideInput ? String(ideInput.value || "").trim() : "",
    }).then(function (settings) {
      fillExercisesLab(settings || {});
      setStatus("[data-exercises-lab-status]", "Saved.");
    }).catch(function () {
      setStatus("[data-exercises-lab-status]", "Could not save right now.", true);
    }).finally(function () { if (btn) btn.disabled = false; });
  }

  function pickExercisesLabPath() {
    var bridge = exercisesBridge();
    if (!bridge || typeof bridge.pickExerciseLabPath !== "function") {
      setStatus("[data-exercises-lab-status]", "Choosing a folder needs the desktop app.", true);
      return;
    }
    setStatus("[data-exercises-lab-status]", "Choose a folder…");
    bridge.pickExerciseLabPath().then(function (settings) {
      if (!settings) {
        setStatus("[data-exercises-lab-status]", "");
        return;
      }
      fillExercisesLab(settings);
      setStatus("[data-exercises-lab-status]", "Clone folder updated.");
    }).catch(function () {
      setStatus("[data-exercises-lab-status]", "Could not update the clone folder.", true);
    });
  }

  function hotspotBridge() {
    var tinker = window.tinker;
    if (!tinker || typeof tinker.getHotspotSettings !== "function") return null;
    return tinker;
  }

  function fillHotspot(settings) {
    var ssidInput = document.querySelector("[data-hotspot-ssid]");
    var enabled = document.querySelector("[data-hotspot-enabled]");
    if (ssidInput) ssidInput.value = settings && settings.ssid ? String(settings.ssid) : "";
    if (enabled) enabled.checked = !!(settings && settings.enabled);
  }

  function loadHotspot() {
    var section = document.getElementById("settings-hotspot");
    var bridge = hotspotBridge();
    if (!section) return Promise.resolve();
    if (!bridge) {
      section.hidden = true;
      return Promise.resolve();
    }
    section.hidden = false;
    var currentHint = document.querySelector("[data-hotspot-current-ssid]");
    var ssidPromise = typeof bridge.getCurrentWifiSsid === "function"
      ? bridge.getCurrentWifiSsid().catch(function () { return ""; })
      : Promise.resolve("");
    return Promise.all([
      bridge.getHotspotSettings(),
      ssidPromise,
    ]).then(function (pair) {
      fillHotspot(pair[0] || {});
      if (currentHint) {
        currentHint.textContent = pair[1]
          ? ("Currently on: " + pair[1])
          : "Currently not on Wi-Fi (or SSID unavailable).";
      }
    }).catch(function () {
      setStatus("[data-hotspot-status]", "Could not load hotspot settings.", true);
    });
  }

  function saveHotspot() {
    var bridge = hotspotBridge();
    if (!bridge || typeof bridge.setHotspotSettings !== "function") {
      setStatus("[data-hotspot-status]", "Hotspot settings need the desktop app.", true);
      return;
    }
    var ssidInput = document.querySelector("[data-hotspot-ssid]");
    var enabled = document.querySelector("[data-hotspot-enabled]");
    var btn = document.querySelector("[data-hotspot-save]");
    if (btn) btn.disabled = true;
    setStatus("[data-hotspot-status]", "Saving…");
    bridge.setHotspotSettings({
      ssid: ssidInput ? String(ssidInput.value || "").trim() : "",
      enabled: !!(enabled && enabled.checked),
    }).then(function (settings) {
      fillHotspot(settings || {});
      setStatus("[data-hotspot-status]", "Saved.");
    }).catch(function () {
      setStatus("[data-hotspot-status]", "Could not save right now.", true);
    }).finally(function () { if (btn) btn.disabled = false; });
  }

  function snoozeHotspot() {
    var bridge = hotspotBridge();
    if (!bridge || typeof bridge.snoozeHotspot !== "function") {
      setStatus("[data-hotspot-status]", "Snooze needs the desktop app.", true);
      return;
    }
    setStatus("[data-hotspot-status]", "Snoozing…");
    bridge.snoozeHotspot(60 * 60 * 1000).then(function () {
      setStatus("[data-hotspot-status]", "Snoozed for 1 hour.");
    }).catch(function () {
      setStatus("[data-hotspot-status]", "Could not snooze right now.", true);
    });
  }

  function boot() {
    var saveBtn = document.querySelector("[data-owner-profile-save]");
    if (saveBtn) saveBtn.addEventListener("click", save);
    var whSave = document.querySelector("[data-reflection-webhook-save]");
    var whClear = document.querySelector("[data-reflection-webhook-clear]");
    if (whSave) whSave.addEventListener("click", saveWebhook);
    if (whClear) whClear.addEventListener("click", clearWebhook);
    var exSave = document.querySelector("[data-exercises-lab-save]");
    var exPick = document.querySelector("[data-exercises-clone-pick]");
    if (exSave) exSave.addEventListener("click", saveExercisesLab);
    if (exPick) exPick.addEventListener("click", pickExercisesLabPath);
    var hotspotSave = document.querySelector("[data-hotspot-save]");
    var hotspotSnooze = document.querySelector("[data-hotspot-snooze]");
    if (hotspotSave) hotspotSave.addEventListener("click", saveHotspot);
    if (hotspotSnooze) hotspotSnooze.addEventListener("click", snoozeHotspot);
    load();
    loadWebhook();
    loadExercisesLab();
    loadHotspot();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
