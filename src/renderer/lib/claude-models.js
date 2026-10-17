/* Single source of Anthropic model ids for Tinker.
 *
 * Loaded as a classic script (window.tinkerClaudeModels) and required from
 * Node (api + tests). Flip an id here; do not scatter string literals.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerClaudeModels = api;
  } else if (root) {
    root.tinkerClaudeModels = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Writing UI / Keep crafting / interview follow-ups (Claude Haiku 4.5).
  const WRITING = "claude-haiku-4-5-20251001";

  // Desktop exercise inline refactor (Claude Opus 5.5).
  const EXERCISE_REFACTOR = "claude-opus-5-5";

  // Essay → whole-exercise revise (unchanged path; kept here so ids stay one place).
  const EXERCISE_REVISE = "claude-opus-4-8";

  // LinkedIn draft + career extract helpers.
  const DRAFTING = "claude-opus-4-8";

  // Fast classify / search (essay technical vs business, etc.).
  const FAST = "claude-haiku-4-5-20251001";
  // Alias for essay side classification (same Haiku 4.5 pin).
  const ESSAY_CLASSIFY = FAST;

  // Server fallback when a caller omits model.
  const DEFAULT = "claude-opus-4-7";

  return {
    WRITING: WRITING,
    EXERCISE_REFACTOR: EXERCISE_REFACTOR,
    EXERCISE_REVISE: EXERCISE_REVISE,
    DRAFTING: DRAFTING,
    FAST: FAST,
    ESSAY_CLASSIFY: ESSAY_CLASSIFY,
    DEFAULT: DEFAULT,
    // Alias used by interview-prompt Keep crafting.
    KEEP_CRAFTING: WRITING,
  };
});
