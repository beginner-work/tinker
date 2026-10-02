/* Practice streak — consecutive weekdays with a passing rep (localStorage). */
(function (root) {
  "use strict";

  var KEY = "tinker_practice_streak_v1";
  var ESSAY_KEY = "tinker_practice_essays_v1";

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function todayYmd(d) {
    var date = d || new Date();
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function parseYmd(ymd) {
    var m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  }

  function isWeekday(d) {
    var day = d.getDay();
    return day !== 0 && day !== 6;
  }

  function previousWeekdayYmd(ymd) {
    var d = parseYmd(ymd);
    if (!d) return "";
    do {
      d.setDate(d.getDate() - 1);
    } while (!isWeekday(d));
    return todayYmd(d);
  }

  function readState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return { count: 0, lastPassYmd: "", passes: {} };
      var parsed = JSON.parse(raw);
      return {
        count: Number(parsed.count) || 0,
        lastPassYmd: typeof parsed.lastPassYmd === "string" ? parsed.lastPassYmd : "",
        passes: parsed.passes && typeof parsed.passes === "object" ? parsed.passes : {},
      };
    } catch (err) {
      return { count: 0, lastPassYmd: "", passes: {} };
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) { /* prototype: ignore quota */ }
  }

  function recordPass(repId, when) {
    var state = readState();
    var ymd = todayYmd(when);
    var day = when || new Date();
    state.passes[repId] = ymd;

    if (!isWeekday(day)) {
      writeState(state);
      return state;
    }

    if (state.lastPassYmd === ymd) {
      writeState(state);
      return state;
    }

    if (state.lastPassYmd && previousWeekdayYmd(ymd) === state.lastPassYmd) {
      state.count = (state.count || 0) + 1;
    } else {
      state.count = 1;
    }
    state.lastPassYmd = ymd;
    writeState(state);
    return state;
  }

  function getStreak() {
    return readState().count || 0;
  }

  function saveEssay(repId, text) {
    var all = {};
    try {
      all = JSON.parse(localStorage.getItem(ESSAY_KEY) || "{}") || {};
    } catch (err) {
      all = {};
    }
    all[repId] = {
      text: String(text || ""),
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(ESSAY_KEY, JSON.stringify(all));
    } catch (err) { /* ignore */ }
    try {
      console.log("[practice] essay draft saved", repId, all[repId]);
    } catch (err2) { /* ignore */ }
    return all[repId];
  }

  function readEssay(repId) {
    try {
      var all = JSON.parse(localStorage.getItem(ESSAY_KEY) || "{}") || {};
      return all[repId] || null;
    } catch (err) {
      return null;
    }
  }

  root.tinkerPracticeStreak = {
    KEY: KEY,
    ESSAY_KEY: ESSAY_KEY,
    todayYmd: todayYmd,
    isWeekday: isWeekday,
    previousWeekdayYmd: previousWeekdayYmd,
    readState: readState,
    recordPass: recordPass,
    getStreak: getStreak,
    saveEssay: saveEssay,
    readEssay: readEssay,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) {
  module.exports = globalThis.tinkerPracticeStreak;
}
