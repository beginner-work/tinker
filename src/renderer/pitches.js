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
 *             meta: { mostRecentlyTouched, expanded, locked, lastClassifyFailedAt },
 *             createdAt: <ts>,
 *             updatedAt: <ts>,   // last time the founder edited this pitch
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

  // Resolve a writingId to a full story — title + complete body — for the
  // booklet a founder publishes to their public beginner profile. Unlike
  // resolveDeckPhrases (which slices out the single verbatim phrase a beat
  // points at), this carries the whole essay so the public reader shows
  // the founder's writing in full. Returns null when the writing has no
  // usable body.
  function storyForWriting(writingId) {
    const drafts = loadDrafts();
    const draft = drafts.find((d) => d && d.id === writingId);
    if (draft) {
      const body = bodyForDraft(draft).trim();
      const title = String((draft.title || (draft.stitched && draft.stitched.title) || "")).trim();
      return body ? { title, body } : null;
    }
    const essays = loadEssays();
    const essay = essays.find((e) => e && e.id === writingId);
    if (essay) {
      const body = String(essay.body || "").trim();
      const title = String(essay.title || "").trim();
      return body ? { title, body } : null;
    }
    return null;
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

  // The pitch's last-edited timestamp. Newer pitch blobs carry an
  // explicit `updatedAt` that every editing path bumps (see touch()).
  // Pitches written before this field existed don't have one, so we
  // recover a sensible value from the data already on hand: the most
  // recent phrase `addedAt` across the whole deck, falling back to the
  // pitch's createdAt. This keeps "most recently edited" ordering
  // stable for legacy blobs without forcing a one-time rewrite.
  function deriveUpdatedAt(rawPitch, createdAt) {
    const explicit = Number(rawPitch && rawPitch.updatedAt);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    let latest = Number(createdAt) || 0;
    const rawDeck = rawPitch && typeof rawPitch.deck === "object" ? rawPitch.deck : {};
    for (const h of DECK_HEADINGS) {
      const recs = Array.isArray(rawDeck[h]) ? rawDeck[h] : [];
      for (const rec of recs) {
        const at = Number(rec && rec.addedAt);
        if (Number.isFinite(at) && at > latest) latest = at;
      }
    }
    return latest || Date.now();
  }

  // Stamp a pitch as just-edited. Called from every founder-facing
  // mutation (phrase upsert, title change, writing removal, creation)
  // so the switcher can order pitches most-recently-edited first.
  function touch(pitch, at) {
    if (!pitch) return;
    pitch.updatedAt = Number(at) || Date.now();
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
          locked: {},
          lastClassifyFailedAt: typeof legacyMeta.lastClassifyFailedAt === "number"
            ? legacyMeta.lastClassifyFailedAt
            : null,
        },
        createdAt: Date.now(),
      };
      firstPitch.updatedAt = deriveUpdatedAt(firstPitch, firstPitch.createdAt);
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
      const rawLocked = rawMeta.locked && typeof rawMeta.locked === "object" ? rawMeta.locked : {};
      const locked = {};
      for (const h of DECK_HEADINGS) {
        if (rawLocked[h]) locked[h] = true;
      }
      const meta = {
        mostRecentlyTouched: DECK_HEADINGS.includes(rawMeta.mostRecentlyTouched)
          ? rawMeta.mostRecentlyTouched
          : null,
        expanded: rawMeta.expanded && typeof rawMeta.expanded === "object"
          ? { ...rawMeta.expanded }
          : {},
        locked,
        lastClassifyFailedAt: typeof rawMeta.lastClassifyFailedAt === "number"
          ? rawMeta.lastClassifyFailedAt
          : null,
      };
      const createdAt = Number(p.createdAt) || Date.now();
      pitches.push({
        id,
        aiTitle,
        personalTitle,
        aiTitleSourceHash,
        deck,
        meta,
        createdAt,
        updatedAt: deriveUpdatedAt(p, createdAt),
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
  let redistributeTimer = null;
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

  // The deck headings this pitch has actually filled — i.e. headings
  // with at least one phrase record whose offset still resolves inside
  // its writing. Returned in deck order. We re-resolve at read time so
  // an edited writing doesn't keep a stale heading. This list IS the
  // pitch's "direction": which slides it leans on. Accepts a pitch id
  // or a pitch object.
  function coveredHeadings(pitchOrId) {
    const pitch = typeof pitchOrId === "string" ? getPitch(pitchOrId) : pitchOrId;
    if (!pitch || !pitch.deck) return [];
    const out = [];
    for (const h of DECK_HEADINGS) {
      const recs = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      for (const rec of recs) {
        const body = bodyForWriting(rec.writingId);
        if (!body) continue;
        if (rec.offset < 0 || rec.offset + rec.length > body.length) continue;
        const slice = body.slice(rec.offset, rec.offset + rec.length);
        if (slice) { out.push(h); break; }
      }
    }
    return out;
  }

  // The reading order of a pitch: its covered headings resolved to the
  // writings that back them, in deck order, de-duplicated by writing —
  // a writing that supplies phrases to several slides appears once, at
  // its earliest heading. This is the page sequence a reader moves
  // through, and the read view's book spread uses it to find the essay
  // that comes *next* after the one being read (and, on the last slide,
  // the one *before* it). Each entry is { writingId, heading }; the
  // resolution rules match coveredHeadings exactly so the two can't
  // drift apart. Accepts a pitch id or a pitch object.
  function readingOrder(pitchOrId) {
    const pitch = typeof pitchOrId === "string" ? getPitch(pitchOrId) : pitchOrId;
    if (!pitch || !pitch.deck) return [];
    const out = [];
    const seen = new Set();
    for (const h of DECK_HEADINGS) {
      const recs = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      for (const rec of recs) {
        const body = bodyForWriting(rec.writingId);
        if (!body) continue;
        if (rec.offset < 0 || rec.offset + rec.length > body.length) continue;
        if (!body.slice(rec.offset, rec.offset + rec.length)) continue;
        if (!seen.has(rec.writingId)) {
          seen.add(rec.writingId);
          out.push({ writingId: rec.writingId, heading: h });
        }
        break; // MAX_PHRASES_PER_HEADING = 1 — one writing per heading
      }
    }
    return out;
  }

  // Robustness = number of covered headings. Kept as its own function
  // for the many callers that just want the count.
  function pitchRobustness(pitch) {
    return coveredHeadings(pitch).length;
  }

  // Auto-pick: most robust wins (robustness = associated-essay
  // coverage across the eleven deck headings — the sharp pitch in
  // the switcher menu). Ties broken by earliest createdAt (the
  // original tinker pitch stays in pole position before alts
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
      updatedAt: Number(p.updatedAt) || p.createdAt,
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
    touch(p);
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

    // A locked beat is frozen against automated placement. If this
    // writing is already pinned in a locked beat, leave it there — don't
    // move or duplicate it into deckHeading.
    if (writingIsLockedSomewhere(writingId)) return;

    const targetId = pitchId || effectiveActiveId();
    let pitch = blob.pitches.find((p) => p.id === targetId);


  // Truncated — pitch deck client removal (TYL-65).
  window.tinkerPitches = window.tinkerPitches || {};
})();
