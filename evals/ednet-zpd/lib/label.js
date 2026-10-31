"use strict";

/**
 * Ground-truth ZPD bands from KT3-style streams.
 *
 * correct unaided                              → too_easy
 * wrong unaided, then correct after help       → in_zpd
 * wrong, still wrong after help                → too_hard
 */

const HELP_ACTIONS = new Set([
  "enter",
  "lecture",
  "explanation",
  "watch_lecture",
  "read_explanation",
]);

const RESPOND_ACTIONS = new Set(["respond", "answer", "submit", "response"]);

function isHelp(action) {
  const a = String(action || "").toLowerCase();
  if (HELP_ACTIONS.has(a)) return true;
  return (
    a.includes("lecture") || a.includes("explanation") || a.includes("video")
  );
}

function isRespond(action) {
  const a = String(action || "").toLowerCase();
  return RESPOND_ACTIONS.has(a);
}

function normalizeTags(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
  }
  const s = String(value).trim();
  if (!s) return [];
  if (s.includes(";")) return s.split(";").map((x) => x.trim()).filter(Boolean);
  if (s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
  return [s];
}

/**
 * @param {object[]} events chronological for one user
 * @param {{ minHistory?: number }} [opts]
 */
function labelUserEvents(events, opts) {
  const minHistory = (opts && opts.minHistory) || 2;
  const sorted = [...(events || [])].sort(
    (a, b) => Number(a.timestamp) - Number(b.timestamp),
  );

  /** @type {{conceptId:string, correct:boolean, t:number}[]} */
  const responseHistory = [];
  /** @type {Map<string, {seenWrong:boolean, seenHelpAfterWrong:boolean}>} */
  const track = new Map();
  const probes = [];

  function stateFor(conceptId) {
    if (!track.has(conceptId)) {
      track.set(conceptId, { seenWrong: false, seenHelpAfterWrong: false });
    }
    return track.get(conceptId);
  }

  for (const ev of sorted) {
    const tags = normalizeTags(ev.tags || ev.tag || ev.skill_id);
    const t = Number(ev.timestamp) || 0;
    const action = ev.action_type || ev.actionType || ev.action || "";
    const conceptIds = tags.length ? tags : [];

    if (isHelp(action)) {
      for (const conceptId of conceptIds.length ? conceptIds : []) {
        const st = stateFor(conceptId);
        if (st.seenWrong) st.seenHelpAfterWrong = true;
      }
      continue;
    }

    if (!isRespond(action) || ev.correct == null) continue;

    const correct = Boolean(
      ev.correct === true ||
        ev.correct === 1 ||
        ev.correct === "1" ||
        String(ev.correct).toLowerCase() === "true",
    );

    for (const conceptId of conceptIds.length ? conceptIds : ["_general"]) {
      const st = stateFor(conceptId);
      const histForConcept = responseHistory.filter(
        (h) => h.conceptId === conceptId,
      );

      /** @type {import('../../../packages/context-model/src/schema.js').ZpdBand | null} */
      let band = null;
      if (correct && !st.seenWrong) {
        band = "too_easy";
      } else if (correct && st.seenWrong && st.seenHelpAfterWrong) {
        band = "in_zpd";
      } else if (!correct && st.seenHelpAfterWrong) {
        band = "too_hard";
      }

      if (band && histForConcept.length >= minHistory) {
        probes.push({
          userId: String(ev.userId),
          conceptId,
          timestamp: t,
          band,
          nextCorrect: correct,
          history: histForConcept.map((h) => ({
            conceptId: h.conceptId,
            correct: h.correct,
          })),
          fullHistory: responseHistory.map((h) => ({
            conceptId: h.conceptId,
            correct: h.correct,
          })),
        });
      }

      responseHistory.push({ conceptId, correct, t });

      if (!correct) {
        st.seenWrong = true;
        // New wrong after prior help clears the "helped" latch until next help.
        // Keep seenHelpAfterWrong so immediate post-help wrongs stay too_hard.
      } else if (correct && st.seenHelpAfterWrong) {
        // Mastered after help: reset window.
        st.seenWrong = false;
        st.seenHelpAfterWrong = false;
      }
    }
  }

  return probes;
}

function labelEvents(events, opts) {
  /** @type {Map<string, object[]>} */
  const byUser = new Map();
  for (const ev of events || []) {
    const uid = String(ev.userId);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(ev);
  }
  const probes = [];
  for (const [, list] of byUser) {
    probes.push(...labelUserEvents(list, opts));
  }
  return probes;
}

module.exports = {
  HELP_ACTIONS,
  RESPOND_ACTIONS,
  isHelp,
  isRespond,
  normalizeTags,
  labelUserEvents,
  labelEvents,
};
