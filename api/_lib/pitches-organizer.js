/* The server-side organizer.
 *
 * Takes the user's full state — existing pitches blob, essays, drafts
 * — and produces an updated pitches blob. The AI calls (cluster +
 * name) are passed in as dependencies so this module stays pure and
 * testable: production code wires in the real clusterer; tests wire
 * in stubs.
 *
 * The blob shape mirrors what the client used to maintain in
 * localStorage as `tinker.pitches.v1`:
 *
 *   {
 *     pitches: [
 *       {
 *         id: "p_<8>",
 *         aiTitle: string | null,
 *         personalTitle: string | null,
 *         aiTitleSourceHash: string | null,
 *         deck: { [deckHeading]: [{ writingId, offset, length, addedAt }] },
 *         meta: { mostRecentlyTouched, expanded, lastClassifyFailedAt },
 *         createdAt: number,
 *       }
 *     ],
 *     activeId: string | null,
 *     _migratedFromTree: boolean,
 *   }
 *
 * Merge semantics: user-controlled fields (personalTitle, activeId,
 * meta.expanded, meta.mostRecentlyTouched, manually-slotted phrases)
 * are preserved across runs. The organizer only touches AI-owned
 * fields (aiTitle, aiTitleSourceHash) and rehomes writings that
 * aren't yet in any pitch's deck.
 */

"use strict";

const {
  DECK_HEADINGS,
  MAX_SNIPPET_CHARS,
  MAX_WRITINGS,
  validateTitle,
} = require("./pitches-clusterer.js");

const MAX_PHRASES_PER_HEADING = 1;

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

function uid() {
  return "p_" + Math.random().toString(36).slice(2, 10);
}

function bodyForDraft(draft) {
  if (draft && draft.stitched && draft.stitched.body) return String(draft.stitched.body);
  const turns = (draft && Array.isArray(draft.transcript)) ? draft.transcript : [];
  return turns
    .map((t) => String((t && t.a) || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function bodyForWriting(writingId, essays, drafts) {
  const draft = drafts.find((d) => d && d.id === writingId);
  if (draft) return bodyForDraft(draft);
  const essay = essays.find((e) => e && e.id === writingId);
  if (essay) return String((essay && essay.body) || "");
  return "";
}

// Normalise whatever the client/database hands us into the canonical
// blob shape. Legacy shapes (the older single-`title` field, missing
// metadata, malformed phrase records) get cleaned up here so the rest
// of the organizer can assume a well-formed structure.
function normalizeBlob(raw) {
  const safe = (raw && typeof raw === "object") ? raw : {};
  const pitches = [];
  const rawPitches = Array.isArray(safe.pitches) ? safe.pitches : [];
  for (const p of rawPitches) {
    if (!p || typeof p !== "object") continue;
    const id = typeof p.id === "string" && p.id ? p.id : uid();

    let aiTitle = typeof p.aiTitle === "string" ? p.aiTitle : null;
    let personalTitle = typeof p.personalTitle === "string" ? p.personalTitle : null;
    if (aiTitle === null && personalTitle === null && typeof p.title === "string") {
      if (p.autoTitled === false) personalTitle = p.title;
      else aiTitle = p.title;
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
  const activeId = typeof safe.activeId === "string" && pitches.some((p) => p.id === safe.activeId)
    ? safe.activeId
    : null;
  return {
    pitches,
    activeId,
    _migratedFromTree: !!safe._migratedFromTree,
  };
}

// Every writing id currently slotted in any pitch's deck. The
// complement, against the union of essays + drafts, is the set the
// organizer needs to rehome.
function writingIdsInAnyPitch(blob) {
  const ids = new Set();
  for (const pitch of blob.pitches) {
    for (const h of DECK_HEADINGS) {
      const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      for (const rec of list) ids.add(rec.writingId);
    }
  }
  return ids;
}

function listOffPitchWritings(blob, essays, drafts) {
  const known = writingIdsInAnyPitch(blob);
  const out = [];
  for (const e of essays) {
    if (!e || typeof e.id !== "string") continue;
    const body = String((e && e.body) || "").trim();
    if (!body) continue;
    if (known.has(e.id)) continue;
    out.push({ id: e.id, body });
  }
  for (const d of drafts) {
    if (!d || typeof d.id !== "string") continue;
    const body = bodyForDraft(d).trim();
    if (!body) continue;
    if (known.has(d.id)) continue;
    out.push({ id: d.id, body });
  }
  return out;
}

// Put the off-pitch writings into a canonical, device-independent order
// before they go to the clusterer. Two devices can hold the same essays +
// drafts in different array orders (the sync layer merges by id, not by
// position), and listOffPitchWritings preserves whatever order it's handed.
// Feeding the model writings in a different order can produce a different
// clustering — and, when the corpus exceeds MAX_WRITINGS, the cap would
// drop a different subset. Sorting first means the prompt (and the cap)
// depend only on the writings themselves, not on how each device happened
// to store them: newest first by the writing's own time, ties broken by id
// so the order is total and stable. Newest-first also means the cap keeps
// the most recent writings when the corpus is larger than the model budget.
function sortWritingsForClustering(off, writingTimestamps) {
  const stamps = writingTimestamps instanceof Map ? writingTimestamps : new Map();
  return off.slice().sort((a, b) => {
    const ta = Number(stamps.get(a.id)) || 0;
    const tb = Number(stamps.get(b.id)) || 0;
    if (tb !== ta) return tb - ta; // newest first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // stable tiebreak
  });
}

function snippetFor(body) {
  const trimmed = String(body || "").trim();
  if (trimmed.length > MAX_SNIPPET_CHARS) return trimmed.slice(0, MAX_SNIPPET_CHARS) + "…";
  return trimmed;
}

function clearWritingFromAllPitches(blob, writingId) {
  for (const pitch of blob.pitches) {
    for (const h of DECK_HEADINGS) {
      const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      pitch.deck[h] = list.filter((p) => p.writingId !== writingId);
    }
  }
}

// Empty every pitch's deck. Used by the redistribute pass: zeroing the
// decks turns every writing into an "off-pitch" writing, so the next
// listOffPitchWritings sweep hands the whole corpus to the clusterer
// for a from-scratch re-alignment. Pitch shells (and their personal
// titles) survive; only the phrase records are cleared. The end-of-run
// empty-pitch prune then drops any auto-named shell the re-cluster left
// without writings — which is how duplicate AI titles (four "Growth"
// pitches) collapse back into one.
function clearAllDecks(blob) {
  for (const pitch of blob.pitches) pitch.deck = emptyDeck();
}

// Empty a single pitch's deck — the scoped sibling of clearAllDecks,
// used by the per-pitch refresh. Only the target pitch's writings turn
// "off-pitch", so the next sweep hands just that pitch's corpus back to
// the clusterer while every other pitch stays put. The clusterer can
// then route those writings home (the pitch keeps its own line), into a
// sibling (consolidated), or — if they all land elsewhere and the shell
// isn't founder-named — leave it empty for the end-of-run prune to drop
// (the pitch dissolves). A no-op when the id doesn't match a pitch.
function clearOneDeck(blob, pitchId) {
  const pitch = blob.pitches.find((p) => p.id === pitchId);
  if (pitch) pitch.deck = emptyDeck();
}

// De-duplicate the title hints we feed the clusterer, case-insensitively,
// preserving the first spelling seen. When the founder has drifted into
// several identically-named pitches ("Growth" ×4), passing the raw list
// would list "Growth" four times and reinforce the very split the
// redistribute is trying to undo. One hint per distinct name lets the
// model reuse it once and route everything into a single cluster.
function dedupeTitles(titles) {
  const out = [];
  const seen = new Set();
  for (const t of titles) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function upsertPhrase(blob, { pitchId, deckHeading, writingId, offset, length, addedAt }) {
  if (!DECK_HEADINGS.includes(deckHeading)) return;
  if (typeof writingId !== "string" || !writingId) return;
  if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) return;

  const pitch = blob.pitches.find((p) => p.id === pitchId);
  if (!pitch) return;

  clearWritingFromAllPitches(blob, writingId);

  const list = Array.isArray(pitch.deck[deckHeading]) ? pitch.deck[deckHeading] : [];
  list.push({ writingId, offset, length, addedAt: addedAt || Date.now() });
  list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  pitch.deck[deckHeading] = list.slice(0, MAX_PHRASES_PER_HEADING);

  pitch.meta = pitch.meta || {};
  pitch.meta.mostRecentlyTouched = deckHeading;
  pitch.meta.lastClassifyFailedAt = null;
  pitch.meta.expanded = { ...(pitch.meta.expanded || {}) };
  pitch.meta.expanded[deckHeading] = true;
}

function titlesMatch(pitch, candidate) {
  const c = String(candidate).toLowerCase();
  return ((pitch.aiTitle || "").toLowerCase() === c)
    || ((pitch.personalTitle || "").toLowerCase() === c);
}

// Refresh every deck record's `addedAt` to the writing's own
// createdAt/updatedAt. The stored value is whatever Date.now() returned
// when the record was placed (legacy fold time, classify time, or a
// previous fold before this normalization existed) — and that's often
// LATER than a brand-new essay's createdAt. Without realigning, the
// stale fold-time stamp can outrank a newer essay's actual time when
// the fold tries to slot it into the same heading, locking the older
// essay in. Re-stamping at organize time means every later comparison
// (the fold's sort/slice, the sidebar's sort) runs on essay time.
function refreshDeckTimestamps(blob, writingTimestamps) {
  if (!(writingTimestamps instanceof Map)) return;
  for (const pitch of blob.pitches) {
    for (const h of DECK_HEADINGS) {
      const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      for (const rec of list) {
        const stamp = writingTimestamps.get(rec.writingId);
        if (Number.isFinite(stamp) && stamp > 0) rec.addedAt = stamp;
      }
    }
  }
}

// Drop deck records whose writing no longer exists in essays/drafts.
// Happens when an essay was deleted (locally or on another device) but
// the pitches blob still carries a stale phrase record pointing at it.
// The empty-pitch prune later only catches pitches with `length === 0`
// arrays — without this step a pitch with only stale records keeps a
// non-zero length, survives the prune, and surfaces in the dropdown
// with no essay to show.
function dropStaleDeckRecords(blob, knownWritingIds) {
  let dropped = 0;
  for (const pitch of blob.pitches) {
    for (const h of DECK_HEADINGS) {
      const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      const kept = list.filter((rec) => knownWritingIds.has(rec.writingId));
      if (kept.length !== list.length) {
        dropped += list.length - kept.length;
        pitch.deck[h] = kept;
      }
    }
  }
  return dropped;
}

// `writingTimestamps` is a Map<writingId, number> sourced from the
// essay/draft `createdAt`/`updatedAt`. Using the writing's own time as
// `addedAt` (instead of `Date.now()` per call) means same-slot conflicts
// during a single fold resolve to the most recent essay — without this,
// every call inside the loop shared one millisecond and the stable sort
// kept whichever writing happened to be iterated first, even when an
// older essay was placed ahead of a newer one.
function foldRehomeResults(blob, rehomedPitches, { writingTimestamps } = {}) {
  const stamps = writingTimestamps instanceof Map ? writingTimestamps : null;
  for (const incoming of rehomedPitches) {
    if (!incoming || typeof incoming !== "object") continue;
    const title = validateTitle(incoming.title);
    if (!title) continue;
    let pitch = blob.pitches.find((p) => titlesMatch(p, title));
    if (!pitch) {
      pitch = {
        id: uid(),
        aiTitle: title,
        personalTitle: null,
        aiTitleSourceHash: null,
        deck: emptyDeck(),
        meta: { mostRecentlyTouched: null, expanded: {}, lastClassifyFailedAt: null },
        createdAt: Date.now(),
      };
      blob.pitches.push(pitch);
      if (!blob.activeId) blob.activeId = pitch.id;
    } else if (!pitch.aiTitle) {
      pitch.aiTitle = title;
    }

    const writings = Array.isArray(incoming.writings) ? incoming.writings : [];
    for (const w of writings) {
      if (!w || typeof w !== "object") continue;
      if (typeof w.id !== "string") continue;
      if (!DECK_HEADINGS.includes(w.deckHeading)) continue;
      const phrase = w.phrase;
      if (!phrase || typeof phrase !== "object") continue;
      if (typeof phrase.offset !== "number" || typeof phrase.length !== "number") continue;
      const stamp = stamps && stamps.get(w.id);
      upsertPhrase(blob, {
        pitchId: pitch.id,
        deckHeading: w.deckHeading,
        writingId: w.id,
        offset: phrase.offset,
        length: phrase.length,
        addedAt: Number.isFinite(stamp) && stamp > 0 ? stamp : Date.now(),
      });
    }
  }
}

// Stable hash of the sorted writingIds in a pitch. When the writings
// backing a pitch have changed since its last AI naming, the title
// needs to evolve.
function writingsHashForPitch(pitch) {
  const ids = new Set();
  for (const h of DECK_HEADINGS) {
    for (const rec of (pitch.deck[h] || [])) ids.add(rec.writingId);
  }
  const sorted = Array.from(ids).sort();
  let h = 5381;
  for (const id of sorted) {
    for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
    h = ((h << 5) + h + 124) | 0;
  }
  return `h${(h >>> 0).toString(36)}_${sorted.length}`;
}

// Pitches whose AI title is missing or stale. An empty pitch (no
// writings yet) is skipped — naming waits for content.
function pitchesNeedingName(blob) {
  const out = [];
  for (const pitch of blob.pitches) {
    const ids = new Set();
    for (const h of DECK_HEADINGS) {
      for (const rec of (pitch.deck[h] || [])) ids.add(rec.writingId);
    }
    if (ids.size === 0) continue;
    const hash = writingsHashForPitch(pitch);
    if (!pitch.aiTitle || hash !== pitch.aiTitleSourceHash) {
      out.push({ pitch, hash, writingIds: Array.from(ids) });
    }
  }
  return out;
}

// The main entry point. Pulls everything together: normalise the
// stored blob, find off-pitch writings, ask the model to cluster
// them, fold results back in, then re-name any pitches whose
// writing-set drifted. Returns the new blob plus a small summary
// for the caller to log.
async function organize({
  storedBlob,
  essays,
  drafts,
  cluster,   // async ({ writings, existingPitchTitles }) → [{ title, writings: [{ id, deckHeading, phrase }] }]
  name,      // async ({ writings }) → string | null
  redistribute = false, // when true, re-cluster every writing from scratch
  refreshPitchId = null, // when set, re-cluster only this one pitch's writings
}) {
  const blob = normalizeBlob(storedBlob);
  const safeEssays = Array.isArray(essays) ? essays : [];
  const safeDrafts = Array.isArray(drafts) ? drafts : [];

  // Build two side-tables off the essays + drafts: the set of writing
  // ids still alive, and a stamp map for the fold + the deck refresh.
  const writingTimestamps = new Map();
  const knownWritingIds = new Set();
  for (const e of safeEssays) {
    if (!e || typeof e.id !== "string") continue;
    knownWritingIds.add(e.id);
    const stamp = Math.max(Number(e.updatedAt) || 0, Number(e.createdAt) || 0);
    if (stamp > 0) writingTimestamps.set(e.id, stamp);
  }
  for (const d of safeDrafts) {
    if (!d || typeof d.id !== "string") continue;
    knownWritingIds.add(d.id);
    const stamp = Math.max(Number(d.updatedAt) || 0, Number(d.createdAt) || 0);
    if (stamp > 0) writingTimestamps.set(d.id, stamp);
  }

  // Drop records that point at deleted writings (so the empty-pitch
  // prune at the end can see those pitches as empty), then realign
  // remaining records' `addedAt` to essay time (so the fold's sort
  // doesn't lose newer essays to stale fold-time stamps).
  const droppedStale = dropStaleDeckRecords(blob, knownWritingIds);
  refreshDeckTimestamps(blob, writingTimestamps);

  // Redistribute: wipe every deck before listing off-pitch writings so
  // the whole corpus (not just newly-added writings) flows back through
  // the clusterer. This is the founder-triggered "re-align everything"
  // path; the normal run only rehomes writings that aren't slotted yet.
  //
  // Refresh-one (refreshPitchId): wipe just that pitch's deck, so only
  // its writings turn off-pitch and flow back through the clusterer while
  // every other pitch stays put. The founder is reconsidering a single
  // pitch — its writings either route home (it keeps its own line), fold
  // into a sibling (consolidated), or leave it empty for the prune to drop
  // (dissolved). redistribute wins if both are somehow set.
  if (redistribute) clearAllDecks(blob);
  else if (refreshPitchId) clearOneDeck(blob, refreshPitchId);

  const off = sortWritingsForClustering(
    listOffPitchWritings(blob, safeEssays, safeDrafts),
    writingTimestamps,
  );
  const summary = {
    offPitchCount: off.length,
    rehomed: 0,
    renamed: 0,
    pitchesBefore: blob.pitches.length,
    pitchesAfter: blob.pitches.length,
    prunedEmpty: 0,
    droppedStaleRecords: droppedStale,
    redistribute: !!redistribute,
    refreshedPitchId: refreshPitchId || null,
    skippedReason: null,
  };

  if (off.length > 0) {
    const existingPitchTitles = dedupeTitles(
      blob.pitches
        .map((p) => p.personalTitle || p.aiTitle)
        .filter((t) => typeof t === "string" && t.length > 0),
    );

    const writings = off.slice(0, MAX_WRITINGS).map((w) => ({
      id: w.id,
      snippet: snippetFor(w.body),
    }));

    try {
      const rehomed = await cluster({ writings, existingPitchTitles });
      foldRehomeResults(blob, rehomed, { writingTimestamps });
      summary.rehomed = writings.length;
    } catch (err) {
      summary.skippedReason = `cluster_failed:${err && err.message ? err.message : "unknown"}`;
    }
  }

  // After folding, any pitch whose writings hash has drifted (or that
  // never had an AI title) gets a single naming call. We pass the
  // model whatever body we can resolve from essays/drafts; pitches
  // whose writings have all been deleted out from under them get
  // skipped (pitchesNeedingName already filters empty ones).
  const needNames = pitchesNeedingName(blob);
  for (const entry of needNames) {
    const writings = [];
    for (const id of entry.writingIds) {
      const body = bodyForWriting(id, safeEssays, safeDrafts);
      if (body && body.trim()) writings.push({ id, snippet: snippetFor(body) });
      if (writings.length >= MAX_WRITINGS) break;
    }
    if (writings.length === 0) continue;
    try {
      const title = await name({ writings });
      if (title) {
        entry.pitch.aiTitle = title;
        entry.pitch.aiTitleSourceHash = entry.hash;
        summary.renamed += 1;
      }
    } catch {
      // Best-effort. The blob still saves; next run retries.
    }
  }

  // Prune pitches whose deck ended up fully empty. The cluster can
  // reshuffle a writing out of an auto-named pitch into another, and the
  // source pitch is left as a titled-but-empty entry that the founder
  // sees in the dropdown as "no essay attached". Founder-named pitches
  // (personalTitle set) are preserved even when empty so we don't drop
  // a label they typed.
  const kept = [];
  for (const pitch of blob.pitches) {
    const hasWritings = DECK_HEADINGS.some(
      (h) => Array.isArray(pitch.deck[h]) && pitch.deck[h].length > 0,
    );
    const hasPersonalTitle =
      typeof pitch.personalTitle === "string" && pitch.personalTitle.trim().length > 0;
    if (hasWritings || hasPersonalTitle) kept.push(pitch);
  }
  summary.prunedEmpty = blob.pitches.length - kept.length;
  blob.pitches = kept;
  if (blob.activeId && !blob.pitches.some((p) => p.id === blob.activeId)) {
    blob.activeId = null;
  }

  summary.pitchesAfter = blob.pitches.length;
  return { blob, summary };
}

module.exports = {
  MAX_PHRASES_PER_HEADING,
  emptyDeck,
  normalizeBlob,
  listOffPitchWritings,
  sortWritingsForClustering,
  writingIdsInAnyPitch,
  foldRehomeResults,
  refreshDeckTimestamps,
  dropStaleDeckRecords,
  clearAllDecks,
  clearOneDeck,
  dedupeTitles,
  upsertPhrase,
  pitchesNeedingName,
  writingsHashForPitch,
  bodyForDraft,
  bodyForWriting,
  organize,
};
