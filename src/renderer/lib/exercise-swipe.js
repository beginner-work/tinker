/* Mobile swipe exercise: better/worse alternatives of a small baseline snippet.
 *
 * Claude proposes one alternative at a time (mix of genuinely better and
 * subtly worse), scoped to the exercise learning goal. The UI shows a compact
 * removed/added diff; swipe right = better, left = worse. Accepting a better
 * alternative updates the baseline for the next card. Claude only; no Formation.
 */
(function (root, factory) {
  const api = factory(
    (typeof module === "object" && module.exports
      ? require("./claude-models.js")
      : null) ||
      (typeof window !== "undefined" ? window.tinkerClaudeModels : null) ||
      {}
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerExerciseSwipe = api;
  } else if (root) {
    root.tinkerExerciseSwipe = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (models) {
  "use strict";

  const MODEL =
    (models && models.EXERCISE_REFACTOR) || "claude-opus-5-5";
  const MAX_BASELINE = 24000;
  const MAX_SNIPPET = 1200;
  const MAX_ALT = 1200;
  const MAX_WHY = 180;
  const MAX_GOAL = 400;
  const MIN_LINES = 3;
  const MAX_LINES = 8;

  const SYSTEM_PROMPT = [
    "You coach Tyler on a mobile swipe drill for one coding exercise.",
    "He sees a few lines of the current baseline and one proposed alternative.",
    "Propose either a genuinely better rewrite of that snippet, or a subtly worse one.",
    "Keep changes small and local. Stay inside the learning goal.",
    "Return only the replacement text for the snippet region, not the whole file.",
    "why is one short sentence naming better or worse and the reason.",
    "Never use an em dash. Never mention Formation or any retired curriculum.",
    "Never invent secrets or live API keys. No plans. No numbered lists.",
    "Return a single JSON object and nothing else:",
    '{ "alternative": string, "kind": "better"|"worse", "why": string }',
  ].join("\n");

  const REPLY_SCHEMA = {
    type: "object",
    properties: {
      alternative: { type: "string" },
      kind: { type: "string", enum: ["better", "worse"] },
      why: { type: "string" },
    },
    required: ["alternative", "kind", "why"],
    additionalProperties: false,
  };

  function clamp(text, max) {
    const s = text == null ? "" : String(text);
    if (s.length <= max) return s;
    return s.slice(0, max);
  }

  function banFormation(text, label) {
    if (/formation/i.test(String(text || ""))) {
      throw Object.assign(new Error(label + " must not mention Formation."), {
        status: 502,
      });
    }
  }

  function splitLines(text) {
    const s = text == null ? "" : String(text);
    if (!s) return [];
    return s.split(/\n/);
  }

  function lineOffsets(text) {
    const lines = splitLines(text);
    const offsets = [0];
    let pos = 0;
    for (let i = 0; i < lines.length; i += 1) {
      pos += lines[i].length;
      if (i < lines.length - 1) pos += 1;
      offsets.push(pos);
    }
    return { lines: lines, offsets: offsets };
  }

  /** Pick a 3–8 line window from the baseline for one card. */
  function pickSnippet(fullText, opts) {
    const options = opts || {};
    const doc = fullText == null ? "" : String(fullText);
    const { lines, offsets } = lineOffsets(doc);
    if (!lines.length) {
      return {
        before: "",
        startLine: 0,
        endLine: 0,
        startOffset: 0,
        endOffset: 0,
        lineCount: 0,
      };
    }
    const preferred = Math.max(
      MIN_LINES,
      Math.min(MAX_LINES, Number(options.lineCount) || 5)
    );
    const nonEmpty = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (String(lines[i] || "").trim()) nonEmpty.push(i);
    }
    const seed = nonEmpty.length
      ? nonEmpty[Number(options.seed) % nonEmpty.length || 0]
      : 0;
    let start = Math.max(0, seed - Math.floor(preferred / 2));
    let end = Math.min(lines.length, start + preferred);
    if (end - start < preferred) {
      start = Math.max(0, end - preferred);
    }
    if (end - start < MIN_LINES && lines.length >= MIN_LINES) {
      start = 0;
      end = Math.min(lines.length, MAX_LINES);
    }
    if (end <= start) end = Math.min(lines.length, start + 1);
    const startOffset = offsets[start];
    const endOffset = offsets[end];
    let before = doc.slice(startOffset, endOffset);
    if (before.endsWith("\n") && end > start) {
      before = before.slice(0, -1);
    }
    before = clamp(before, MAX_SNIPPET);
    return {
      before: before,
      startLine: start,
      endLine: end,
      startOffset: startOffset,
      endOffset: startOffset + before.length,
      lineCount: splitLines(before).length,
    };
  }

  function applySnippetReplacement(fullText, startOffset, endOffset, alternative) {
    const doc = fullText == null ? "" : String(fullText);
    const start = Math.max(0, Math.min(Number(startOffset) || 0, doc.length));
    const end = Math.max(start, Math.min(Number(endOffset) || 0, doc.length));
    const next = String(alternative == null ? "" : alternative);
    return doc.slice(0, start) + next + doc.slice(end);
  }

  /** Compact line diff for the swipe card (removed vs added). */
  function compactDiff(before, after) {
    const a = splitLines(before);
    const b = splitLines(after);
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        out.push({ type: "ctx", text: a[i] });
        i += 1;
        j += 1;
        continue;
      }
      if (i < a.length && (j >= b.length || a.indexOf(b[j], i) !== i)) {
        // Prefer deleting until we realign, or until a is exhausted.
        let matched = -1;
        for (let k = i + 1; k < a.length && k < i + 4; k += 1) {
          if (j < b.length && a[k] === b[j]) {
            matched = k;
            break;
          }
        }
        if (matched === -1) {
          out.push({ type: "del", text: a[i] });
          i += 1;
        } else {
          while (i < matched) {
            out.push({ type: "del", text: a[i] });
            i += 1;
          }
        }
        continue;
      }
      if (j < b.length) {
        out.push({ type: "add", text: b[j] });
        j += 1;
      }
    }
    // Keep the card short: drop leading/trailing unchanged context beyond one line.
    while (out.length > 2 && out[0].type === "ctx" && out[1].type === "ctx") {
      out.shift();
    }
    while (
      out.length > 2 &&
      out[out.length - 1].type === "ctx" &&
      out[out.length - 2].type === "ctx"
    ) {
      out.pop();
    }
    return out;
  }

  function normalizeKind(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    if (s === "better" || s === "good" || s === "improve") return "better";
    if (s === "worse" || s === "bad" || s === "regress") return "worse";
    return "";
  }

  function formatWhy(kind, why) {
    const body = clamp(String(why || "").trim(), MAX_WHY);
    const label = kind === "better" ? "Better" : "Worse";
    if (!body) return label + ".";
    // Avoid duplicating the label if the model already led with it.
    if (/^(better|worse)\b/i.test(body)) return body;
    return label + ": " + body;
  }

  function parseSwipeReply(textOrObj) {
    let parsed;
    if (textOrObj && typeof textOrObj === "object" && !Array.isArray(textOrObj)) {
      parsed = textOrObj;
    } else {
      const raw = String(textOrObj || "").trim();
      if (!raw) {
        throw Object.assign(new Error("Empty model reply."), { status: 502 });
      }
      let candidate = raw;
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced) candidate = fenced[1].trim();
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) {
        throw Object.assign(new Error("Model reply was not JSON."), { status: 502 });
      }
      try {
        parsed = JSON.parse(candidate.slice(start, end + 1));
      } catch {
        throw Object.assign(new Error("Model reply was not valid JSON."), {
          status: 502,
        });
      }
    }
    if (!parsed || typeof parsed.alternative !== "string") {
      throw Object.assign(new Error("Model reply missing alternative."), {
        status: 502,
      });
    }
    const kind = normalizeKind(parsed.kind);
    if (!kind) {
      throw Object.assign(new Error("Model reply missing kind."), { status: 502 });
    }
    const whyRaw =
      typeof parsed.why === "string" && parsed.why.trim()
        ? parsed.why.trim()
        : kind === "better"
          ? "Clearer toward the goal."
          : "Slips away from the goal.";
    banFormation(parsed.alternative, "alternative");
    banFormation(whyRaw, "why");
    const alternative = clamp(parsed.alternative, MAX_ALT);
    if (!alternative.trim()) {
      throw Object.assign(new Error("Model reply alternative was empty."), {
        status: 502,
      });
    }
    return {
      alternative: alternative,
      kind: kind,
      why: formatWhy(kind, whyRaw),
    };
  }

  function buildSwipeUserMessage(opts) {
    const options = opts || {};
    const fileName = String(options.fileName || "file").trim() || "file";
    const goal = clamp(options.learningGoal || options.goalTitle || "", MAX_GOAL).trim();
    const snippet = clamp(options.snippet || options.before || "", MAX_SNIPPET);
    if (!snippet.trim()) {
      throw Object.assign(new Error("No baseline snippet to compare."), {
        status: 400,
      });
    }
    const recent = Array.isArray(options.recentKinds)
      ? options.recentKinds.filter(Boolean).slice(-4)
      : [];
    const lines = [
      "File: " + fileName,
      "",
      "Learning goal:",
      goal || "Improve this practice file by feel.",
      "",
      "Baseline snippet (replace this entire region):",
      "<<<SNIPPET",
      snippet,
      "SNIPPET>>>",
      "",
      "Propose one alternative for that snippet only.",
      "Mix better and worse across turns. Prefer the opposite of recent kinds when you can.",
    ];
    if (recent.length) {
      lines.push("Recent kinds: " + recent.join(", "));
    }
    return lines.join("\n");
  }

  /** After a swipe: whether to accept the alternative into the baseline. */
  function shouldUpdateBaseline(kind, swipe) {
    const k = normalizeKind(kind);
    const s = String(swipe || "")
      .trim()
      .toLowerCase();
    // Right / better button means the learner accepts this version.
    const accepted = s === "right" || s === "better" || s === "accept";
    return k === "better" && accepted;
  }

  return {
    MODEL: MODEL,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    REPLY_SCHEMA: REPLY_SCHEMA,
    TOOL_NAME: "submit_exercise_swipe",
    MIN_LINES: MIN_LINES,
    MAX_LINES: MAX_LINES,
    pickSnippet: pickSnippet,
    applySnippetReplacement: applySnippetReplacement,
    compactDiff: compactDiff,
    parseSwipeReply: parseSwipeReply,
    buildSwipeUserMessage: buildSwipeUserMessage,
    shouldUpdateBaseline: shouldUpdateBaseline,
    formatWhy: formatWhy,
  };
});
