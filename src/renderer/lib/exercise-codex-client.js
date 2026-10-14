/* Coordinates local generation with authenticated, conflict-checked persistence. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.tinkerExerciseCodexClient = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function createClient(options) {
    var active = null;
    function cancel() {
      if (!active || active.applying) return false;
      active.cancelled = true;
      if (active.controller) active.controller.abort();
      Promise.resolve(options.bridge.cancelCodexExerciseRevision()).catch(function () {});
      return true;
    }
    async function request(job, action, body) {
      var controller = new AbortController();
      job.controller = controller;
      var timer = setTimeout(function () { controller.abort(); }, options.requestTimeoutMs || 30000);
      try {
        return await options.api("POST", action, body, { signal: controller.signal });
      } catch (err) {
        if (job.cancelled) throw new Error("Exercise revision cancelled. No changes saved.");
        if (controller.signal.aborted) {
          throw new Error(job.applying ? "The save could not be confirmed. Reload the exercise before retrying." : "Loading the exercise timed out. Retry when your connection is ready.");
        }
        throw err;
      } finally {
        clearTimeout(timer);
        job.controller = null;
      }
    }
    async function revise(exerciseId, essayBody) {
      if (active) throw new Error("An exercise revision is already running.");
      var job = { cancelled: false, applying: false, session: options.session() };
      active = job;
      function check() {
        if (job.cancelled) throw new Error("Exercise revision cancelled. No changes saved.");
        if (!job.session || options.session() !== job.session) {
          throw new Error("Your sign-in changed. Retry the exercise revision.");
        }
      }
      try {
        check();
        var prepared = await request(job, "prepare_revision", { exerciseId: exerciseId, essayBody: essayBody });
        check();
        var revision = await options.bridge.reviseExerciseWithCodex({
          exerciseId: prepared.exerciseId,
          exerciseName: prepared.exerciseName,
          essayBody: prepared.essayBody,
          files: prepared.files.map(function (f) { return { path: f.path, content: f.content }; }),
        });
        check();
        // Once the save starts, cancellation cannot promise to undo a commit.
        job.applying = true;
        var result = await request(job, "apply_revision", {
          exerciseId: exerciseId, essayBody: essayBody,
          baseFingerprint: prepared.baseFingerprint, revision: revision,
        });
        check();
        return result;
      } finally {
        if (active === job) active = null;
      }
    }
    return { revise: revise, cancel: cancel };
  }
  return { createClient: createClient };
});
