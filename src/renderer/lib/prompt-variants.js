/* Prompt / surface ids + variant rotation.
 *
 * Loads prompt-variants.json. pickVariant(promptId) rotates randomly
 * among configured variants. Beacon can expand variants later.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function"
        ? require("../analytics/prompt-variants.json")
        : null
    );
  } else {
    root.tinkerPromptVariants = factory(root.__TINKER_PROMPT_VARIANTS__ || null);
  }
})(typeof self !== "undefined" ? self : this, function (config) {
  "use strict";

  var cfg = config && typeof config === "object" ? config : { prompts: {}, surfaces: {} };

  function promptConfig(promptId) {
    var prompts = cfg.prompts || {};
    return prompts[promptId] || null;
  }

  function surfaceConfig(surfaceId) {
    var surfaces = cfg.surfaces || {};
    return surfaces[surfaceId] || null;
  }

  function pickVariant(promptId, rng) {
    var p = promptConfig(promptId);
    var variants = p && Array.isArray(p.variants) ? p.variants : [{ id: "A", source: "model" }];
    if (!variants.length) variants = [{ id: "A", source: "model" }];
    var rand = typeof rng === "function" ? rng() : Math.random();
    var idx = Math.floor(rand * variants.length) % variants.length;
    if (idx < 0) idx = 0;
    var v = variants[idx];
    return {
      promptId: promptId,
      variantId: v.id || "A",
      source: v.source || "model",
      template: typeof v.template === "string" ? v.template : null,
      note: v.note || null,
    };
  }

  /** Resolve display text: template variant uses template; model keeps provided text. */
  function resolvePromptText(pick, modelText) {
    if (pick && pick.source === "template" && pick.template) return pick.template;
    return modelText;
  }

  function listPromptIds() {
    return Object.keys(cfg.prompts || {});
  }

  function listSurfaceIds() {
    return Object.keys(cfg.surfaces || {});
  }

  return {
    config: cfg,
    promptConfig: promptConfig,
    surfaceConfig: surfaceConfig,
    pickVariant: pickVariant,
    resolvePromptText: resolvePromptText,
    listPromptIds: listPromptIds,
    listSurfaceIds: listSurfaceIds,
  };
});
