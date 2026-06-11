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
 *         focusPitchId: "<pitchId>" | null, // gather mode — the organize job
 *                                           // routes every writing into this
 *                                           // one pitch until it's cleared
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
        focusPitchId: null,
        _migratedFromTree: true,
      };
    }

    return { pitches: [], activeId: null, focusPitchId: null, _migratedFromTree: false };
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
    // Gather mode survives the round-trip: the server organizer owns
    // setting/clearing focusPitchId, but every local save rewrites the
    // whole blob, so dropping it here would silently turn gathering off.
    const focusPitchId = typeof raw.focusPitchId === "string" && pitches.some((p) => p.id === raw.focusPitchId)
      ? raw.focusPitchId
      : null;
    return { pitches, activeId, focusPitchId, _migratedFromTree: !!raw._migratedFromTree };
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

    // Cold-start: no pitches yet. Create the first one with no
    // title; the next /api/pitches/organize run will name it from
    // the writings now slotted into its deck.
    if (!pitch) {
      pitch = createPitchInternal({ aiTitle: null, personalTitle: null });
    }

    // Don't evict a pinned phrase from a locked target beat.
    const lockedMeta = (pitch.meta && pitch.meta.locked) || {};
    if (
      lockedMeta[deckHeading] &&
      Array.isArray(pitch.deck[deckHeading]) &&
      pitch.deck[deckHeading].length > 0
    ) {
      return;
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
    touch(pitch, addedAt);

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
      const locked = (pitch.meta && pitch.meta.locked) || {};
      for (const h of DECK_HEADINGS) {
        if (locked[h]) continue; // a locked beat is frozen — never strip it
        const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
        const filtered = list.filter((p) => p.writingId !== writingId);
        if (filtered.length !== list.length) {
          pitch.deck[h] = filtered;
          touch(pitch);
          touched = true;
        }
      }
    }
    return touched;
  }

  // True when `writingId` is the phrase pinned in a locked beat anywhere
  // in the blob. A locked writing is frozen in place: the engine won't
  // move it into another beat or duplicate it elsewhere.
  function writingIsLockedSomewhere(writingId) {
    for (const pitch of blob.pitches) {
      const locked = (pitch.meta && pitch.meta.locked) || {};
      for (const h of DECK_HEADINGS) {
        if (!locked[h]) continue;
        for (const rec of (Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [])) {
          if (rec.writingId === writingId) return true;
        }
      }
    }
    return false;
  }

  // ── Section locking ───────────────────────────────────────────────
  //
  // The founder pins a deck beat (one of the eleven headings) that feels
  // good. A locked beat is frozen against every automated path: the
  // "Refresh all pitches" redistribute keeps it, a per-pitch refresh
  // keeps it, and a newly auto-classified writing can't move into or out
  // of it. Only the founder, by unlocking, lets it move again. Lock
  // state lives in pitch.meta.locked, persisted + synced with the blob.

  function isSectionLocked(pitchId, deckHeading) {
    const pitch = blob.pitches.find((p) => p.id === (pitchId || effectiveActiveId()));
    return !!(pitch && pitch.meta && pitch.meta.locked && pitch.meta.locked[deckHeading]);
  }

  // The headings currently locked on a pitch, in deck order. Defaults to
  // the active pitch when no id is given. [] when nothing is locked.
  function lockedHeadings(pitchId) {
    const pitch = blob.pitches.find((p) => p.id === (pitchId || effectiveActiveId()));
    if (!pitch || !pitch.meta || !pitch.meta.locked) return [];
    return DECK_HEADINGS.filter((h) => !!pitch.meta.locked[h]);
  }

  function setSectionLock(pitchId, deckHeading, locked) {
    if (!DECK_HEADINGS.includes(deckHeading)) return false;
    const pitch = blob.pitches.find((p) => p.id === (pitchId || effectiveActiveId()));
    if (!pitch) return false;
    pitch.meta = pitch.meta || {};
    pitch.meta.locked = { ...(pitch.meta.locked || {}) };
    if (locked) pitch.meta.locked[deckHeading] = true;
    else delete pitch.meta.locked[deckHeading];
    touch(pitch);
    save();
    fire("tinker:pitches-changed");
    return true;
  }

  function toggleSectionLock(pitchId, deckHeading) {
    return setSectionLock(pitchId, deckHeading, !isSectionLocked(pitchId, deckHeading));
  }

  // ── Manual placement ──────────────────────────────────────────────
  //
  // The founder drags an essay onto a slide. Unlike upsertPhrase (the
  // automated path, which defers to pins), a manual move is the founder
  // speaking — it always wins. The writing keeps its verbatim phrase
  // record and lands under the target heading; if another writing
  // already holds that slide the two swap, so nothing the founder can
  // see falls off the deck. The target slide is pinned afterwards:
  // "I put this here" is exactly what a pin means, and the next AI
  // reorganization keeps it.
  function moveWriting({ pitchId, writingId, deckHeading }) {
    if (!DECK_HEADINGS.includes(deckHeading)) return false;
    if (typeof writingId !== "string" || !writingId) return false;
    const pitch = blob.pitches.find((p) => p.id === (pitchId || effectiveActiveId()));
    if (!pitch) return false;

    // Find the writing's current slot on this pitch.
    let fromHeading = null;
    let movedRec = null;
    for (const h of DECK_HEADINGS) {
      const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      const rec = list.find((r) => r.writingId === writingId);
      if (rec) { fromHeading = h; movedRec = rec; break; }
    }
    if (!movedRec || fromHeading === deckHeading) return false;

    const targetList = Array.isArray(pitch.deck[deckHeading]) ? pitch.deck[deckHeading] : [];
    const displaced = targetList.length > 0 ? targetList[0] : null;

    pitch.deck[fromHeading] = pitch.deck[fromHeading].filter((r) => r.writingId !== writingId);
    pitch.deck[deckHeading] = [movedRec];
    if (displaced) pitch.deck[fromHeading] = [displaced];

    pitch.meta = pitch.meta || {};
    pitch.meta.locked = { ...(pitch.meta.locked || {}) };
    pitch.meta.locked[deckHeading] = true;
    pitch.meta.mostRecentlyTouched = deckHeading;
    pitch.meta.expanded = { ...(pitch.meta.expanded || {}) };
    pitch.meta.expanded[deckHeading] = true;
    touch(pitch);

    save();
    fire("tinker:pitches-changed");
    return true;
  }

  // ── Tidy (no AI) ─────────────────────────────────────────────────
  //
  // The deterministic half of "reorganize": clean up what's provably
  // stale without sending a single byte to a model. Drops phrase
  // records whose writing no longer exists (or whose offsets no longer
  // resolve to text), then prunes pitches that ended up with nothing —
  // keeping any pitch the founder personally named. Returns counts so
  // the caller can say exactly what happened.
  function tidyPitches() {
    let droppedRecords = 0;
    for (const pitch of blob.pitches) {
      for (const h of DECK_HEADINGS) {
        const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
        const kept = list.filter((rec) => {
          const body = bodyForWriting(rec.writingId);
          if (!body) return false;
          if (rec.offset < 0 || rec.offset + rec.length > body.length) return false;
          return !!body.slice(rec.offset, rec.offset + rec.length);
        });
        if (kept.length !== list.length) {
          droppedRecords += list.length - kept.length;
          pitch.deck[h] = kept;
          touch(pitch);
        }
      }
    }
    const before = blob.pitches.length;
    blob.pitches = blob.pitches.filter((pitch) => {
      const hasWritings = DECK_HEADINGS.some(
        (h) => Array.isArray(pitch.deck[h]) && pitch.deck[h].length > 0,
      );
      const hasPersonalTitle =
        typeof pitch.personalTitle === "string" && pitch.personalTitle.trim().length > 0;
      return hasWritings || hasPersonalTitle;
    });
    const prunedPitches = before - blob.pitches.length;
    if (blob.activeId && !blob.pitches.some((p) => p.id === blob.activeId)) {
      blob.activeId = null;
    }
    if (blob.focusPitchId && !blob.pitches.some((p) => p.id === blob.focusPitchId)) {
      blob.focusPitchId = null;
    }
    if (droppedRecords > 0 || prunedPitches > 0) {
      save();
      fire("tinker:pitches-changed");
    }
    return { droppedRecords, prunedPitches };
  }

  // Gather mode state. Set server-side by the organize job when the
  // founder gathers everything into one pitch; null means multi-pitch.
  function getFocusPitchId() {
    if (blob.focusPitchId && blob.pitches.some((p) => p.id === blob.focusPitchId)) {
      return blob.focusPitchId;
    }
    return null;
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
      meta: { mostRecentlyTouched: null, expanded: {}, locked: {}, lastClassifyFailedAt: null },
      createdAt: Date.now(),
      updatedAt: Date.now(),
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

  // A snapshot of "where every writing currently lives". Compared
  // before/after an organize round so triggerOrganizeNow can return a
  // diff — which essay moved between pitches, which pitch was renamed —
  // instead of guessing from one half of the state.
  function placementSnapshot() {
    const writings = {};   // writingId → { pitchId, deckHeading }
    const titles = {};     // pitchId → displayName
    for (const pitch of blob.pitches) {
      titles[pitch.id] = pitch.personalTitle || pitch.aiTitle || null;
      for (const h of DECK_HEADINGS) {
        const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
        for (const rec of list) {
          writings[rec.writingId] = { pitchId: pitch.id, deckHeading: h };
        }
      }
    }
    return { writings, titles };
  }

  function diffSnapshots(before, after) {
    const movedWritings = [];
    const seen = new Set();
    for (const id of Object.keys(after.writings || {})) {
      seen.add(id);
      const a = after.writings[id];
      const b = (before.writings || {})[id] || null;
      if (!b) {
        movedWritings.push({
          writingId: id,
          fromPitchId: null, fromDeckHeading: null,
          toPitchId: a.pitchId, toDeckHeading: a.deckHeading,
        });
      } else if (b.pitchId !== a.pitchId || b.deckHeading !== a.deckHeading) {
        movedWritings.push({
          writingId: id,
          fromPitchId: b.pitchId, fromDeckHeading: b.deckHeading,
          toPitchId: a.pitchId, toDeckHeading: a.deckHeading,
        });
      }
    }
    for (const id of Object.keys(before.writings || {})) {
      if (seen.has(id)) continue;
      const b = before.writings[id];
      movedWritings.push({
        writingId: id,
        fromPitchId: b.pitchId, fromDeckHeading: b.deckHeading,
        toPitchId: null, toDeckHeading: null,
      });
    }
    const renamedPitches = [];
    for (const id of Object.keys(after.titles || {})) {
      const a = after.titles[id];
      const b = (before.titles || {})[id];
      if (b !== undefined && a !== b) renamedPitches.push({ pitchId: id, before: b, after: a });
    }
    const newPitchIds = Object.keys(after.titles || {}).filter((id) => !(id in (before.titles || {})));
    const removedPitchIds = Object.keys(before.titles || {}).filter((id) => !(id in (after.titles || {})));
    return { movedWritings, renamedPitches, newPitchIds, removedPitchIds };
  }

  // Returns { pitchId, deckHeading } for the writing, or null when
  // it's not slotted anywhere. Used by the post-publish screen to ask
  // "where did this essay actually land?" without parsing the snapshot
  // itself.
  function findPitchForWriting(writingId) {
    if (!writingId) return null;
    for (const pitch of blob.pitches) {
      for (const h of DECK_HEADINGS) {
        const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
        if (list.some((rec) => rec.writingId === writingId)) {
          return { pitchId: pitch.id, deckHeading: h };
        }
      }
    }
    return null;
  }

  // Runs the organize job immediately and returns a result the caller
  // can act on. Unlike triggerOrganize this:
  //   - cancels any pending debounce so the work isn't double-fired
  //   - ignores the organizeHash short-circuit when `force: true`, so
  //     a publish-time call always reaches the server (the client
  //     just upserted a phrase locally — the hash hasn't moved, but
  //     the rename pass on the server may still have work to do)
  //   - fires tinker:organize-started before the fetch and
  //     tinker:organize-completed with a diff after it returns
  //   - returns { ok, diff?, reason? } instead of throwing, so the
  //     caller can render an error state directly
  async function triggerOrganizeNow({ force = true, redistribute = false, refreshPitchId = null, gatherPitchId = null } = {}) {
    if (organizeTimer) {
      clearTimeout(organizeTimer);
      organizeTimer = null;
    }
    if (organizeInflight) {
      return { ok: false, reason: "inflight" };
    }
    let token = "";
    try { token = localStorage.getItem(TOKEN_KEY) || ""; }
    catch { /* ignore */ }
    if (!token) return { ok: false, reason: "no-token" };

    // A redistribute, a per-pitch refresh, or a gather re-clusters
    // writings that are already slotted, so the organizeHash
    // short-circuit (which only tracks off-pitch drift) can't tell
    // whether there's work to do — always send those.
    const hash = organizeHash();
    if (!force && !redistribute && !refreshPitchId && !gatherPitchId && hash === lastOrganizeHash) {
      return { ok: true, diff: emptyDiff(), skipped: true };
    }

    const before = placementSnapshot();
    organizeInflight = true;
    lastOrganizeHash = hash;
    fire("tinker:organize-started");

    let result = { ok: false, reason: "unknown" };
    try {
      const res = await fetch("/api/pitches/organize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          gatherPitchId
            ? { gather: true, pitchId: gatherPitchId }
            : redistribute
              ? { redistribute: true }
              : refreshPitchId
                ? { refreshPitchId }
                : {},
        ),
      });
      if (!res.ok) {
        lastOrganizeHash = null;
        result = { ok: false, reason: `http-${res.status}` };
      } else {
        const json = await res.json().catch(() => null);
        if (!json || !json.pitches || typeof json.pitches !== "object") {
          result = { ok: false, reason: "bad-json" };
        } else {
          applyServerBlob(json.pitches);
          const after = placementSnapshot();
          result = { ok: true, diff: diffSnapshots(before, after) };
        }
      }
    } catch (err) {
      lastOrganizeHash = null;
      result = { ok: false, reason: "network" };
    } finally {
      organizeInflight = false;
      try {
        window.dispatchEvent(new CustomEvent("tinker:organize-completed", {
          detail: result,
        }));
      } catch { /* ignore */ }
    }
    return result;
  }

  function emptyDiff() {
    return { movedWritings: [], renamedPitches: [], newPitchIds: [], removedPitchIds: [] };
  }

  async function triggerOrganize() {
    // Thin compat shim — the debounced path doesn't need the diff,
    // but going through triggerOrganizeNow keeps a single source of
    // truth for the fetch + lifecycle events.
    await triggerOrganizeNow({ force: false });
  }

  // Founder-pressed "re-align everything". Unlike the background
  // organize (which only rehomes writings not yet in any pitch), this
  // asks the server to re-cluster the whole corpus from scratch — every
  // writing gets reconsidered, duplicate pitch names collapse, and a
  // writing that drifted into the wrong pitch can move back. If the AI
  // decides everything's already where it belongs, the diff just comes
  // back empty. Returns the same { ok, diff?, reason? } shape as
  // triggerOrganizeNow so the caller can render the outcome.
  async function redistributePitches() {
    return triggerOrganizeNow({ force: true, redistribute: true });
  }

  // Founder-pressed "gather into one pitch". Every writing flows back
  // through the clusterer with a single destination: the given pitch
  // (defaulting to the active one). Most-recent wins each slide, so the
  // founder ends up with one pitch carrying their latest considerations.
  // The server also remembers the choice (focusPitchId) — new essays keep
  // joining this pitch until the founder reorganizes multi-pitch again.
  async function gatherIntoPitch(pitchId) {
    const target = pitchId || effectiveActiveId();
    if (!target) return { ok: false, reason: "no-pitch" };
    return triggerOrganizeNow({ force: true, gatherPitchId: target });
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

  // Collect a pitch's stories — the full essays behind it, in reading
  // order, de-duplicated by writing — for the booklet the founder
  // publishes to their public beginner profile. Returns
  // { id, title, stories: [{ title, body }] }, or null for an unknown
  // pitch. A pitch with no resolved stories comes back with an empty
  // array so callers can decide whether to skip it.
  function getPitchStories(pitchId) {
    const pitch = getPitch(pitchId);
    if (!pitch) return null;
    const stories = [];
    const seen = new Set();
    for (const { writingId } of readingOrder(pitch)) {
      if (seen.has(writingId)) continue;
      seen.add(writingId);
      const story = storyForWriting(writingId);
      if (story && story.body) stories.push(story);
    }
    return { id: pitch.id, title: displayTitleFor(pitch), stories };
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

  // Everything the pamphlet view needs to lay a pitch out as flippable
  // cards, resolved in one pass: per covered heading (deck order) the
  // slide title, the essay's own title, the verbatim phrase, and the
  // full essay body for the card's flip side. Returns null for an
  // unknown pitch; slides is [] when nothing resolves yet.
  function getPitchPamphlet(pitchId) {
    const pitch = pitchId ? getPitch(pitchId) : getActivePitch();
    if (!pitch) return null;
    const slides = [];
    for (const h of DECK_HEADINGS) {
      const recs = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      for (const rec of recs) {
        const body = bodyForWriting(rec.writingId);
        if (!body) continue;
        if (rec.offset < 0 || rec.offset + rec.length > body.length) continue;
        const slice = body.slice(rec.offset, rec.offset + rec.length);
        const phrase = String(slice).replace(/\s+/g, " ").trim();
        if (!phrase) continue;
        const story = storyForWriting(rec.writingId);
        slides.push({
          heading: h,
          writingId: rec.writingId,
          phrase,
          title: (story && story.title) || "",
          body: (story && story.body) || body,
        });
        break; // MAX_PHRASES_PER_HEADING = 1
      }
    }
    return {
      id: pitch.id,
      title: displayTitleFor(pitch),
      personalTitle: pitch.personalTitle || null,
      aiTitle: pitch.aiTitle || null,
      slides,
    };
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
    isSectionLocked,
    lockedHeadings,
    setSectionLock,
    toggleSectionLock,
    moveWriting,
    tidyPitches,
    getFocusPitchId,
    markClassifyFailed,
    markClassifySucceeded,
    toggleExpanded,
    pitchRobustness,
    coveredHeadings,
    readingOrder,
    listOffPitchWritings,
    publishPitch,
    getPitchStories,
    getPitchScript,
    getPitchPamphlet,
    scheduleOrganize,
    triggerOrganize,
    triggerOrganizeNow,
    redistributePitches,
    gatherIntoPitch,
    findPitchForWriting,
    placementSnapshot,
    diffSnapshots,
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
