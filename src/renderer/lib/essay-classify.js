/* Classify /repo essays as technical vs business (Claude Haiku 4.5).
 *
 * Pure helpers + one Claude call wrapper. Callers pass callFn so tests can
 * mock the model. Browser: window.tinkerEssayClassify. Node: require.
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
      : (typeof window !== "undefined" ? window.tinkerClaudeStructured : null)
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerEssayClassify = api;
  } else if (root) {
    root.tinkerEssayClassify = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (models, structured) {
  "use strict";

  var KIND_TECHNICAL = "technical";
  var KIND_BUSINESS = "business";
  var KINDS = [KIND_TECHNICAL, KIND_BUSINESS];
  var DEBOUNCE_MS = 1500;
  var MIN_CHARS = 48;
  var MODEL =
    (models &&
      (models.ESSAY_CLASSIFY ||
        models.FAST ||
        models.WRITING ||
        models.KEEP_CRAFTING)) ||
    "claude-haiku-4-5-20251001";

  var CLASSIFY_SCHEMA = {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [KIND_TECHNICAL, KIND_BUSINESS],
      },
    },
    required: ["kind"],
    additionalProperties: false,
  };

  var SYSTEM_PROMPT =
    "You classify founder writing into exactly one kind.\n" +
    "- technical: engineering, APIs, code, infrastructure, product implementation, debugging, specs.\n" +
    "- business: customers, sales, fundraising, hiring, strategy, personal reflection, career, go-to-market.\n" +
    "If mixed, pick the dominant kind. Reply with structured JSON only.";

  function normalizeKind(value, fallback) {
    var raw = String(value == null ? "" : value).trim().toLowerCase();
    if (raw === KIND_TECHNICAL) return KIND_TECHNICAL;
    if (raw === KIND_BUSINESS) return KIND_BUSINESS;
    // Legacy folder / essay types that are not technical map to business.
    if (
      raw === "stories" ||
      raw === "reflections" ||
      raw === "drafts" ||
      raw === "readings" ||
      raw === "exercises"
    ) {
      return KIND_BUSINESS;
    }
    if (fallback === KIND_TECHNICAL || fallback === KIND_BUSINESS) return fallback;
    return KIND_BUSINESS;
  }

  function isTechnicalKind(value) {
    return normalizeKind(value) === KIND_TECHNICAL;
  }

  function enoughText(text) {
    return String(text || "").replace(/\s+/g, " ").trim().length >= MIN_CHARS;
  }

  function needsBackfill(essay) {
    if (!essay || typeof essay !== "object") return false;
    if (essay.contentTypeClassifiedAt) return false;
    var body = String(essay.body || essay.markdown || "").trim();
    return enoughText(body);
  }

  function buildClassifyUserMessage(text, opts) {
    var options = opts || {};
    var body = String(text || "").replace(/\s+/g, " ").trim().slice(0, 4000);
    var parts = ["Classify this essay:\n\n<<<ESSAY\n" + body + "\nESSAY"];
    var biz = String(options.businessContext || "").trim().slice(0, 2000);
    var tech = String(options.technicalGoalsContext || "").trim().slice(0, 2000);
    if (biz) {
      parts.push(
        "\n\nBusiness context pages (read-only, optional hint):\n<<<BUSINESS_CONTEXT\n" +
          biz +
          "\nBUSINESS_CONTEXT"
      );
    }
    if (tech) {
      parts.push(
        "\n\nTechnical goals pages (read-only, optional hint):\n<<<TECH_CONTEXT\n" +
          tech +
          "\nTECH_CONTEXT"
      );
    }
    return parts.join("");
  }

  function validateClassifyPayload(payload) {
    if (!payload || typeof payload !== "object") {
      throw Object.assign(new Error("Missing classify payload."), { status: 502 });
    }
    var kind = normalizeKind(payload.kind, null);
    if (kind !== KIND_TECHNICAL && kind !== KIND_BUSINESS) {
      throw Object.assign(new Error("Classify kind missing."), { status: 502 });
    }
    return { kind: kind };
  }

  /**
   * @param {object} opts
   * @param {string} opts.text
   * @param {function} opts.callFn  async (payload) => Claude result
   * @param {object} [opts.structuredApi]  override structured helper (tests)
   * @param {string} [opts.businessContext]
   * @param {string} [opts.technicalGoalsContext]
   * @param {string} [opts.model]
   */
  function classifyEssay(opts) {
    var options = opts || {};
    var text = options.text;
    var callFn = options.callFn;
    if (typeof callFn !== "function") {
      return Promise.reject(new Error("callFn is required"));
    }
    if (!enoughText(text)) {
      return Promise.resolve({ kind: KIND_BUSINESS, skipped: true });
    }
    var structuredApi = options.structuredApi || structured;
    if (!structuredApi || typeof structuredApi.runStructuredJsonCall !== "function") {
      return Promise.reject(new Error("structured helper unavailable"));
    }
    var model = options.model || MODEL;
    var userMsg = buildClassifyUserMessage(text, {
      businessContext: options.businessContext,
      technicalGoalsContext: options.technicalGoalsContext,
    });
    return structuredApi
      .runStructuredJsonCall({
        callFn: callFn,
        model: model,
        schema: CLASSIFY_SCHEMA,
        toolName: "submit_essay_kind",
        toolDescription: "Return whether the essay is technical or business.",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
        maxTokens: 256,
        validate: validateClassifyPayload,
        attempts: 2,
        effort: "low",
      })
      .then(function (result) {
        return {
          kind: result.value.kind,
          mechanism: result.mechanism,
          skipped: false,
        };
      });
  }

  function createDebouncedClassifier(run, waitMs) {
    var timer = null;
    var seq = 0;
    var delay = waitMs == null ? DEBOUNCE_MS : Number(waitMs);
    if (!Number.isFinite(delay) || delay < 0) delay = DEBOUNCE_MS;

    function schedule(arg) {
      seq += 1;
      var my = seq;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        if (my !== seq) return;
        try {
          run(arg);
        } catch (e) { /* ignore */ }
      }, delay);
    }

    function cancel() {
      seq += 1;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    return { schedule: schedule, cancel: cancel, DEBOUNCE_MS: delay };
  }

  return {
    KIND_TECHNICAL: KIND_TECHNICAL,
    KIND_BUSINESS: KIND_BUSINESS,
    KINDS: KINDS.slice(),
    DEBOUNCE_MS: DEBOUNCE_MS,
    MIN_CHARS: MIN_CHARS,
    MODEL: MODEL,
    CLASSIFY_SCHEMA: CLASSIFY_SCHEMA,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    normalizeKind: normalizeKind,
    isTechnicalKind: isTechnicalKind,
    enoughText: enoughText,
    needsBackfill: needsBackfill,
    buildClassifyUserMessage: buildClassifyUserMessage,
    validateClassifyPayload: validateClassifyPayload,
    classifyEssay: classifyEssay,
    createDebouncedClassifier: createDebouncedClassifier,
  };
});
