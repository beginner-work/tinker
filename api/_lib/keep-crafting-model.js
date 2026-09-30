/* Single switch for Keep crafting question (+ subject) model ids.
 *
 * Default stays Anthropic Opus. This is also the automatic fallback when
 * on-device Gemma 3n E2B cannot run in the iOS PWA (see
 * src/renderer/on-device-llm.js): no WebGPU, iOS Safari ~1.5 GB tab budget
 * vs ~2965 MB .litertlm, or the on-device loader is not wired.
 *
 * Hosted Gemma is a separate (rejected for Tyler's "on my iPhone" ask):
 * Gemini API hosts gemma-4-* only; true E2B needs Vertex/other. Do not
 * flip production to a hosted Google id for this investigation.
 *
 * Required env for the server/fallback path:
 *   - Anthropic (current KEEP_CRAFTING_MODEL default): ANTHROPIC_API_KEY
 */

"use strict";

const KEEP_CRAFTING_MODEL =
  (typeof process !== "undefined" &&
    process.env &&
    process.env.KEEP_CRAFTING_MODEL &&
    String(process.env.KEEP_CRAFTING_MODEL).trim()) ||
  "claude-opus-4-8";

module.exports = { KEEP_CRAFTING_MODEL };
