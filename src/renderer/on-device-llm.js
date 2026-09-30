/* On-device Keep crafting probe for Gemma 3n E2B (iOS PWA).
 *
 * Tyler wants the model downloaded and run on the iPhone — not hosted.
 * This module decides whether MediaPipe LLM Inference (WebGPU) or WebLLM
 * can actually run Gemma 3n E2B in the installed PWA, and otherwise
 * returns the KEEP_CRAFTING_MODEL fallback id (Opus).
 *
 * Evidence (Google LiteRT-LM docs, 2026-09):
 *   - Gemma-3n-E2B chat bundle ≈ 2965 MB (.litertlm)
 *   - Official iPhone numbers are for native LiteRT-LM (Swift/Metal),
 *     not Safari WebGPU / PWA. Gemma-3n-E2B has no iPhone row; iPhone
 *     17 Pro rows are Gemma4-E2B.
 *   - MediaPipe LLM Inference Web path requires WebGPU; the API is
 *     maintenance-only (migrate to LiteRT-LM JS, still Early Preview).
 *   - iOS Safari web-process memory ≈ 1.5 GB; a ~3 GB model cannot
 *     fit alongside JS + GPU buffers. Community demos crash / block
 *     mobile for ≥2 GB WebGPU models.
 *   - WebLLM has no shipped Gemma 3n E2B build (open request); smaller
 *     models only, with 256 MB WebGPU buffer limits on iOS.
 *
 * Recommendation lives in the PR #387 report: not viable for E2B in
 * the iOS Safari PWA. Native LiteRT-LM Swift app would be a different
 * product surface.
 */
(function (root) {
  "use strict";

  /** Matches api/_lib/keep-crafting-model.js default. */
  var FALLBACK_MODEL = "claude-opus-4-8";

  var GEMMA_3N_E2B = {
    id: "gemma-3n-e2b-it",
    /** Official LiteRT-LM table: Gemma-3n-E2B Chat = 2965 MB. */
    downloadMb: 2965,
    /** Rough runtime floor once weights + KV + JS peak (conservative). */
    minRuntimeMb: 3500,
    /** iOS Safari web-process budget commonly cited by WebKit engineers. */
    iosSafariTabBudgetMb: 1500,
    backends: ["mediapipe-webgpu", "webllm-webgpu"],
  };

  function isIosLike() {
    if (typeof navigator === "undefined") return false;
    var ua = String(navigator.userAgent || "");
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS desktop UA
    return navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua);
  }

  function hasWebGpu() {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  /**
   * Synchronous capability gate. Never starts a multi-GB download.
   * Returns { ok, reason, model, downloadMb, backend }.
   */
  function evaluateGemma3nE2B() {
    if (isIosLike()) {
      return {
        ok: false,
        reason:
          "ios-safari-memory: Gemma-3n-E2B (~" +
          GEMMA_3N_E2B.downloadMb +
          " MB) exceeds iOS Safari ~" +
          GEMMA_3N_E2B.iosSafariTabBudgetMb +
          " MB web-process budget; MediaPipe/WebLLM WebGPU paths are not viable in the PWA",
        model: GEMMA_3N_E2B.id,
        downloadMb: GEMMA_3N_E2B.downloadMb,
        backend: null,
        fallbackModel: FALLBACK_MODEL,
      };
    }
    if (!hasWebGpu()) {
      return {
        ok: false,
        reason: "webgpu-unavailable: MediaPipe LLM Inference (Web) and WebLLM both require WebGPU",
        model: GEMMA_3N_E2B.id,
        downloadMb: GEMMA_3N_E2B.downloadMb,
        backend: null,
        fallbackModel: FALLBACK_MODEL,
      };
    }
    // Desktop WebGPU may exist, but E2B still needs ~3 GB download +
    // multi-GB RAM. Refuse until a measured desktop path ships; Keep
    // crafting must not block the owner on a speculative download.
    return {
      ok: false,
      reason:
        "gemma-3n-e2b-not-wired: WebGPU present but on-device E2B loader is not shipped (HF gated ~" +
        GEMMA_3N_E2B.downloadMb +
        " MB; no WebLLM E2B build). Falling back to KEEP_CRAFTING_MODEL.",
      model: GEMMA_3N_E2B.id,
      downloadMb: GEMMA_3N_E2B.downloadMb,
      backend: null,
      fallbackModel: FALLBACK_MODEL,
    };
  }

  function canRunGemma3nE2B() {
    return evaluateGemma3nE2B().ok === true;
  }

  /** Model id for callClaude / converse when on-device is unavailable. */
  function fallbackModel() {
    return FALLBACK_MODEL;
  }

  /**
   * Attempt on-device generation. Always rejects today so callers fall
   * back to KEEP_CRAFTING_MODEL (Opus). Never writes lead notes.
   */
  function generateKeepCrafting(/* prompt */) {
    var gate = evaluateGemma3nE2B();
    return Promise.reject(
      new Error(gate.reason || "on-device Gemma 3n E2B unavailable")
    );
  }

  /**
   * Pick the Keep crafting path for this device.
   * { mode: "on-device"|"fallback", model, reason, downloadMb }
   */
  function resolveKeepCraftingPath() {
    var gate = evaluateGemma3nE2B();
    if (gate.ok) {
      return {
        mode: "on-device",
        model: gate.model,
        reason: "webgpu-ready",
        downloadMb: gate.downloadMb,
      };
    }
    return {
      mode: "fallback",
      model: FALLBACK_MODEL,
      reason: gate.reason,
      downloadMb: gate.downloadMb,
    };
  }

  var api = {
    GEMMA_3N_E2B: GEMMA_3N_E2B,
    FALLBACK_MODEL: FALLBACK_MODEL,
    isIosLike: isIosLike,
    hasWebGpu: hasWebGpu,
    evaluateGemma3nE2B: evaluateGemma3nE2B,
    canRunGemma3nE2B: canRunGemma3nE2B,
    fallbackModel: fallbackModel,
    generateKeepCrafting: generateKeepCrafting,
    resolveKeepCraftingPath: resolveKeepCraftingPath,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.tinkerOnDeviceLlm = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
