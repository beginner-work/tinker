/* tinker — pitches (v0.104)
 *
 * The founder's writings live in one or more pitches. Each pitch is a
 * full eleven-slide deck — same shape as pitch-deck.md — with verbatim
 * phrases from the founder's drafts and essays slotted under each
 * heading. Pitches are renamable, equal-status (no "main" vs "alt"),
 * and the active selection defaults to the most robust pitch (most
 * deck headings covered by at least one phrase).
 *
 * This module owns the unified state. The sidebar tree renders the
 * active pitch's deck, the same way it used to render the singular
 * tree blob.
 *
 * Storage:
 *   - tinker.pitches.v1
 *       {
 *         pitches: [
 *           {
 *             id: "p_<8>",
 *             title: "<one capitalized word>" | null,
 *             autoTitled: bool,           // false once the founder renames
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
 * title that gets auto-named on the next online boot.
 *
 * Events:
 *   - "tinker:pitches-changed"        any pitch state changed.
 *   - "tinker:active-pitch-changed"   active selection changed.
 *
 * Wired into tinker:writing-saved: when a fresh classify lands and
 * the writing wasn't placed in any pitch's deck (the universal
 * classifier returned null), schedule a rehome via /api/alt-pitches
 * so the writing finds — or seeds — its own pitch.
 */

(() => {
  "use strict";

  const PITCHES_KEY = "tinker.pitches.v1";
  const LEGACY_TREE_KEY = "tinker.tree.v1";
  const DRAFTS_KEY = "tinker.drafts.v1";
  const ESSAYS_KEY = "tinker.essays.v1";
  const TOKEN_KEY = "tinker_jwt";

  const REGEN_DEBOUNCE_MS = 1500;
  const MAX_PHRASES_PER_HEADING = 2;

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
        title: null,
        autoTitled: true,
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
      const title = typeof p.title === "string" ? p.title : null;
      const autoTitled = p.autoTitled !== false;
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
        title,
        autoTitled,
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
  let regenTimer = null;
  let regenInflight = false;
  let lastRegenHash = null;
  // Tracks which auto-titled pitches we've already kicked off a
  // naming call for, so a transient failure doesn't loop on every
  // event.
  const lastNameAttemptAt = new Map();

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
      title: displayTitle(p),
      autoTitled: p.autoTitled,
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

  function renamePitch(id, newTitle) {
    const p = blob.pitches.find((x) => x.id === id);
    if (!p) return false;
    const clean = sanitizeTitle(newTitle);
    if (!clean) return false;
    p.title = clean;
    p.autoTitled = false;
    save();
    fire("tinker:pitches-changed");
    return true;
  }

  // Titles are model-generated or founder-edited. We allow a single
  // capitalized word (matches the API's contract) so the dropdown
  // stays tight. Anything else gets normalized to its first word.
  function sanitizeTitle(s) {
    if (typeof s !== "string") return null;
    const trimmed = s.trim();
    if (!trimmed) return null;
    const firstWord = trimmed.split(/\s+/)[0];
    const stripped = firstWord.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    if (stripped.length < 1 || stripped.length > 14) return null;
    return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
  }

  function displayTitle(p) {
    if (p.title) return p.title;
    return "Untitled";
  }

  function upsertPhrase({ pitchId, deckHeading, writingId, offset, length, addedAt }) {
    if (!DECK_HEADINGS.includes(deckHeading)) return;
    if (typeof writingId !== "string" || !writingId) return;
    if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) return;

    const targetId = pitchId || effectiveActiveId();
    let pitch = blob.pitches.find((p) => p.id === targetId);

    // Cold-start: no pitches yet. Create the first one with a
    // placeholder title; the auto-namer will fill it in shortly.
    if (!pitch) {
      pitch = createPitchInternal({ title: null, autoTitled: true });
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

  function createPitchInternal({ title, autoTitled }) {
    const pitch = {
      id: uid(),
      title: title || null,
      autoTitled: autoTitled !== false,
      deck: emptyDeck(),
      meta: { mostRecentlyTouched: null, expanded: {}, lastClassifyFailedAt: null },
      createdAt: Date.now(),
    };
    blob.pitches.push(pitch);
    if (!blob.activeId) blob.activeId = pitch.id;
    return pitch;
  }

  // ── Off-pitch + rehome ───────────────────────────────────────────

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

  // Stable hash of (off-pitch id set ⊕ existing pitch titles). Same
  // off-pitch ids AND same set of existing pitch contexts → same hash
  // → skip the API call. Bumps when a new alt pitch lands or a
  // writing flips in/out of being slotted.
  function rehomeHash(offIds, existingTitles) {
    const ids = offIds.slice().sort();
    const titles = existingTitles.slice().sort();
    let h = 5381;
    const mix = (s) => {
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      h = ((h << 5) + h + 124) | 0;
    };
    for (const x of ids) mix(x);
    h = ((h << 5) + h + 999) | 0;
    for (const x of titles) mix(x);
    return `h${(h >>> 0).toString(36)}_${ids.length}_${titles.length}`;
  }

  function scheduleRegenerate() {
    if (regenTimer) clearTimeout(regenTimer);
    regenTimer = setTimeout(() => {
      regenTimer = null;
      regenerate().catch(() => { /* logged inside */ });
      autoNamePitches().catch(() => { /* logged inside */ });
    }, REGEN_DEBOUNCE_MS);
  }

  async function regenerate() {
    if (regenInflight) return;
    const off = listOffPitchWritings();
    const existingPitchTitles = blob.pitches
      .map((p) => p.title)
      .filter((t) => typeof t === "string" && t.length > 0);

    if (off.length === 0) return;

    const hash = rehomeHash(off.map((w) => w.id), existingPitchTitles);
    if (hash === lastRegenHash) return;

    let token = "";
    try { token = localStorage.getItem(TOKEN_KEY) || ""; }
    catch { /* ignore */ }
    if (!token) return;

    regenInflight = true;
    lastRegenHash = hash;
    try {
      const res = await fetch("/api/alt-pitches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode: "cluster",
          writings: off.map((w) => ({ id: w.id, snippet: w.body })),
          existingPitchTitles,
        }),
      });
      if (!res.ok) {
        try { console.warn(`[tinker.pitches] rehome ${res.status}`); }
        catch { /* ignore */ }
        return;
      }
      const json = await res.json().catch(() => null);
      if (!json || !Array.isArray(json.pitches)) return;

      foldRehomeResults(json.pitches);
    } catch (err) {
      try { console.warn(`[tinker.pitches] rehome network error`, err); }
      catch { /* ignore */ }
    } finally {
      regenInflight = false;
    }
  }

  // Apply server rehome output to local pitches. Each input pitch is
  // either tied to an existing pitch (by title match) or seeds a new
  // one. Each writing inside gets folded via upsertPhrase so the
  // deck-slot bookkeeping (cap, sort, mostRecentlyTouched) runs the
  // same way as the live classify flow.
  function foldRehomeResults(rehomedPitches) {
    let changed = false;
    for (const incoming of rehomedPitches) {
      if (!incoming || typeof incoming !== "object") continue;
      const title = sanitizeTitle(incoming.title);
      if (!title) continue;
      let pitch = blob.pitches.find(
        (p) => (p.title || "").toLowerCase() === title.toLowerCase(),
      );
      if (!pitch) {
        pitch = createPitchInternal({ title, autoTitled: true });
        changed = true;
      }

      const writings = Array.isArray(incoming.writings) ? incoming.writings : [];
      for (const w of writings) {
        if (!w || typeof w !== "object") continue;
        if (typeof w.id !== "string") continue;
        if (!DECK_HEADINGS.includes(w.deckHeading)) continue;
        const phrase = w.phrase;
        if (!phrase || typeof phrase !== "object") continue;
        if (typeof phrase.offset !== "number" || typeof phrase.length !== "number") continue;
        upsertPhrase({
          pitchId: pitch.id,
          deckHeading: w.deckHeading,
          writingId: w.id,
          offset: phrase.offset,
          length: phrase.length,
          addedAt: Date.now(),
        });
        changed = true;
      }
    }
    if (changed) {
      save();
      fire("tinker:pitches-changed");
    }
  }

  // For any pitch with autoTitled=true and a null/empty title, ask
  // the model to name it from its current writings. Cheap call (one
  // bucket, one title). Rate-limited per-pitch so a failing endpoint
  // doesn't loop.
  async function autoNamePitches() {
    const candidates = blob.pitches.filter((p) => p.autoTitled && !p.title);
    if (candidates.length === 0) return;

    let token = "";
    try { token = localStorage.getItem(TOKEN_KEY) || ""; }
    catch { /* ignore */ }
    if (!token) return;

    for (const pitch of candidates) {
      const lastAttempt = lastNameAttemptAt.get(pitch.id) || 0;
      if (Date.now() - lastAttempt < 10000) continue;
      lastNameAttemptAt.set(pitch.id, Date.now());

      const writingIds = new Set();
      for (const h of DECK_HEADINGS) {
        for (const rec of (pitch.deck[h] || [])) writingIds.add(rec.writingId);
      }
      const writings = [];
      for (const id of writingIds) {
        const body = bodyForWriting(id);
        if (body && body.trim()) writings.push({ id, snippet: body });
      }
      if (writings.length === 0) continue;

      try {
        const res = await fetch("/api/alt-pitches", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ mode: "name", writings }),
        });
        if (!res.ok) continue;
        const json = await res.json().catch(() => null);
        const first = json && Array.isArray(json.pitches) ? json.pitches[0] : null;
        const title = first && sanitizeTitle(first.title);
        if (title) {
          pitch.title = title;
          save();
          fire("tinker:pitches-changed");
        }
      } catch { /* ignore; will retry on next regenerate */ }
    }
  }

  // ── Server hydrate ────────────────────────────────────────────────

  function reloadFromStorage() {
    blob = loadPitchesBlob();
    fire("tinker:pitches-changed");
  }

  // ── Public surface ────────────────────────────────────────────────

  const api = {
    DECK_HEADINGS: DECK_HEADINGS.slice(),
    getPitches,
    getActivePitchId,
    getActivePitch,
    getPitch,
    setActivePitch,
    renamePitch,
    upsertPhrase,
    clearWritingFromAllPitches,
    markClassifyFailed,
    markClassifySucceeded,
    toggleExpanded,
    pitchRobustness,
    listOffPitchWritings,
    scheduleRegenerate,
    regenerate,
    snapshot() { return JSON.parse(JSON.stringify(blob)); },
  };
  window.tinkerPitches = api;
  // Back-compat alias for any in-flight code still referencing the
  // earlier alt-pitches name. Removable once we've shipped a few
  // builds past v0.104.
  window.tinkerAltPitches = api;

  // ── Event hooks ────────────────────────────────────────────────────

  window.addEventListener("tinker:writing-saved", () => {
    scheduleRegenerate();
  });

  window.addEventListener("tinker:hydrated", () => {
    reloadFromStorage();
    scheduleRegenerate();
  });

  window.addEventListener("tinker:auth-changed", () => {
    scheduleRegenerate();
  });

  function boot() {
    fire("tinker:pitches-changed");
    scheduleRegenerate();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
