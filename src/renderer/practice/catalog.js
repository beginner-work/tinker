/* Practice catalog helpers (list page). */
(function (root) {
  "use strict";

  function listReps() {
    return Array.isArray(root.TINKER_PRACTICE_REPS) ? root.TINKER_PRACTICE_REPS.slice() : [];
  }

  function findRep(id) {
    var reps = listReps();
    for (var i = 0; i < reps.length; i++) {
      if (reps[i] && reps[i].id === id) return reps[i];
    }
    return null;
  }

  root.tinkerPracticeCatalog = {
    listReps: listReps,
    findRep: findRep,
  };
})(window);
