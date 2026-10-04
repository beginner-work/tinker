/* Signed-in landing is /repo. Runs early (sync, no defer) so a stale
 * cached messages-shell.js cannot leave the old inbox / Hunt chrome up.
 * Writing stays at /?write=1. Sign-in recovery stays at /?signin=1 so a
 * stale tinker_jwt cannot bounce the owner past the phone gate.
 * Mac app still opens / until a new dmg ships.
 */
(function () {
  "use strict";
  try {
    if (!localStorage.getItem("tinker_jwt")) return;
    var q = window.location.search || "";
    if (/(?:^|[?&])write=1(?:&|$)/.test(q)) return;
    if (/(?:^|[?&])signin=1(?:&|$)/.test(q)) return;
    window.location.replace("/repo");
  } catch (e) {
    /* private mode / blocked storage */
  }
})();
