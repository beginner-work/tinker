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
 *         meta: { mostRecentlyTouched, expanded, locked, lastClassifyFailedAt },
 *         createdAt: number,
 *       }
 *     ],
 *     activeId: string | null,
 *     _migratedFromTree: boolean,
 *   }
 *
 * Merge semantics: user-controlled fields (personalTitle, activeId,
 * meta.expanded, meta.mostRecentlyTouched, meta.locked, manually-slotted
 * phrases) are preserved across runs. The organizer only touches AI-owned
 * fields (aiTitle, aiTitleSourceHash) and rehomes writings that aren't yet
 * in any pitch's deck. `meta.locked` is the set of deck headings the
 * founder has pinned: a locked beat is frozen — refresh/redistribute never
 * clears it, the fold never evicts it, and its writing stays out of the
 * cluster input so the model can't move it.
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
  // Gather mode: while set, every cluster pass routes writings into
  // this one pitch instead of splitting into multiple. Dropped when
  // the pitch it points at no longer exists.
  const focusPitchId = typeof safe.focusPitchId === "string" && pitches.some((p) => p.id === safe.focusPitchId)
    ? safe.focusPitchId
    : null;
  return {
    pitches,
    activeId,
    focusPitchId,
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

// The founder's own title for a writing, when they gave it one. It
// rides into the cluster prompt as a `title:` line — the explicit-topic
// rule treats it as the strongest signal of where the writing belongs.
function titleForWriting(record) {
  if (!record || typeof record !== "object") return "";
  const t = record.title || (record.stitched && record.stitched.title) || "";
  return String(t).trim();
}

function listOffPitchWritings(blob, essays, drafts) {
  const known = writingIdsInAnyPitch(blob);
  const out = [];
  for (const e of essays) {
    if (!e || typeof e.id !== "string") continue;
    const body = String((e && e.body) || "").trim();
    if (!body) continue;
    if (known.has(e.id)) continue;
    out.push({ id: e.id, body, title: titleForWriting(e) });
  }
  for (const d of drafts) {
    if (!d || typeof d.id !== "string") continue;
    const body = bodyForDraft(d).trim();
    if (!body) continue;
    if (known.has(d.id)) continue;
    out.push({ id: d.id, body, title: titleForWriting(d) });
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
    const locked = (pitch.meta && pitch.meta.locked) || {};
    for (const h of DECK_HEADINGS) {
      if (locked[h]) continue; // a locked beat is frozen — never strip it
      const list = Array.isArray(pitch.deck[h]) ? pitch.deck[h] : [];
      pitch.deck[h] = list.filter((p) => p.writingId !== writingId);
    }
  }
}

// The headings the founder has pinned on a pitch, in deck order. Locked
// beats survive every clear/redistribute pass and their writings are
// held out of the cluster input. Returns [] when nothing is locked.
function lockedHeadingsForPitch(pitch) {
  const locked = pitch && pitch.meta && pitch.meta.locked;
  if (!locked || typeof locked !== "object") return [];
  return DECK_HEADINGS.filter((h) => !!locked[h]);
}

// True when `writingId` is the phrase pinned in a locked beat anywhere
// in the blob. A locked writing is frozen in place: the organizer won't
// move it into another beat or duplicate it elsewhere.
function writingIsLockedSomewhere(blob, writingId) {
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

// The lock-aware sibling of clearAllDecks, used by the founder-triggered
// redistribute. Empties every UNLOCKED heading — turning those writings
// "off-pitch" so the whole unlocked corpus flows back through the
// clusterer — while leaving each beat the founder pinned exactly as it
// is. A locked beat keeps its phrase, so its writing stays slotted and
// therefore OUT of the cluster input: the model can re-align everything
// around the founder's locked sections but can't touch them. With no
// locks set anywhere this reduces to clearAllDecks.
function clearUnlockedDecks(blob) {
  for (const pitch of blob.pitches) {
    const locked = (pitch.meta && pitch.meta.locked) || {};
    const next = emptyDeck();
    for (const h of DECK_HEADINGS) {
      if (locked[h] && Array.isArray(pitch.deck[h])) next[h] = pitch.deck[h];
    }
    pitch.deck = next;
  }
}

// Empty a single pitch's deck — the scoped sibling of clearAllDecks,
// used by the per-pitch refresh. Only the target pitch's writings turn
// "off-pitch", so the next sweep hands just that pitch's corpus back to
// the clusterer while every other pitch stays put. The clusterer can
// then route those writings home (the pitch keeps its own line), into a
// sibling (consolidated), or — if they all land elsewhere and the shell
// isn't founder-named — leave it empty for the end-of-run prune to drop
// (the pitch dissolves). Locked beats on the target pitch are preserved
// (and their writings held out of the recluster), same as redistribute.
// A no-op when the id doesn't match a pitch.
function clearOneDeck(blob, pitchId) {
  const pitch = blob.pitches.find((p) => p.id === pitchId);
  if (!pitch) return;
  const locked = (pitch.meta && pitch.meta.locked) || {};
  const next = emptyDeck();
  for (const h of DECK_HEADINGS) {
    if (locked[h] && Array.isArray(pitch.deck[h])) next[h] = pitch.deck[h];
  }
  pitch.deck = next;
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

  // Locked beats are frozen. Bail before mutating in two cases:
  //  - this writing is already pinned in a locked beat → leave it there
  //    (don't move or duplicate it into deckHeading);
  //  - the target beat is locked and already filled → don't evict the
  //    pinned phrase.
  // Returning early (rather than clear-then-skip) keeps the incoming
  // writing off-pitch instead of orphaning it out of its old slot.
  if (writingIsLockedSomewhere(blob, writingId)) return;
  const locked = (pitch.meta && pitch.meta.locked) || {};
  if (locked[deckHeading] && Array.isArray(pitch.deck[deckHeading]) && pitch.deck[deckHeading].length > 0) {
    return;
  }

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
//
// `forcePitchId` is the gather-mode fold: every writing lands in that
// one pitch no matter how the model bucketed or titled its reply, so a
// model that splits anyway (or mints a title that doesn't validate)
// can't fracture the founder's single pitch.
function foldRehomeResults(blob, rehomedPitches, { writingTimestamps, forcePitchId = null } = {}) {
  const stamps = writingTimestamps instanceof Map ? writingTimestamps : null;
  const forced = forcePitchId
    ? blob.pitches.find((p) => p.id === forcePitchId) || null
    : null;
  for (const incoming of rehomedPitches) {
    if (!incoming || typeof incoming !== "object") continue;
    let pitch = forced;
    if (!pitch) {
      const title = validateTitle(incoming.title);
      if (!title) continue;
      pitch = blob.pitches.find((p) => titlesMatch(p, title));
      if (!pitch) {
        pitch = {
          id: uid(),
          aiTitle: title,
          personalTitle: null,
          aiTitleSourceHash: null,
          deck: emptyDeck(),
          meta: { mostRecentlyTouched: null, expanded: {}, locked: {}, lastClassifyFailedAt: null },
          createdAt: Date.now(),
        };
        blob.pitches.push(pitch);
        if (!blob.activeId) blob.activeId = pitch.id;
      } else if (!pitch.aiTitle) {
        pitch.aiTitle = title;
      }
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
  cluster,   // async ({ writings, existingPitchTitles, gatherTitle }) → [{ title, writings: [{ id, deckHeading, phrase }] }]
  name,      // async ({ writings }) → string | null
  redistribute = false, // when true, re-cluster every writing from scratch
  refreshPitchId = null, // when set, re-cluster only this one pitch's writings
  gatherPitchId = null, // when set, re-cluster everything into this ONE pitch and remember the choice
}) {
  const blob = normalizeBlob(storedBlob);
  const safeEssays = Array.isArray(essays) ? essays : [];
  const safeDrafts = Array.isArray(drafts) ? drafts : [];

  // Gather mode bookkeeping. An explicit gather points focusPitchId at
  // the chosen pitch; an explicit multi-pitch redistribute clears it
  // (that's the founder saying "split things up again"); the default
  // debounced runs keep whatever is stored, so a founder who gathered
  // stays gathered — new essays keep joining the one pitch.
  if (gatherPitchId && blob.pitches.some((p) => p.id === gatherPitchId)) {
    blob.focusPitchId = gatherPitchId;
  } else if (redistribute) {
    blob.focusPitchId = null;
  }
  const focusPitch = blob.focusPitchId
    ? blob.pitches.find((p) => p.id === blob.focusPitchId) || null
    : null;
  // The title the gather prompt names its single cluster with. Cosmetic
  // — the fold forces the pitch by id — but a familiar word keeps the
  // model anchored. validateTitle guards the one-word contract.
  const gatherTitle = focusPitch
    ? (validateTitle(focusPitch.aiTitle) || "Pitch")
    : null;

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

  // Redistribute: wipe every UNLOCKED deck beat before listing off-pitch
  // writings so the whole unlocked corpus (not just newly-added writings)
  // flows back through the clusterer. This is the founder-triggered
  // "re-align everything" path; the normal run only rehomes writings that
  // aren't slotted yet. Beats the founder locked stay put, and their
  // writings stay slotted — so the model re-aligns everything around the
  // locked sections without disturbing them.
  //
  // Refresh-one (refreshPitchId): wipe just that pitch's unlocked beats, so
  // only its (unlocked) writings turn off-pitch and flow back through the
  // clusterer while every other pitch stays put. The founder is
  // reconsidering a single pitch — its writings either route home (it keeps
  // its own line), fold into a sibling (consolidated), or leave it empty for
  // the prune to drop (dissolved). redistribute wins if both are somehow set.
  //
  // Gather (gatherPitchId): clears like a redistribute — the whole unlocked
  // corpus flows back through the clusterer — but the fold sends every
  // writing into the one focus pitch.
  if (redistribute || (gatherPitchId && focusPitch)) clearUnlockedDecks(blob);
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
    gatheredPitchId: (gatherPitchId && focusPitch) ? focusPitch.id : null,
    focusPitchId: blob.focusPitchId || null,
    skippedReason: null,
  };

  if (off.length > 0) {
    const existingPitchTitles = dedupeTitles(
      blob.pitches
        .map((p) => p.personalTitle || p.aiTitle)
        .filter((t) => typeof t === "string" && t.length > 0),
    );

    const writings = off.slice(0, MAX_WRITINGS).map((w) => {
      const entry = { id: w.id, snippet: snippetFor(w.body) };
      if (w.title) entry.title = String(w.title).slice(0, 120);
      return entry;
    });

    try {
      const rehomed = await cluster({ writings, existingPitchTitles, gatherTitle });
      foldRehomeResults(blob, rehomed, {
        writingTimestamps,
        forcePitchId: focusPitch ? focusPitch.id : null,
      });
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
      if (body && body.trim()) {
        const record = safeDrafts.find((d) => d && d.id === id)
          || safeEssays.find((e) => e && e.id === id)
          || null;
        const item = { id, snippet: snippetFor(body) };
        const title = titleForWriting(record);
        if (title) item.title = title.slice(0, 120);
        writings.push(item);
      }
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
  if (blob.focusPitchId && !blob.pitches.some((p) => p.id === blob.focusPitchId)) {
    blob.focusPitchId = null;
    summary.focusPitchId = null;
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
  clearUnlockedDecks,
  clearOneDeck,
  lockedHeadingsForPitch,
  writingIsLockedSomewhere,
  dedupeTitles,
  upsertPhrase,
  pitchesNeedingName,
  writingsHashForPitch,
  bodyForDraft,
  bodyForWriting,
  titleForWriting,
  organize,
};
