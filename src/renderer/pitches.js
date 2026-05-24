/* tinker — pitches (v0.105)
 *
 * The founder's writings live in one or more pitches. Each pitch is a
 * full eleven-slide deck — same shape as pitch-deck.md — with verbatim
 * phrases from the founder's drafts and essays slotted under each
 * heading. Pitches are renamable, equal-status (no "main" vs "alt"),
 * and the active selection defaults to the most robust pitch (most
 * deck headings covered by at least one phrase).
 *
 * This module owns local pitch state — active selection, personal
 * title editing, deck expand/collapse, per-classify upsert. The AI
 * organization work (cluster off-pitch writings, name pitches whose
 * writings drifted) used to run from this file on every hydrate; it
 * now lives behind /api/pitches/organize. This module just debounces
 * a single trigger call when writings change and folds the persisted
 * blob back via the sync layer.
 *
 * Storage:
 *   - tinker.pitches.v1
 *       {
 *         pitches: [
 *           {
 *             id: "p_<8>",
 *             aiTitle: string | null,
 *             personalTitle: string | null,
 *             aiTitleSourceHash: string | null,
 *             deck: { [deckHeading]: [phraseRecord, ...] },
 *             meta: { mostRecentlyTouched, expanded, lastClassifyFailedAt },
 *             createdAt: <ts>,
 *           }
 *         ],
 *         activeId: "<pitchId>" | null,   // null → auto-pick most robust
 *         _migratedFromTree: bool,
 *       }
 *
 * One-shot migration: if tinker.pitches.v1 doesn't exist and
 * tinker.tree.v1 does, wrap the tree as pitches[0] with a placeholder
 * title that gets filled in the next time the organize job runs.
 *
 * Events:
 *   - "tinker:pitches-changed"        any pitch state changed.
 *   - "tinker:active-pitch-changed"   active selection changed.
 */

(() => {
  "use strict";

  const PITCHES_KEY = "tinker.pitches.v1";
  const LEGACY_TREE_KEY = "tinker.tree.v1";
  const DRAFTS_KEY = "tinker.drafts.v1";
  const ESSAYS_KEY = "tinker.essays.v1";
  const TOKEN_KEY = "tinker_jwt";

  // Debounce window for the backend organize job. Coalesces a typing
  // burst (multiple writing-saved events in quick succession) into
  // one POST. The job itself is idempotent, so worst case we make
  // one extra round-trip.
  const ORGANIZE_DEBOUNCE_MS = 2500;
  const MAX_PHRASES_PER_HEADING = 1;

  // The eleven deck headings, same as sidebar-tree.js. Duplicated
  // here (rather than imported) so this module can stand on its own
  // for testing and so the migration path doesn't depend on the tree
  // module being loaded.
  const DECK_HEADINGS = [
    "The Problem",
    "A Persona",
    "Why Now?",
    "The Team",
    "The Product",
    "How We Make Money",
    "Go to Market",
    "The Moat",
    "The Vision",
    "Competition",
    "The Ask",
  ];

  // ── Storage helpers ───────────────────────────────────────────────

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === undefined ? fallback : parsed;
    } catch { return fallback; }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* ignore */ }
  }

  function loadDrafts() {
    const arr = loadJson(DRAFTS_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function loadEssays() {
    const arr = loadJson(ESSAYS_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function bodyForDraft(draft) {
    if (draft && draft.stitched && draft.stitched.body) return String(draft.stitched.body);
    const turns = (draft && Array.isArray(draft.transcript)) ? draft.transcript : [];
    return turns.map((t) => String(t && t.a || "").trim()).filter(Boolean).join("\n\n");
  }

  function bodyForWriting(writingId) {
    const drafts = loadDrafts();
    const draft = drafts.find((d) => d && d.id === writingId);
    if (draft) return bodyForDraft(draft);
    const essays = loadEssays();
    const essay = essays.find((e) => e && e.id === writingId);
    if (essay) return String(essay.body || "");
    return "";
  }

  function uid() {
    return "p_" + Math.random().toString(36).slice(2, 10);
  }

  function emptyDeck() {
    const d = {};
    for (const h of DECK_HEADINGS) d[h] = [];
    return d;
  }

  function isValidPhraseRecord(p) {
    return p && typeof p === "object"
      && typeof p.writingId === "string"
      && Number.isFinite(p.offset)
      && Number.isFinite(p.length)
      && p.length > 0;
  }

  // ── Migration from legacy storage ────────────────────────────────

  // If tinker.pitches.v1 is missing but tinker.tree.v1 exists, wrap
  // the legacy tree as the first pitch. The legacy alt-pitches blob
  // is intentionally discarded — its writings will be rehomed (and
  // properly slotted into the eleven deck headings) on the next
  // /api/alt-pitches call.
  function loadPitchesBlob() {
    const existing = loadJson(PITCHES_KEY, null);
    if (existing && typeof existing === "object" && Array.isArray(existing.pitches)) {
      return normalizeBlob(existing);
    }

    const legacyTree = loadJson(LEGACY_TREE_KEY, null);
    if (legacyTree && typeof legacyTree === "object") {
      const deck = emptyDeck();
      for (const h of DECK_HEADINGS) {
        if (Array.isArray(legacyTree[h])) {
          deck[h] = legacyTree[h].filter(isValidPhraseRecord);
        }
      }
      const legacyMeta = legacyTree._meta && typeof legacyTree._meta === "object"
        ? legacyTree._meta
        : {};
      const firstPitch = {
        id: uid(),
        aiTitle: null,
        personalTitle: null,
        aiTitleSourceHash: null,
        deck,
        meta: {
          mostRecentlyTouched: DECK_HEADINGS.includes(legacyMeta.mostRecentlyTouched)
            ? legacyMeta.mostRecentlyTouched
            : null,
          expanded: legacyMeta.expanded && typeof legacyMeta.expanded === "object"
            ? { ...legacyMeta.expanded }
            : {},
          lastClassifyFailedAt: typeof legacyMeta.lastClassifyFailedAt === "number"
            ? legacyMeta.lastClassifyFailedAt
            : null,
        },
        createdAt: Date.now(),
      };
      return {
        pitches: [firstPitch],
        activeId: firstPitch.id,
        _migratedFromTree: true,
      };
    }

    return { pitches: [], activeId: null, _migratedFromTree: false };
  }

  function normalizeBlob(raw) {
    const pitches = [];
    for (const p of raw.pitches) {
      if (!p || typeof p !== "object") continue;
      const id = typeof p.id === "string" && p.id ? p.id : uid();

      // Two parallel titles: aiTitle is model-generated and evolves
      // as the pitch's writings change; personalTitle is what the
      // founder calls it, optional and stable. Migration from the
      // older single-`title` shape: if autoTitled was true (or
      // missing), the old title was AI-generated → move to aiTitle.
      // If autoTitled was false, the founder had renamed it → keep
      // that as personalTitle so we don't lose their input.
      let aiTitle = typeof p.aiTitle === "string" ? p.aiTitle : null;
      let personalTitle = typeof p.personalTitle === "string" ? p.personalTitle : null;
      if (aiTitle === null && personalTitle === null && typeof p.title === "string") {
        if (p.autoTitled === false) {
          personalTitle = p.title;
        } else {
          aiTitle = p.title;
        }
      }

      const aiTitleSourceHash = typeof p.aiTitleSourceHash === "string"
        ? p.aiTitleSourceHash
        : null;

      const deck = emptyDeck();
      const rawDeck = p.deck && typeof p.deck === "object" ? p.deck : {};
      for (const h of DECK_HEADINGS) {
        if (Array.isArray(rawDeck[h])) deck[h] = rawDeck[h].filter(isValidPhraseRecord);
      }
      const rawMeta = p.meta && typeof p.meta === "object" ? p.meta : {};
      const meta = {
        mostRecentlyTouched: DECK_HEADINGS.includes(rawMeta.mostRecentlyTouched)
          ? rawMeta.mostRecentlyTouched
          : null,
        expanded: rawMeta.expanded && typeof rawMeta.expanded === "object"
          ? { ...rawMeta.expanded }
          : {},
        lastClassifyFailedAt: typeof rawMeta.lastClassifyFailedAt === "number"
          ? rawMeta.lastClassifyFailedAt
          : null,
      };
      pitches.push({
        id,
        aiTitle,
        personalTitle,
        aiTitleSourceHash,
        deck,
        meta,
        createdAt: Number(p.createdAt) || Date.now(),
      });
    }
    const activeId = typeof raw.activeId === "string" && pitches.some((p) => p.id === raw.activeId)
      ? raw.activeId
      : null;
    return { pitches, activeId, _migratedFromTree: !!raw._migratedFromTree };
  }

  // ── State ──────────────────────────────────────────────────────────

  let blob = loadPitchesBlob();
  let organizeTimer = null;
  let organizeInflight = false;
  // Stable hash of the last set of off-pitch ids we sent to the
  // backend job. Re-firing for the same set is a no-op on the
  // server, so we just skip the round-trip.
  let lastOrganizeHash = null;

  function save() {
    saveJson(PITCHES_KEY, blob);
    if (window.tinkerSync && typeof window.tinkerSync.pushPitches === "function") {
      window.tinkerSync.pushPitches();
    }
  }

  function fire(name) {
    try { window.dispatchEvent(new CustomEvent(name)); }
    catch { /* ignore */ }
  }

  // ── Robustness + active selection ─────────────────────────────────

  // Robustness = number of deck headings with at least one phrase
  // record whose offset still resolves inside its writing. We re-
  // resolve at read time so an edited writing doesn't keep the old
  // count.
  function pitchRobustness(pitch) {
    if (!pitch) return 0;
    let n = 0;
    for (const h of DECK_HEADINGS) {
      const recs = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      for (const rec of recs) {
        const body = bodyForWriting(rec.writingId);
        if (!body) continue;
        if (rec.offset < 0 || rec.offset + rec.length > body.length) continue;
        const slice = body.slice(rec.offset, rec.offset + rec.length);
        if (slice) { n++; break; }
      }
    }
    return n;
  }

  // Auto-pick: most robust wins. Ties broken by earliest createdAt
  // (the original tinker pitch stays in pole position before alts
  // overtake it).
  function pickDefaultActiveId() {
    if (!blob.pitches.length) return null;
    let best = blob.pitches[0];
    let bestRobustness = pitchRobustness(best);
    for (let i = 1; i < blob.pitches.length; i++) {
      const p = blob.pitches[i];
      const r = pitchRobustness(p);
      if (r > bestRobustness) {
        best = p;
        bestRobustness = r;
      } else if (r === bestRobustness && p.createdAt < best.createdAt) {
        best = p;
      }
    }
    return best.id;
  }

  function effectiveActiveId() {
    if (blob.activeId && blob.pitches.some((p) => p.id === blob.activeId)) {
      return blob.activeId;
    }
    return pickDefaultActiveId();
  }

  // ── Public API ─────────────────────────────────────────────────────

  function getPitches() {
    return blob.pitches.map((p) => ({
      id: p.id,
      aiTitle: p.aiTitle || null,
      personalTitle: p.personalTitle || null,
      // displayName is the fallback for any callsite that just wants
      // one label: personal wins (that's how the founder recognizes
      // it), then ai, then a placeholder. The full pair is available
      // for surfaces that want to show both.
      displayName: p.personalTitle || p.aiTitle || "Untitled",
      robustness: pitchRobustness(p),
      createdAt: p.createdAt,
    }));
  }

  function getActivePitchId() { return effectiveActiveId(); }

  function getActivePitch() {
    const id = effectiveActiveId();
    if (!id) return null;
    return blob.pitches.find((p) => p.id === id) || null;
  }

  function getPitch(id) {
    return blob.pitches.find((p) => p.id === id) || null;
  }

  function setActivePitch(id) {
    if (!blob.pitches.some((p) => p.id === id)) return;
    if (blob.activeId === id) return;
    blob.activeId = id;
    save();
    fire("tinker:active-pitch-changed");
  }

  // Set or clear the founder's personal recognition label for a
  // pitch. Empty / whitespace-only input clears it (so the dropdown
  // falls back to just the AI title). Does NOT touch aiTitle —
  // personal names sit alongside, they never replace.
  function setPersonalTitle(id, newTitle) {
    const p = blob.pitches.find((x) => x.id === id);
    if (!p) return false;
    const trimmed = typeof newTitle === "string" ? newTitle.trim() : "";
    if (!trimmed) {
      p.personalTitle = null;
    } else {
      const clean = sanitizePersonalTitle(trimmed);
      if (!clean) return false;
      p.personalTitle = clean;
    }
    save();
    fire("tinker:pitches-changed");
    return true;
  }

  // Back-compat alias for setPersonalTitle. The dropdown UI used to
  // call renamePitch when the founder edited the title; under the
  // new two-title model that input edits the personal recognition
  // name, not the AI-generated one.
  function renamePitch(id, newTitle) {
    return setPersonalTitle(id, newTitle);
  }

  // Personal titles: free-form, but capped at 30 chars so the
  // dropdown chip stays readable. Allows spaces, punctuation,
  // numbers — whatever helps the founder spot the pitch fast.
  function sanitizePersonalTitle(s) {
    if (typeof s !== "string") return null;
    const trimmed = s.trim();
    if (!trimmed) return null;
    return trimmed.length > 30 ? trimmed.slice(0, 30) : trimmed;
  }

  function upsertPhrase({ pitchId, deckHeading, writingId, offset, length, addedAt }) {
    if (!DECK_HEADINGS.includes(deckHeading)) return;
    if (typeof writingId !== "string" || !writingId) return;
    if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) return;

    const targetId = pitchId || effectiveActiveId();
    let pitch = blob.pitches.find((p) => p.id === targetId);

    // Cold-start: no pitches yet. Create the first one with no
    // title; the next /api/pitches/organize run will name it from
    // the writings now slotted into its deck.
    if (!pitch) {
      pitch = createPitchInternal({ aiTitle: null, personalTitle: null });
    }

    // Remove this writing from every pitch (across the whole blob) so
    // a re-classification can't leave duplicate copies behind.
    clearWritingFromAllPitchesInternal(writingId);

    const list = Array.isArray(pitch.deck[deckHeading]) ? pitch.deck[deckHeading] : [];
    list.push({ writingId, offset, length, addedAt: addedAt || Date.now() });
    list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    pitch.deck[deckHeading] = list.slice(0, MAX_PHRASES_PER_HEADING);

    pitch.meta = pitch.meta || {};
    pitch.meta.mostRecentlyTouched = deckHeading;
    pitch.meta.lastClassifyFailedAt = null;
    pitch.meta.expanded = { ...(pitch.meta.expanded || {}) };
    pitch.meta.expanded[deckHeading] = true;

    save();
    fire("tinker:pitches-changed");
  }

  function clearWritingFromAllPitches(writingId) {
    if (!writingId) return;
    const touched = clearWritingFromAllPitchesInternal(writingId);
    if (touched) {
      save();
      fire("tinker:pitches-changed");
    }
  }

  function clearWritingFromAllPitchesInternal(writingId) {
    let touched = false;
    for (const pitch of blob.pitches) {
      for (const h of DECK_HEADINGS) {
        const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
        const filtered = list.filter((p) => p.writingId !== writingId);
        if (filtered.length !== list.length) {
          pitch.deck[h] = filtered;
          touched = true;
        }
      }
    }
    return touched;
  }

  function markClassifyFailed(pitchId) {
    const pitch = blob.pitches.find((p) => p.id === (pitchId || effectiveActiveId()));
    if (!pitch) return;
    pitch.meta = pitch.meta || {};
    pitch.meta.lastClassifyFailedAt = Date.now();
    save();
    fire("tinker:pitches-changed");
  }

  function markClassifySucceeded(pitchId) {
    const pitch = blob.pitches.find((p) => p.id === (pitchId || effectiveActiveId()));
    if (!pitch || !pitch.meta || !pitch.meta.lastClassifyFailedAt) return;
    pitch.meta.lastClassifyFailedAt = null;
    save();
    fire("tinker:pitches-changed");
  }

  function toggleExpanded(pitchId, deckHeading) {
    const pitch = blob.pitches.find((p) => p.id === (pitchId || effectiveActiveId()));
    if (!pitch) return;
    pitch.meta = pitch.meta || {};
    pitch.meta.expanded = pitch.meta.expanded || {};
    const isOpen = deckHeading in pitch.meta.expanded ? !!pitch.meta.expanded[deckHeading] : true;
    pitch.meta.expanded[deckHeading] = !isOpen;
    save();
    fire("tinker:pitches-changed");
  }

  function createPitchInternal({ aiTitle, personalTitle }) {
    const pitch = {
      id: uid(),
      aiTitle: aiTitle || null,
      personalTitle: personalTitle || null,
      aiTitleSourceHash: null,
      deck: emptyDeck(),
      meta: { mostRecentlyTouched: null, expanded: {}, lastClassifyFailedAt: null },
      createdAt: Date.now(),
    };
    blob.pitches.push(pitch);
    if (!blob.activeId) blob.activeId = pitch.id;
    return pitch;
  }

  // ── Off-pitch + organize ─────────────────────────────────────────
  //
  // The actual clustering + naming work happens server-side in
  // /api/pitches/organize. The client just identifies whether
  // anything has drifted since the last trigger and, if so, fires a
  // single debounced POST. The job persists the new blob to
  // TinkerUserData and returns it; we fold the reply back in place
  // of our local blob.

  function writingIdsInAnyPitch() {
    const ids = new Set();
    for (const pitch of blob.pitches) {
      for (const h of DECK_HEADINGS) {
        const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
        for (const rec of list) ids.add(rec.writingId);
      }
    }
    return ids;
  }

  function listOffPitchWritings() {
    const known = writingIdsInAnyPitch();
    const out = [];
    for (const e of loadEssays()) {
      if (!e || typeof e.id !== "string") continue;
      const body = String(e.body || "").trim();
      if (!body) continue;
      if (known.has(e.id)) continue;
      out.push({ id: e.id, body, kind: "essay", record: e });
    }
    for (const d of loadDrafts()) {
      if (!d || typeof d.id !== "string") continue;
      const body = bodyForDraft(d).trim();
      if (!body) continue;
      if (known.has(d.id)) continue;
      out.push({ id: d.id, body, kind: "draft", record: d });
    }
    return out;
  }

  // Stable hash of (off-pitch ids ⊕ pitch ids needing a fresh AI
  // name). Same hash → no work for the backend job → skip the POST
  // entirely. The job itself is idempotent, so this is purely a
  // round-trip saver.
  function organizeHash() {
    const offIds = listOffPitchWritings().map((w) => w.id).sort();
    const staleIds = [];
    for (const p of blob.pitches) {
      const writingIds = new Set();
      for (const h of DECK_HEADINGS) {
        for (const rec of (p.deck[h] || [])) writingIds.add(rec.writingId);
      }
      if (writingIds.size === 0) continue;
      const sorted = Array.from(writingIds).sort();
      let inner = 5381;
      for (const id of sorted) {
        for (let i = 0; i < id.length; i++) inner = ((inner << 5) + inner + id.charCodeAt(i)) | 0;
      }
      const writingsHash = `${(inner >>> 0).toString(36)}_${sorted.length}`;
      if (!p.aiTitle || writingsHash !== p.aiTitleSourceHash) staleIds.push(p.id);
    }
    staleIds.sort();
    let h = 5381;
    const mix = (s) => {
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      h = ((h << 5) + h + 124) | 0;
    };
    for (const x of offIds) mix(x);
    h = ((h << 5) + h + 999) | 0;
    for (const x of staleIds) mix(x);
    return `h${(h >>> 0).toString(36)}_${offIds.length}_${staleIds.length}`;
  }

  function scheduleOrganize() {
    if (organizeTimer) clearTimeout(organizeTimer);
    organizeTimer = setTimeout(() => {
      organizeTimer = null;
      triggerOrganize().catch(() => { /* logged inside */ });
    }, ORGANIZE_DEBOUNCE_MS);
  }

  async function triggerOrganize() {
    if (organizeInflight) return;

    const hash = organizeHash();
    // Nothing drifted; the persisted server blob is already current.
    if (hash === lastOrganizeHash) return;

    let token = "";
    try { token = localStorage.getItem(TOKEN_KEY) || ""; }
    catch { /* ignore */ }
    if (!token) return;

    organizeInflight = true;
    lastOrganizeHash = hash;
    try {
      const res = await fetch("/api/pitches/organize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        // Body is empty — the server reads essays/drafts/pitches
        // straight from TinkerUserData. Whatever the client just
        // PUT via the sync layer is what the job sees.
        body: "{}",
      });
      if (!res.ok) {
        try { console.warn(`[tinker.pitches] organize ${res.status}`); }
        catch { /* ignore */ }
        // Clear the hash so a retry on the next event isn't skipped.
        lastOrganizeHash = null;
        return;
      }
      const json = await res.json().catch(() => null);
      if (!json || !json.pitches || typeof json.pitches !== "object") return;
      applyServerBlob(json.pitches);
    } catch (err) {
      try { console.warn(`[tinker.pitches] organize network error`, err); }
      catch { /* ignore */ }
      lastOrganizeHash = null;
    } finally {
      organizeInflight = false;
    }
  }

  // Replace the in-memory blob with the server's authoritative one
  // and re-mirror to localStorage. The sync layer already wrote it
  // during hydrate; this path covers the case where the organize
  // call returns a fresh blob mid-session.
  function applyServerBlob(serverBlob) {
    saveJson(PITCHES_KEY, serverBlob);
    blob = loadPitchesBlob();
    fire("tinker:pitches-changed");
  }

  // ── Server hydrate ────────────────────────────────────────────────

  function reloadFromStorage() {
    blob = loadPitchesBlob();
    fire("tinker:pitches-changed");
  }

  // ── Publish ───────────────────────────────────────────────────────
  //
  // Resolve a pitch's deck into a flat { [heading]: ["verbatim", ...] }
  // map and POST it to /api/publish/pitch. The server stitches the
  // phrases into a Marp post and stores it under TinkerUserData
  // (userId, "published:<slug>") so the daily-beginner reader can pull
  // it down.

  function resolveDeckPhrases(pitch) {
    const out = {};
    if (!pitch || !pitch.deck) return out;
    for (const h of DECK_HEADINGS) {
      const recs = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      const phrases = [];
      for (const rec of recs) {
        const body = bodyForWriting(rec.writingId);
        if (!body) continue;
        if (rec.offset < 0 || rec.offset + rec.length > body.length) continue;
        const slice = body.slice(rec.offset, rec.offset + rec.length);
        const phrase = String(slice).replace(/\s+/g, " ").trim();
        if (phrase) phrases.push(phrase);
      }
      if (phrases.length) out[h] = phrases;
    }
    return out;
  }

  function displayTitleFor(pitch) {
    if (!pitch) return "";
    const personal = typeof pitch.personalTitle === "string" ? pitch.personalTitle.trim() : "";
    if (personal) return personal;
    const ai = typeof pitch.aiTitle === "string" ? pitch.aiTitle.trim() : "";
    return ai || "";
  }

  async function publishPitch(pitchId) {
    const pitch = getPitch(pitchId);
    if (!pitch) return { ok: false, error: "Unknown pitch" };
    const title = displayTitleFor(pitch);
    if (!title) return { ok: false, error: "Pitch has no title yet" };
    const slides = resolveDeckPhrases(pitch);
    if (!Object.keys(slides).length) {
      return { ok: false, error: "Pitch has no resolved phrases to publish" };
    }
    const t = (function () {
      try { return localStorage.getItem(TOKEN_KEY) || ""; }
      catch { return ""; }
    })();
    if (!t) return { ok: false, error: "Not signed in" };

    let res;
    try {
      res = await fetch("/api/publish/pitch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({ title, slides }),
      });
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (!res.ok || !json || !json.ok) {
      return { ok: false, error: (json && json.error) || `HTTP ${res.status}` };
    }
    fire("tinker:pitch-published");
    return {
      ok: true,
      slug: json.slug,
      readerUrl: json.readerUrl,
      beatCount: json.beatCount,
      updatedAt: json.updatedAt,
    };
  }

  // Build the inputs the founders' "prepare a video script" view
  // needs from a pitch: the display title + every slide whose resolved
  // phrases survived the writing-source lookup, plus a per-slide
  // suggested speaking duration (rounded to the nearest 5 seconds,
  // floored at 10 and capped at 60 — based on ~130 spoken words/min,
  // which is the deliberate on-camera rate, not the read-silently
  // rate). Slides with no resolved phrases are dropped so the
  // storyboard only shows what the founder actually has copy for.
  function getPitchScript(pitchId) {
    const pitch = pitchId ? blob.pitches.find((p) => p.id === pitchId) : null;
    if (!pitch) return null;
    const resolved = resolveDeckPhrases(pitch);
    const slides = [];
    for (const heading of DECK_HEADINGS) {
      const phrases = resolved[heading];
      if (!phrases || !phrases.length) continue;
      const wordCount = phrases.reduce(
        (n, p) => n + String(p).trim().split(/\s+/).filter(Boolean).length,
        0,
      );
      const raw = (wordCount / 130) * 60;
      const rounded = Math.max(10, Math.min(60, Math.ceil(raw / 5) * 5));
      slides.push({ heading, phrases, seconds: rounded });
    }
    return { title: displayTitleFor(pitch), slides };
  }

  // ── Public surface ────────────────────────────────────────────────

  const api = {
    DECK_HEADINGS: DECK_HEADINGS.slice(),
    getPitches,
    getActivePitchId,
    getActivePitch,
    getPitch,
    setActivePitch,
    setPersonalTitle,
    renamePitch,
    upsertPhrase,
    clearWritingFromAllPitches,
    markClassifyFailed,
    markClassifySucceeded,
    toggleExpanded,
    pitchRobustness,
    listOffPitchWritings,
    publishPitch,
    getPitchScript,
    scheduleOrganize,
    triggerOrganize,
    // Back-compat alias for callers still on the old name. The
    // behaviour is now "ping the backend job, debounced".
    scheduleRegenerate: scheduleOrganize,
    snapshot() { return JSON.parse(JSON.stringify(blob)); },
  };
  window.tinkerPitches = api;
  // Back-compat alias for any in-flight code still referencing the
  // earlier alt-pitches name. Removable once we've shipped a few
  // builds past v0.104.
  window.tinkerAltPitches = api;

  // ── Event hooks ────────────────────────────────────────────────────
  //
  // Boot and hydrate no longer fire the organize job — they just
  // reload from storage so the UI reflects whatever the sync layer
  // pulled from the server. Organization happens after writing
  // changes, off the app-load path. Auth-changed is treated as a
  // writing event because a fresh sign-in might surface essays /
  // drafts the local browser has never seen before.

  window.addEventListener("tinker:writing-saved", () => {
    scheduleOrganize();
  });

  window.addEventListener("tinker:hydrated", () => {
    reloadFromStorage();
  });

  window.addEventListener("tinker:auth-changed", () => {
    scheduleOrganize();
  });

  function boot() {
    fire("tinker:pitches-changed");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
