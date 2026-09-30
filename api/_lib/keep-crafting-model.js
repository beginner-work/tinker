/* Single switch for Keep crafting question (+ subject) model ids.
 *
 * Default stays Anthropic Opus. To trial Google models after credentials
 * exist, set KEEP_CRAFTING_MODEL (and the matching provider key) in Vercel.
 *
 * Gemma 3n E2B is NOT served by the Gemini API as of Google’s 2026-07 docs
 * (hosted Gemma there is gemma-4-* only). True E2B needs Vertex Model Garden
 * deploy (VERTEX_GEMMA_ENDPOINT + GCP auth) or another host.
 *
 * Required env when cutting over:
 *   - Anthropic (current): ANTHROPIC_API_KEY
 *   - Gemini API (Gemma 4 / other hosted Gemini models): GEMINI_API_KEY
 *   - Vertex Gemma 3n E2B: VERTEX_GEMMA_ENDPOINT (+ GCP application credentials)
 *
 * This agent could not list Vercel project env (CLI logged out). Do not guess.
 */

"use strict";

const KEEP_CRAFTING_MODEL =
  (typeof process !== "undefined" &&
    process.env &&
    process.env.KEEP_CRAFTING_MODEL &&
    String(process.env.KEEP_CRAFTING_MODEL).trim()) ||
  "claude-opus-4-8";

module.exports = { KEEP_CRAFTING_MODEL };
