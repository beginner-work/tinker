/* Growth-edge concept tags for /repo essays (Claude Haiku 4.5).
 *
 * Tags each essay with short growth-edge concepts, caches per essay body
 * hash, and picks the starting essay: the concept that appears in the most
 * essays (tie-break: most recent occurrence), then the most recent essay
 * tagged with that concept.
 *
 * Pure helpers + one Claude call wrapper. Callers pass callFn so tests can
 * mock the model. Browser: window.tinkerEssayGrowthEdge. Node: require.
 */
(function (root, factory) {
  var api = factory(
    typeof require === "function"
      ? (function () {
          try { return require("./claude-models.js"); } catch (e) { return null; }
        })()
      : (typeof window !== "undefined" ? window.tinkerClaudeModels : null),
    typeof require === "function"
      ? (function () {
          try { return require("./claude-structured.js"); } catch (e) { return null; }
        })()
      : (typeof window !== "undefined" ? window.tinkerClaudeStructured : null),
    typeof require === "function"
      ? (function () {
          try { return require("./stories-md.js"); } catch (e) { return null; }
        })()
      : (typeof window !== "undefined" ? window.tinkerStoriesMd : null)
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerEssayGrowthEdge = api;
  } else if (root) {
    root.tinkerEssayGrowthEdge = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (models, structured, storiesMd) {
  "use strict";

  var MIN_CHARS = 48;
  var MAX_CONCEPTS = 5;
  var MODEL =
    (models &&
      (models.ESSAY_GROWTH_EDGE ||
        models.ESSAY_CLASSIFY ||
        models.FAST ||
        models.WRITING ||
        models.KEEP_CRAFTING)) ||
    "claude-haiku-4-5-20251001";

  var BANNED_WORDS = { free: 1, real: 1, quietly: 1 };

  var TAG_SCHEMA = {
    type: "object",
    properties: {
      concepts: {
        type: "array",
        items: { type: "string" },
        minItems: 0,
        maxItems: MAX_CONCEPTS,
      },
    },
    required: ["concepts"],
    additionalProperties: false,
  };

  var SYSTEM_PROMPT =
    "You tag founder essays with growth-edge concepts.\n" +
    "A growth-edge concept is a short theme the writer is working through " +
    "(skill, habit, tension, or practice), not a summary of the essay.\n" +
    "Return 1 to " + MAX_CONCEPTS + " concepts. Prefer Title Case phrases of " +
    "2 to 5 words. No em dashes. Never use the words free, real, or quietly.\n" +
    "If the essay has no clear growth edge, return an empty concepts array.\n" +
    "Reply with structured JSON only.";

  function bodyText(essayOrText) {
    if (essayOrText == null) return "";
    if (typeof essayOrText === "string") return essayOrText;
    return String(essayOrText.body || essayOrText.markdown || "");
  }

  function enoughText(text) {
    return String(text || "").replace(/\s+/g, " ").trim().length >= MIN_CHARS;
  }

  /** Stable fingerprint of essay body for cache invalidation. */
  function bodyHash(text) {
    var s = String(text || "").replace(/\s+/g, " ").trim();
    var h = 5381;
    for (var i = 0; i < s.length; i += 1) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return "h" + (h >>> 0).toString(36);
  }

  function stripDashes(value) {
    return String(value == null ? "" : value)
      .replace(/[\u2014\u2013]/g, " ")
      .replace(/\s*-\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function containsBannedWord(value) {
    var tokens = String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter(Boolean);
    for (var i = 0; i < tokens.length; i += 1) {
      if (BANNED_WORDS[tokens[i]]) return true;
    }
    return false;
  }

  function titleCaseConcept(raw) {
    var cleaned = stripDashes(raw).slice(0, 80);
    if (!cleaned) return "";
    if (storiesMd && typeof storiesMd.titleCaseDisplay === "function") {
      return storiesMd.titleCaseDisplay(cleaned);
    }
    return cleaned.replace(/\b[a-z]/g, function (ch) {
      return ch.toUpperCase();
    });
  }

  function normalizeConcept(value) {
    var titled = titleCaseConcept(value);
    if (!titled) return "";
    if (containsBannedWord(titled)) return "";
    if (/[\u2014\u2013]/.test(titled)) return "";
    return titled;
  }

  function conceptKey(value) {
    return normalizeConcept(value).toLowerCase();
  }

  function normalizeConcepts(list) {
    var out = [];
    var seen = Object.create(null);
    var rows = Array.isArray(list) ? list : [];
    for (var i = 0; i < rows.length; i += 1) {
      var concept = normalizeConcept(rows[i]);
      if (!concept) continue;
      var key = concept.toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(concept);
      if (out.length >= MAX_CONCEPTS) break;
    }
    return out;
  }

  function essayRecencyMs(essay) {
    if (!essay || typeof essay !== "object") return 0;
    var raw = essay.updatedAt != null ? essay.updatedAt : essay.createdAt;
    if (raw == null) return 0;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    var parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * True when the essay needs (re)tagging: missing cache, or body changed.
   */
  function needsConceptTag(essay) {
    if (!essay || typeof essay !== "object") return false;
    var body = bodyText(essay);
    if (!enoughText(body)) return false;
    var hash = bodyHash(body);
    if (!essay.growthConceptsTaggedAt) return true;
    if (String(essay.growthConceptsBodyHash || "") !== hash) return true;
    if (!Array.isArray(essay.growthConcepts)) return true;
    return false;
  }

  function buildTagUserMessage(text) {
    var body = String(text || "").replace(/\s+/g, " ").trim().slice(0, 4000);
    return "Tag growth-edge concepts in this essay:\n\n<<<ESSAY\n" + body + "\nESSAY";
  }

  function validateTagPayload(payload) {
    if (!payload || typeof payload !== "object") {
      throw Object.assign(new Error("Missing growth-edge payload."), { status: 502 });
    }
    return { concepts: normalizeConcepts(payload.concepts) };
  }

  /**
   * @param {object} opts
   * @param {string} opts.text
   * @param {function} opts.callFn
   * @param {object} [opts.structuredApi]
   * @param {string} [opts.model]
   */
  function tagEssayConcepts(opts) {
    var options = opts || {};
    var text = options.text;
    var callFn = options.callFn;
    if (typeof callFn !== "function") {
      return Promise.reject(new Error("callFn is required"));
    }
    if (!enoughText(text)) {
      return Promise.resolve({
        concepts: [],
        skipped: true,
        bodyHash: bodyHash(text),
      });
    }
    var structuredApi = options.structuredApi || structured;
    if (!structuredApi || typeof structuredApi.runStructuredJsonCall !== "function") {
      return Promise.reject(new Error("structured helper unavailable"));
    }
    var model = options.model || MODEL;
    var hash = bodyHash(text);
    return structuredApi
      .runStructuredJsonCall({
        callFn: callFn,
        model: model,
        schema: TAG_SCHEMA,
        toolName: "submit_growth_concepts",
        toolDescription: "Return growth-edge concept tags for the essay.",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildTagUserMessage(text) }],
        maxTokens: 256,
        validate: validateTagPayload,
        attempts: 2,
        effort: "low",
      })
      .then(function (result) {
        return {
          concepts: result.value.concepts,
          mechanism: result.mechanism,
          skipped: false,
          bodyHash: hash,
        };
      });
  }

  /**
   * Pick the growth-edge concept and the most recent essay for it.
   *
   * Growth edge = concept in the most essays. Tie-break: most recent
   * occurrence of that concept. Starting essay = most recent essay tagged
   * with the winning concept.
   *
   * @param {Array<object>} essays
   * @returns {{ concept: string, essayId: string, essay: object, count: number } | null}
   */
  function selectGrowthEdge(essays) {
    var rows = Array.isArray(essays) ? essays : [];
    var byKey = Object.create(null);

    for (var i = 0; i < rows.length; i += 1) {
      var essay = rows[i];
      if (!essay || !essay.id) continue;
      var concepts = normalizeConcepts(essay.growthConcepts);
      if (!concepts.length) continue;
      var when = essayRecencyMs(essay);
      for (var c = 0; c < concepts.length; c += 1) {
        var concept = concepts[c];
        var key = concept.toLowerCase();
        var bucket = byKey[key];
        if (!bucket) {
          bucket = {
            concept: concept,
            count: 0,
            latestAt: 0,
            latestEssay: null,
          };
          byKey[key] = bucket;
        }
        bucket.count += 1;
        if (
          !bucket.latestEssay ||
          when > bucket.latestAt ||
          (when === bucket.latestAt &&
            String(essay.id) > String(bucket.latestEssay.id || ""))
        ) {
          bucket.latestAt = when;
          bucket.latestEssay = essay;
        }
      }
    }

    var best = null;
    Object.keys(byKey).forEach(function (key) {
      var row = byKey[key];
      if (!row || !row.latestEssay) return;
      if (!best) {
        best = row;
        return;
      }
      if (row.count > best.count) {
        best = row;
        return;
      }
      if (row.count < best.count) return;
      // Tie on count: prefer more recent occurrence.
      if (row.latestAt > best.latestAt) {
        best = row;
        return;
      }
      if (row.latestAt < best.latestAt) return;
      // Stable final tie-break: concept label.
      if (row.concept.toLowerCase() < best.concept.toLowerCase()) {
        best = row;
      }
    });

    if (!best || !best.latestEssay) return null;
    return {
      concept: best.concept,
      essayId: String(best.latestEssay.id),
      essay: best.latestEssay,
      count: best.count,
    };
  }

  return {
    MIN_CHARS: MIN_CHARS,
    MAX_CONCEPTS: MAX_CONCEPTS,
    MODEL: MODEL,
    TAG_SCHEMA: TAG_SCHEMA,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    bodyText: bodyText,
    enoughText: enoughText,
    bodyHash: bodyHash,
    stripDashes: stripDashes,
    normalizeConcept: normalizeConcept,
    normalizeConcepts: normalizeConcepts,
    conceptKey: conceptKey,
    essayRecencyMs: essayRecencyMs,
    needsConceptTag: needsConceptTag,
    buildTagUserMessage: buildTagUserMessage,
    validateTagPayload: validateTagPayload,
    tagEssayConcepts: tagEssayConcepts,
    selectGrowthEdge: selectGrowthEdge,
  };
});
