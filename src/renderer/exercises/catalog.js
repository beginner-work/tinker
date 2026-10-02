/* Current Lindow Labs coding exercises (repo-relative paths for Cursor). */
(function (root) {
  "use strict";

  var EXERCISES = [
    {
      id: "pacific-wall-time",
      title: "Keep 9:00 AM after daylight saving ends",
      description: "Keep a saved America/Los_Angeles wall time at 9:00 AM across the 2026 DST fall-back.",
      path: "exercises/pacific-wall-time.js",
      status: "open",
    },
    {
      id: "mark-touch-sent",
      title: "Sending a touch marks it sent",
      description: "When a touch is marked sent, its status must become \"sent\" instead of staying \"planned\".",
      path: "exercises/mark-touch-sent.js",
      status: "open",
    },
    {
      id: "stripe-payment-intent",
      title: "Stripe PaymentIntent (test mode)",
      description: "Read client_secret, amount, and currency from a PaymentIntent create fixture — no live API key.",
      path: "exercises/stripe-payment-intent.js",
      status: "open",
    },
  ];

  var STATUS_KEY = "tinker.exerciseStatus.v1";

  function readStatusMap() {
    try {
      var raw = localStorage.getItem(STATUS_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function listExercises() {
    var statuses = readStatusMap();
    return EXERCISES.map(function (row) {
      var status = statuses[row.id] || row.status || "open";
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        path: row.path,
        status: status === "done" ? "done" : "open",
      };
    });
  }

  function setExerciseStatus(id, status) {
    var statuses = readStatusMap();
    statuses[String(id || "")] = status === "done" ? "done" : "open";
    try { localStorage.setItem(STATUS_KEY, JSON.stringify(statuses)); } catch (e) { /* ignore */ }
  }

  root.tinkerExercises = {
    listExercises: listExercises,
    setExerciseStatus: setExerciseStatus,
    CURSOR_ROOT_KEY: "tinker.cursorProjectRoot",
  };
})(typeof window !== "undefined" ? window : globalThis);
