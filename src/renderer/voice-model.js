/* tinker — personal voice model (client)
 *
 * "Voice" here is the founder's *writing* voice, not audio: the tone,
 * cadence, vocabulary, and rhythm of how they write. The model itself is
 * a structured profile derived from the founder's own essays by
 * /api/voice/model, which (re)trains on the growing corpus and caches the
 * result server-side.
 *
 * This module is the renderer-side consumer:
 *   - fetches the profile (GET /api/voice/model) and caches it in
 *     localStorage so the writing flow can read it synchronously;
 *   - refreshes after the founder publishes more writing (the corpus
 *     grew, so the server retrains on the next fetch);
 *   - exposes window.tinkerVoice.interviewerBlock(), the prompt fragment
 *     that writing.js folds into its question-generation prompts so the
 *     interview is phrased in the founder's own written voice.
 *
 * It only shapes how questions are *phrased*. The founder-only stitching
 * guarantee in writing.js (verifyFounderOnly) is independent and untouched.
 */

(() => {
  "use strict";

  const LS_PROFILE = "tinker.voiceModel.v1";
  const TOKEN_KEY = "tinker_jwt";
  const STORE = window.localStorage;

  // Debounce window after a publish before we ask the server to retrain.
  // The essays blob is pushed to the server on its own debounce
  // (sync.js); give that push time to land so the retrain sees the new
  // essay in the corpus.
  const REFRESH_AFTER_PUBLISH_MS = 5000;

  let cache = null;       // last-known model payload (see /api/voice/model reply)
  let inflight = null;    // de-dupe concurrent fetches
  let refreshTimer = null;

  function token() {
    try { return STORE.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  }

  function loadCache() {
    try {
      const raw = STORE.getItem(LS_PROFILE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveCache(payload) {
    cache = payload;
    try { STORE.setItem(LS_PROFILE, JSON.stringify(payload)); } catch { /* ignore */ }
  }

  // ── Prompt fragment ─────────────────────────────────────────────────
  //
  // Compose the cached profile into a compact block the writing flow can
  // append to its system prompt. Returns "" when there's no trained voice
  // yet, so the interview falls back to its default phrasing.
  function interviewerBlock() {
    const profile = getProfile();
    if (!profile) return "";
    const lines = [
      "THE FOUNDER'S WRITING VOICE (learned from their own essays).",
      "Phrase your questions so they sound like they came from inside this founder's own head — match the cadence and word choice below. This shapes HOW you ask, never WHAT they should answer. Do not put words in their mouth, do not lead them to a conclusion, and never quote this profile back to them.",
    ];
    if (profile.voiceCard) lines.push(`- Voice: ${profile.voiceCard}`);
    if (profile.tone) lines.push(`- Tone: ${profile.tone}`);
    if (profile.cadence) lines.push(`- Cadence: ${profile.cadence}`);
    if (profile.sentenceRhythm) lines.push(`- Rhythm: ${profile.sentenceRhythm}`);
    if (profile.vocabulary && profile.vocabulary.length) {
      lines.push(`- Words they actually use: ${profile.vocabulary.join(", ")}`);
    }
    if (profile.signatureMoves && profile.signatureMoves.length) {
      lines.push(`- Recurring moves: ${profile.signatureMoves.join("; ")}`);
    }
    if (profile.avoids && profile.avoids.length) {
      lines.push(`- They avoid: ${profile.avoids.join("; ")}`);
    }
    if (profile.interviewerStyle) {
      lines.push(`- How to ask: ${profile.interviewerStyle}`);
    }
    return lines.join("\n");
  }

  function getProfile() {
    if (!cache) cache = loadCache();
    return cache && cache.trained && cache.profile ? cache.profile : null;
  }

  function isTrained() {
    return !!getProfile();
  }

  // ── Fetch / train ───────────────────────────────────────────────────
  async function fetchModel(method) {
    const t = token();
    if (!t) return null;
    let res;
    try {
      res = await fetch("/api/voice/model", {
        method,
        headers: { Authorization: `Bearer ${t}` },
      });
    } catch {
      return null; // offline — keep whatever's cached
    }
    if (!res.ok) return null;
    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }
    if (!payload || typeof payload !== "object") return null;
    saveCache(payload);
    try {
      window.dispatchEvent(new CustomEvent("tinker:voice-updated", { detail: payload }));
    } catch { /* ignore */ }
    return payload;
  }

  // GET the model — server returns the cached profile when the corpus is
  // unchanged, or retrains when it grew. De-duped so several callers in one
  // tick share a single request.
  function ensure() {
    if (!token()) return Promise.resolve(getProfile());
    if (inflight) return inflight;
    inflight = fetchModel("GET")
      .then(() => getProfile())
      .finally(() => { inflight = false; inflight = null; });
    return inflight;
  }

  // Force a retrain (POST). Used after the founder publishes new writing.
  function retrain() {
    if (!token()) return Promise.resolve(getProfile());
    return fetchModel("POST").then(() => getProfile());
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { ensure(); }, REFRESH_AFTER_PUBLISH_MS);
  }

  // ── Lifecycle wiring ────────────────────────────────────────────────
  cache = loadCache();

  // Pull the model once the boot hydrate has settled (essays are in
  // localStorage and the auth token is available by then).
  window.addEventListener("tinker:hydrated", () => { ensure(); });
  // A fresh sign-in may surface a different founder's corpus.
  window.addEventListener("tinker:auth-changed", () => {
    saveCache(null);
    try { STORE.removeItem(LS_PROFILE); } catch { /* ignore */ }
    ensure();
  });
  // New essay published → the corpus grew → refresh (the server retrains
  // because the signature changed). Debounced so a burst of offline
  // flushes triggers one refresh.
  window.addEventListener("tinker:writing-saved", () => { scheduleRefresh(); });

  // If we booted with a token already present (no hydrate event this
  // session), still try once on next tick.
  if (token() && !cache) setTimeout(() => ensure(), 0);

  window.tinkerVoice = {
    getProfile,
    isTrained,
    interviewerBlock,
    ensure,
    retrain,
    /** Last-known model payload (trained flag, counts, trainedAt). */
    status() { return cache; },
  };
})();
