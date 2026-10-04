/* Keystroke category codes + packing/unpacking + session aggregates.
 *
 * Never stores key values or text. Packed rows are
 *   [msOffset, categoryCode] or [msOffset, categoryCode, charCount]
 * for paste/cut/IME. Categories are numeric for compact JSON.
 *
 * UMD: Node tests + browser (window.tinkerAnalyticsKeystrokes).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerAnalyticsKeystrokes = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

const CAT = {
  letter: 0,
  digit: 1,
  space: 2,
  punctuation: 3,
  enter: 4,
  backspace: 5,
  delete: 6,
  navigation: 7,
  undo: 8,
  redo: 9,
  other: 10,
  paste: 11,
  cut: 12,
  ime: 13,
  selection: 14,
  focus: 15,
  blur: 16,
};

const CAT_NAME = Object.create(null);
for (const [name, code] of Object.entries(CAT)) CAT_NAME[code] = name;

const COUNT_CATS = new Set([CAT.paste, CAT.cut, CAT.ime]);

function categorizeKey(eventLike) {
  const key = eventLike && typeof eventLike.key === "string" ? eventLike.key : "";
  const code = eventLike && typeof eventLike.code === "string" ? eventLike.code : "";
  const ctrl = !!(eventLike && (eventLike.ctrlKey || eventLike.metaKey));

  if (ctrl && (key === "z" || key === "Z")) {
    return eventLike.shiftKey ? CAT.redo : CAT.undo;
  }
  if (ctrl && (key === "y" || key === "Y")) return CAT.redo;

  if (key === "Backspace") return CAT.backspace;
  if (key === "Delete") return CAT.delete;
  if (key === "Enter") return CAT.enter;
  if (key === " " || key === "Spacebar") return CAT.space;
  if (
    key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown"
    || key === "Home" || key === "End" || key === "PageUp" || key === "PageDown"
    || key === "Tab"
  ) {
    return CAT.navigation;
  }
  if (key.length === 1) {
    if (/[0-9]/.test(key)) return CAT.digit;
    if (/[a-zA-Z]/.test(key)) return CAT.letter;
    // Any other single printable → punctuation (never store the char).
    return CAT.punctuation;
  }
  // Prefer code when key is Unidentified (mobile).
  if (/^Key[A-Z]$/.test(code)) return CAT.letter;
  if (/^Digit[0-9]$/.test(code)) return CAT.digit;
  if (code === "Space") return CAT.space;
  return CAT.other;
}

function packStroke(msOffset, category, charCount) {
  const ms = Math.max(0, Math.round(Number(msOffset) || 0));
  const cat = (category | 0);
  if (COUNT_CATS.has(cat)) {
    const n = Math.max(0, Math.min(100000, Math.round(Number(charCount) || 0)));
    return [ms, cat, n];
  }
  return [ms, cat];
}

function sanitizePacked(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const ms = Math.max(0, Math.round(Number(row[0]) || 0));
    const cat = Math.round(Number(row[1]));
    if (!Number.isFinite(ms) || !Number.isFinite(cat) || cat < 0 || cat > 16) continue;
    // Reject any accidental string payloads (would be text leakage).
    if (typeof row[0] === "string" || typeof row[1] === "string") continue;
    if (row.length >= 3 && COUNT_CATS.has(cat)) {
      const n = Math.max(0, Math.min(100000, Math.round(Number(row[2]) || 0)));
      out.push([ms, cat, n]);
    } else {
      out.push([ms, cat]);
    }
    if (out.length >= 5000) break;
  }
  return out;
}

function packedContainsText(packed, sampleText) {
  const blob = JSON.stringify(packed || []);
  const sample = String(sampleText || "");
  if (!sample) return false;
  // Any character from the typed sentence appearing as a JSON string value
  // would be leakage. Digits in ms offsets are fine; we check for quoted
  // letters from the sample.
  for (const ch of sample) {
    if (!/[a-zA-Z]/.test(ch)) continue;
    if (blob.includes('"' + ch + '"') || blob.includes("'" + ch + "'")) return true;
    // Also reject the whole word fragments.
  }
  // Whole-sentence / word presence.
  const words = sample.split(/\s+/).filter((w) => w.length >= 3);
  for (const w of words) {
    if (blob.toLowerCase().includes(w.toLowerCase())) return true;
  }
  return false;
}

function deriveSessionMetrics(packed, opts) {
  const rows = sanitizePacked(packed);
  const firstWordMs = opts && Number.isFinite(opts.firstWordMs) ? opts.firstWordMs : null;
  const doneMs = opts && Number.isFinite(opts.doneMs) ? opts.doneMs : null;

  let keyCount = 0;
  let backspaceDelete = 0;
  let pasteCount = 0;
  let cutCount = 0;
  let activeTypingMs = 0;
  let pausesOver2s = 0;
  let pausesOver10s = 0;
  let burstCount = 0;
  let burstLenSum = 0;
  let currentBurst = 0;
  let prevMs = null;
  const timeline = []; // { t, rate, pause, del } buckets ~1s

  const bucketMs = 1000;
  const buckets = new Map();

  function bumpBucket(ms, field) {
    const b = Math.floor(ms / bucketMs) * bucketMs;
    if (!buckets.has(b)) buckets.set(b, { t: b, keys: 0, dels: 0, pause: false });
    buckets.get(b)[field] += 1;
  }

  for (const row of rows) {
    const ms = row[0];
    const cat = row[1];
    if (prevMs != null) {
      const gap = ms - prevMs;
      if (gap >= 10000) {
        pausesOver10s += 1;
        pausesOver2s += 1;
        const b = Math.floor(prevMs / bucketMs) * bucketMs;
        if (!buckets.has(b)) buckets.set(b, { t: b, keys: 0, dels: 0, pause: false });
        buckets.get(b).pause = true;
        if (currentBurst > 0) {
          burstCount += 1;
          burstLenSum += currentBurst;
          currentBurst = 0;
        }
      } else if (gap >= 2000) {
        pausesOver2s += 1;
        const b = Math.floor(prevMs / bucketMs) * bucketMs;
        if (!buckets.has(b)) buckets.set(b, { t: b, keys: 0, dels: 0, pause: false });
        buckets.get(b).pause = true;
        if (currentBurst > 0) {
          burstCount += 1;
          burstLenSum += currentBurst;
          currentBurst = 0;
        }
      } else if (gap > 0 && gap < 2000) {
        activeTypingMs += gap;
      }
    }
    prevMs = ms;

    const isType =
      cat === CAT.letter || cat === CAT.digit || cat === CAT.space
      || cat === CAT.punctuation || cat === CAT.enter;
    const isDel = cat === CAT.backspace || cat === CAT.delete;

    if (isType || isDel || cat === CAT.paste || cat === CAT.cut || cat === CAT.ime) {
      keyCount += 1;
      bumpBucket(ms, isDel ? "dels" : "keys");
    }
    if (isDel) backspaceDelete += 1;
    if (cat === CAT.paste) pasteCount += 1;
    if (cat === CAT.cut) cutCount += 1;

    if (isType) currentBurst += 1;
    else if (isDel) {
      /* keep burst */
    } else if (cat === CAT.navigation || cat === CAT.selection || cat === CAT.focus || cat === CAT.blur) {
      if (currentBurst > 0) {
        burstCount += 1;
        burstLenSum += currentBurst;
        currentBurst = 0;
      }
    }
  }
  if (currentBurst > 0) {
    burstCount += 1;
    burstLenSum += currentBurst;
  }

  const durationMs = rows.length ? rows[rows.length - 1][0] - rows[0][0] : 0;
  const minutes = Math.max(durationMs / 60000, 1 / 60);
  const keysPerMinute = keyCount / minutes;

  for (const b of Array.from(buckets.keys()).sort((a, c) => a - c)) {
    const row = buckets.get(b);
    timeline.push({
      t: row.t,
      rate: row.keys,
      del: row.dels,
      pause: row.pause,
    });
  }

  let timeToFirstWordMs = firstWordMs;
  let timeFirstWordToDoneMs = null;
  if (firstWordMs != null && doneMs != null && doneMs >= firstWordMs) {
    timeFirstWordToDoneMs = doneMs - firstWordMs;
  }

  return {
    keyCount,
    keysPerMinute: Math.round(keysPerMinute * 10) / 10,
    activeTypingMs,
    pausesOver2s,
    pausesOver10s,
    burstCount,
    avgBurstLength: burstCount ? Math.round((burstLenSum / burstCount) * 10) / 10 : 0,
    backspaceDeleteRatio: keyCount ? Math.round((backspaceDelete / keyCount) * 1000) / 1000 : 0,
    pasteCount,
    cutCount,
    timeToFirstWordMs,
    timeFirstWordToDoneMs,
    timeline,
  };
}

function writingBehaviorRollup(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) {
    return {
      sessions: 0,
      keysPerMinute: 0,
      activeTypingMs: 0,
      pausesOver2s: 0,
      pausesOver10s: 0,
      avgBurstLength: 0,
      backspaceDeleteRatio: 0,
      pasteCount: 0,
      timeToFirstWordMs: null,
      timeFirstWordToDoneMs: null,
    };
  }
  const n = list.length;
  const avg = (getter) => list.reduce((s, row) => s + (Number(getter(row)) || 0), 0) / n;
  const avgDefined = (getter) => {
    const vals = list.map(getter).filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  return {
    sessions: n,
    keysPerMinute: Math.round(avg((r) => r.keysPerMinute) * 10) / 10,
    activeTypingMs: Math.round(avg((r) => r.activeTypingMs)),
    pausesOver2s: Math.round(avg((r) => r.pausesOver2s) * 10) / 10,
    pausesOver10s: Math.round(avg((r) => r.pausesOver10s) * 10) / 10,
    avgBurstLength: Math.round(avg((r) => r.avgBurstLength) * 10) / 10,
    backspaceDeleteRatio: Math.round(avg((r) => r.backspaceDeleteRatio) * 1000) / 1000,
    pasteCount: Math.round(avg((r) => r.pasteCount) * 10) / 10,
    timeToFirstWordMs: avgDefined((r) => r.timeToFirstWordMs),
    timeFirstWordToDoneMs: avgDefined((r) => r.timeFirstWordToDoneMs),
  };
}

return {
  CAT: CAT,
  CAT_NAME: CAT_NAME,
  COUNT_CATS: COUNT_CATS,
  categorizeKey: categorizeKey,
  packStroke: packStroke,
  sanitizePacked: sanitizePacked,
  packedContainsText: packedContainsText,
  deriveSessionMetrics: deriveSessionMetrics,
  writingBehaviorRollup: writingBehaviorRollup,
};
});
