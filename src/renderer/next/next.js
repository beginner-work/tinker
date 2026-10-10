/* /next — deep link to the signed-in owner's next unfinished exercise.
 *
 * Resumes the last file bookmark when present, then lands on /repo.
 * Optional ?lockin=1 (or desktop hotspot trigger) starts the lock-in moment.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";
  var statusEl = document.getElementById("next-status");

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (err) { return ""; }
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function wantsLockIn() {
    try {
      return /(?:^|[?&])lockin=1(?:&|$)/.test(window.location.search || "");
    } catch (e) {
      return false;
    }
  }

  if (!token()) {
    try { sessionStorage.setItem(RETURN_KEY, "/next" + (wantsLockIn() ? "?lockin=1" : "")); }
    catch (err) { /* sign-in still works */ }
    window.location.assign("/");
    return;
  }

  var nextApi = window.tinkerExercisesNext;
  var manifest = window.tinkerExercisesManifest;
  if (!nextApi || !manifest) {
    setStatus("Could not load exercises.");
    return;
  }

  var picked = nextApi.pickNextExercise({
    modules: manifest.modules,
    storage: window.localStorage,
    pickApi: window.tinkerExercisesPick,
  });

  if (!picked) {
    setStatus("You're caught up — no unfinished exercises.");
    setTimeout(function () {
      window.location.assign("/repo");
    }, 1200);
    return;
  }

  setStatus("Opening " + picked.name + "…");
  var url = nextApi.buildNextRepoUrl(picked, {
    lockIn: wantsLockIn(),
    from: "next",
  });
  window.location.replace(url);
})();
