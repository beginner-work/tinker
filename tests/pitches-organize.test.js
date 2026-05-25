/* Unit tests for the backend pitch-organization job.
 *
 * We exercise the pure organizer in api/_lib/pitches-organizer.js with
 * stubbed cluster + name functions. The Anthropic call lives behind
 * those two function arguments, so the tests run in-process without
 * network or DB.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  emptyDeck,
  normalizeBlob,
  listOffPitchWritings,
  writingIdsInAnyPitch,
  pitchesNeedingName,
  writingsHashForPitch,
  bodyForDraft,
  bodyForWriting,
  foldRehomeResults,
  refreshDeckTimestamps,
  dropStaleDeckRecords,
  organize,
} = require("../api/_lib/pitches-organizer.js");
const { DECK_HEADINGS } = require("../api/_lib/pitches-clusterer.js");

function makeEssay(id, body) {
  return { id, body, createdAt: 1, updatedAt: 1 };
}
function makeDraft(id, body) {
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    transcript: [],
    stitched: { body },
  };
}

test("normalizeBlob fills in defaults and discards malformed phrase records", () => {
  const blob = normalizeBlob({
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      personalTitle: null,
      deck: {
        "The Problem": [
          { writingId: "e_1", offset: 0, length: 5 },          // good
          { writingId: 1, offset: 0, length: 5 },              // bad id
          { writingId: "e_3", offset: "x", length: 5 },        // non-number offset
          { writingId: "e_4", offset: 0, length: 0 },          // zero length
        ],
        "Made Up": [{ writingId: "e_99", offset: 0, length: 5 }], // unknown heading
      },
      meta: { mostRecentlyTouched: "The Problem", expanded: { "The Problem": true } },
    }],
    activeId: "p_1",
  });
  assert.equal(blob.pitches.length, 1);
  const p = blob.pitches[0];
  assert.equal(p.deck["The Problem"].length, 1);
  assert.equal(p.deck["The Problem"][0].writingId, "e_1");
  assert.equal(Array.isArray(p.deck["A Persona"]), true); // every heading present
  assert.equal(Object.prototype.hasOwnProperty.call(p.deck, "Made Up"), false);
  assert.equal(blob.activeId, "p_1");
});

test("normalizeBlob migrates legacy single-`title` field", () => {
  const aiOnly = normalizeBlob({
    pitches: [{ id: "p_1", title: "Coffee", autoTitled: true, deck: {} }],
  });
  assert.equal(aiOnly.pitches[0].aiTitle, "Coffee");
  assert.equal(aiOnly.pitches[0].personalTitle, null);

  const personalOnly = normalizeBlob({
    pitches: [{ id: "p_1", title: "My Side Project", autoTitled: false, deck: {} }],
  });
  assert.equal(personalOnly.pitches[0].aiTitle, null);
  assert.equal(personalOnly.pitches[0].personalTitle, "My Side Project");
});

test("normalizeBlob clears activeId that points at a missing pitch", () => {
  const blob = normalizeBlob({ pitches: [], activeId: "p_gone" });
  assert.equal(blob.activeId, null);
});

test("listOffPitchWritings returns essays + drafts not in any deck", () => {
  const blob = normalizeBlob({
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      deck: { "The Problem": [{ writingId: "e_1", offset: 0, length: 5 }] },
    }],
  });
  const essays = [makeEssay("e_1", "alpha"), makeEssay("e_2", "beta"), makeEssay("e_blank", "   ")];
  const drafts = [makeDraft("d_1", "gamma")];
  const off = listOffPitchWritings(blob, essays, drafts);
  assert.deepEqual(off.map((w) => w.id).sort(), ["d_1", "e_2"]);
});

test("writingIdsInAnyPitch returns the union across decks", () => {
  const blob = normalizeBlob({
    pitches: [
      { id: "p_1", deck: { "The Problem": [{ writingId: "e_1", offset: 0, length: 5 }] } },
      { id: "p_2", deck: { "The Vision": [{ writingId: "e_2", offset: 0, length: 5 }] } },
    ],
  });
  const ids = writingIdsInAnyPitch(blob);
  assert.equal(ids.has("e_1"), true);
  assert.equal(ids.has("e_2"), true);
  assert.equal(ids.size, 2);
});

test("bodyForDraft prefers stitched, falls back to transcript", () => {
  assert.equal(
    bodyForDraft({ stitched: { body: "final" }, transcript: [{ a: "raw" }] }),
    "final",
  );
  assert.equal(
    bodyForDraft({ transcript: [{ a: "one" }, { a: "two" }] }),
    "one\n\ntwo",
  );
  assert.equal(bodyForDraft({}), "");
});

test("bodyForWriting finds essays and drafts by id", () => {
  const essays = [makeEssay("e_1", "essay body")];
  const drafts = [makeDraft("d_1", "draft body")];
  assert.equal(bodyForWriting("e_1", essays, drafts), "essay body");
  assert.equal(bodyForWriting("d_1", essays, drafts), "draft body");
  assert.equal(bodyForWriting("nope", essays, drafts), "");
});

test("foldRehomeResults seeds a new pitch when the title is novel", () => {
  const blob = normalizeBlob({ pitches: [] });
  foldRehomeResults(blob, [{
    title: "Coffee",
    writings: [{
      id: "e_1",
      deckHeading: "The Problem",
      phrase: { writingId: "e_1", offset: 0, length: 5 },
    }],
  }]);
  assert.equal(blob.pitches.length, 1);
  assert.equal(blob.pitches[0].aiTitle, "Coffee");
  assert.equal(blob.pitches[0].deck["The Problem"].length, 1);
  assert.equal(blob.activeId, blob.pitches[0].id);
});

test("foldRehomeResults merges into an existing pitch when titles match (case-insensitive)", () => {
  const blob = normalizeBlob({
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      deck: { "The Problem": [{ writingId: "e_seed", offset: 0, length: 5 }] },
    }],
  });
  foldRehomeResults(blob, [{
    title: "COFFEE",
    writings: [{
      id: "e_new",
      deckHeading: "The Vision",
      phrase: { writingId: "e_new", offset: 0, length: 7 },
    }],
  }]);
  assert.equal(blob.pitches.length, 1);
  assert.equal(blob.pitches[0].deck["The Problem"].length, 1);
  assert.equal(blob.pitches[0].deck["The Vision"].length, 1);
});

test("foldRehomeResults moves a writing out of its old slot before re-adding", () => {
  const blob = normalizeBlob({
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      deck: { "The Problem": [{ writingId: "e_1", offset: 0, length: 5 }] },
    }],
  });
  // Same writing, new heading. The old slot must end up empty so the
  // deck doesn't show duplicates.
  foldRehomeResults(blob, [{
    title: "Coffee",
    writings: [{
      id: "e_1",
      deckHeading: "The Vision",
      phrase: { writingId: "e_1", offset: 0, length: 5 },
    }],
  }]);
  assert.equal(blob.pitches[0].deck["The Problem"].length, 0);
  assert.equal(blob.pitches[0].deck["The Vision"].length, 1);
});

test("pitchesNeedingName flags missing or stale aiTitle, skips empty pitches", () => {
  const blob = normalizeBlob({
    pitches: [
      // Empty: skipped.
      { id: "p_empty", deck: {} },
      // Missing aiTitle: needs name.
      { id: "p_unnamed", deck: { "The Problem": [{ writingId: "e_1", offset: 0, length: 5 }] } },
      // aiTitle present but hash doesn't match current writings: needs rename.
      {
        id: "p_drifted",
        aiTitle: "Old",
        aiTitleSourceHash: "stale",
        deck: { "The Problem": [{ writingId: "e_2", offset: 0, length: 5 }] },
      },
      // aiTitle hash matches: skipped.
      {
        id: "p_fresh",
        aiTitle: "Current",
        deck: { "The Vision": [{ writingId: "e_3", offset: 0, length: 5 }] },
      },
    ],
  });
  // Pre-compute the fresh pitch's hash so it matches.
  blob.pitches[3].aiTitleSourceHash = writingsHashForPitch(blob.pitches[3]);

  const need = pitchesNeedingName(blob);
  const ids = need.map((n) => n.pitch.id).sort();
  assert.deepEqual(ids, ["p_drifted", "p_unnamed"]);
});

test("emptyDeck has all eleven headings as empty arrays", () => {
  const d = emptyDeck();
  for (const h of DECK_HEADINGS) {
    assert.equal(Array.isArray(d[h]), true);
    assert.equal(d[h].length, 0);
  }
});

test("organize: no off-pitch writings and no stale names → empty summary, blob untouched", async () => {
  const blob = normalizeBlob({
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      deck: { "The Problem": [{ writingId: "e_1", offset: 0, length: 5 }] },
    }],
  });
  blob.pitches[0].aiTitleSourceHash = writingsHashForPitch(blob.pitches[0]);

  let clusterCalls = 0;
  let nameCalls = 0;
  const result = await organize({
    storedBlob: blob,
    essays: [makeEssay("e_1", "alpha beta")],
    drafts: [],
    cluster: async () => { clusterCalls++; return []; },
    name: async () => { nameCalls++; return null; },
  });
  assert.equal(clusterCalls, 0);
  assert.equal(nameCalls, 0);
  assert.equal(result.summary.offPitchCount, 0);
  assert.equal(result.summary.rehomed, 0);
  assert.equal(result.summary.renamed, 0);
});

test("organize: off-pitch writings flow through cluster, fold, then name", async () => {
  const stored = {
    pitches: [],
    activeId: null,
  };
  const essays = [
    makeEssay("e_1", "first essay body words here"),
    makeEssay("e_2", "second essay body words here"),
  ];
  const drafts = [makeDraft("d_1", "draft body words here")];

  const clusterSeen = [];
  const cluster = async ({ writings, existingPitchTitles }) => {
    clusterSeen.push({
      ids: writings.map((w) => w.id).sort(),
      titles: existingPitchTitles.slice().sort(),
    });
    return [{
      title: "Coffee",
      writings: writings.map((w) => ({
        id: w.id,
        deckHeading: "The Problem",
        phrase: { writingId: w.id, offset: 0, length: 5 },
      })),
    }];
  };

  const nameSeen = [];
  const name = async ({ writings }) => {
    nameSeen.push(writings.map((w) => w.id).sort());
    return "Brewed";
  };

  const result = await organize({ storedBlob: stored, essays, drafts, cluster, name });

  assert.equal(clusterSeen.length, 1);
  assert.deepEqual(clusterSeen[0].ids, ["d_1", "e_1", "e_2"]);
  assert.deepEqual(clusterSeen[0].titles, []);
  assert.equal(result.summary.offPitchCount, 3);
  assert.equal(result.summary.rehomed, 3);
  assert.equal(result.summary.renamed, 1);
  assert.equal(result.blob.pitches.length, 1);
  // Naming swaps the AI title from the cluster's "Coffee" to "Brewed".
  assert.equal(result.blob.pitches[0].aiTitle, "Brewed");
  assert.ok(result.blob.pitches[0].aiTitleSourceHash);
});

test("organize: cluster failure is recorded but naming still runs", async () => {
  const stored = {
    pitches: [{
      id: "p_1",
      aiTitle: null,
      deck: { "The Problem": [{ writingId: "e_seed", offset: 0, length: 5 }] },
    }],
  };
  const essays = [makeEssay("e_seed", "alpha beta gamma"), makeEssay("e_off", "delta epsilon")];

  const cluster = async () => { throw new Error("boom"); };
  let nameCalls = 0;
  const name = async () => { nameCalls++; return "Named"; };

  const result = await organize({ storedBlob: stored, essays, drafts: [], cluster, name });

  assert.ok(result.summary.skippedReason && result.summary.skippedReason.startsWith("cluster_failed:"));
  assert.equal(result.summary.rehomed, 0);
  assert.equal(nameCalls, 1); // still names the seeded pitch
  assert.equal(result.summary.renamed, 1);
  assert.equal(result.blob.pitches[0].aiTitle, "Named");
});

test("foldRehomeResults: writings sharing a slot resolve to the most recent essay", () => {
  // With MAX_PHRASES_PER_HEADING=1 the slot only keeps one record. Before
  // the fix, every upsertPhrase inside the loop used Date.now() — so the
  // stable sort kept whichever writing happened to be iterated first.
  // After the fix, the writing's own createdAt/updatedAt seeds addedAt
  // and the newer essay wins.
  const blob = normalizeBlob({ pitches: [] });
  const writingTimestamps = new Map([
    ["e_old", 100],
    ["e_new", 200],
  ]);
  foldRehomeResults(blob, [{
    title: "Coffee",
    writings: [
      // Older essay iterated first — would have won under the old code.
      { id: "e_old", deckHeading: "The Problem", phrase: { writingId: "e_old", offset: 0, length: 5 } },
      { id: "e_new", deckHeading: "The Problem", phrase: { writingId: "e_new", offset: 0, length: 5 } },
    ],
  }], { writingTimestamps });
  const slot = blob.pitches[0].deck["The Problem"];
  assert.equal(slot.length, 1);
  assert.equal(slot[0].writingId, "e_new");
});

test("organize: prunes auto-named pitches that end up empty after reshuffle", async () => {
  // The "Old" pitch's only writing gets clustered into a different new
  // pitch. clearWritingFromAllPitches strips it from "Old", which leaves
  // a titled-but-empty entry the founder sees as "no essay attached".
  const stored = {
    pitches: [{
      id: "p_old",
      aiTitle: "Old",
      deck: { "The Problem": [{ writingId: "e_1", offset: 0, length: 5, addedAt: 100 }] },
    }],
    activeId: "p_old",
  };
  const essays = [makeEssay("e_1", "alpha beta gamma"), makeEssay("e_2", "delta epsilon zeta")];
  // e_1 is already in p_old's deck, so it's NOT in the off-pitch list.
  // Mark it as off-pitch by passing an empty deck for p_old in stored.
  stored.pitches[0].deck = {};
  const cluster = async () => ([{
    title: "New",
    writings: [
      { id: "e_1", deckHeading: "The Vision", phrase: { writingId: "e_1", offset: 0, length: 5 } },
      { id: "e_2", deckHeading: "The Vision", phrase: { writingId: "e_2", offset: 0, length: 5 } },
    ],
  }]);
  const name = async () => "Named";
  const result = await organize({ storedBlob: stored, essays, drafts: [], cluster, name });
  const titles = result.blob.pitches.map((p) => p.aiTitle).sort();
  assert.deepEqual(titles, ["Named"]);
  assert.equal(result.summary.prunedEmpty, 1);
  assert.equal(result.blob.activeId, null);
});

test("organize: preserves founder-named pitches even when they end up empty", async () => {
  // A pitch the founder renamed (personalTitle set) should NOT be pruned
  // even with an empty deck — that's their label, we don't get to drop it.
  const stored = {
    pitches: [{
      id: "p_founder",
      aiTitle: "Coffee",
      personalTitle: "Side Project",
      deck: {},
    }],
    activeId: "p_founder",
  };
  const essays = [makeEssay("e_1", "alpha beta gamma")];
  const cluster = async () => ([{
    title: "Other",
    writings: [
      { id: "e_1", deckHeading: "The Vision", phrase: { writingId: "e_1", offset: 0, length: 5 } },
    ],
  }]);
  const name = async () => "Named";
  const result = await organize({ storedBlob: stored, essays, drafts: [], cluster, name });
  const founderPitch = result.blob.pitches.find((p) => p.personalTitle === "Side Project");
  assert.ok(founderPitch, "founder-renamed pitch should be preserved");
  assert.equal(result.summary.prunedEmpty, 0);
});

test("refreshDeckTimestamps: realigns each record's addedAt to the writing's own time", () => {
  // Two records with stale fold-time addedAts (5000, 4000). After refresh
  // they pick up the writing's createdAt (100, 200). The fix lets the
  // fold's slice compare on essay time, not fold time.
  const blob = normalizeBlob({
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      deck: {
        "The Problem": [{ writingId: "e_OLD", offset: 0, length: 5, addedAt: 5000 }],
        "The Vision":  [{ writingId: "e_NEW", offset: 0, length: 5, addedAt: 4000 }],
      },
    }],
  });
  const stamps = new Map([["e_OLD", 100], ["e_NEW", 200]]);
  refreshDeckTimestamps(blob, stamps);
  assert.equal(blob.pitches[0].deck["The Problem"][0].addedAt, 100);
  assert.equal(blob.pitches[0].deck["The Vision"][0].addedAt, 200);
});

test("refreshDeckTimestamps: leaves addedAt alone when the writing has no stamp", () => {
  // A record whose writing isn't in the stamp map (e.g. an essay with no
  // createdAt/updatedAt at all) keeps whatever value it had — that's
  // better than nuking it to 0 and losing ordering entirely.
  const blob = normalizeBlob({
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      deck: { "The Problem": [{ writingId: "e_x", offset: 0, length: 5, addedAt: 999 }] },
    }],
  });
  refreshDeckTimestamps(blob, new Map());
  assert.equal(blob.pitches[0].deck["The Problem"][0].addedAt, 999);
});

test("dropStaleDeckRecords: removes records whose writings no longer exist", () => {
  const blob = normalizeBlob({
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      deck: {
        "The Problem": [{ writingId: "e_gone", offset: 0, length: 5, addedAt: 100 }],
        "The Vision":  [{ writingId: "e_alive", offset: 0, length: 5, addedAt: 200 }],
      },
    }],
  });
  const dropped = dropStaleDeckRecords(blob, new Set(["e_alive"]));
  assert.equal(dropped, 1);
  assert.equal(blob.pitches[0].deck["The Problem"].length, 0);
  assert.equal(blob.pitches[0].deck["The Vision"].length, 1);
});

test("organize: stale addedAt on the existing record doesn't lock an older essay in over a newer one", async () => {
  // Existing slot pins e_OLD with addedAt=5000 (stale fold-time). The
  // essay e_OLD's actual createdAt is 100. e_NEW (newer essay, createdAt
  // 200) gets clustered into the same slot — the fold places it with
  // addedAt=200. Without the refresh, the slot sorts [5000, 200] desc
  // and the OLDER essay wins. With the refresh, e_OLD's addedAt becomes
  // 100, the slot sorts [200, 100], and the newer essay wins.
  const stored = {
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      deck: { "The Problem": [{ writingId: "e_OLD", offset: 0, length: 5, addedAt: 5000 }] },
    }],
    activeId: "p_1",
  };
  const essays = [
    { id: "e_OLD", body: "alpha beta gamma", createdAt: 100, updatedAt: 100 },
    { id: "e_NEW", body: "delta epsilon zeta", createdAt: 200, updatedAt: 200 },
  ];
  const cluster = async () => ([{
    title: "Coffee",
    writings: [{ id: "e_NEW", deckHeading: "The Problem",
                 phrase: { writingId: "e_NEW", offset: 0, length: 5 } }],
  }]);
  const name = async () => "Coffee";
  const result = await organize({ storedBlob: stored, essays, drafts: [], cluster, name });
  const slot = result.blob.pitches[0].deck["The Problem"];
  assert.equal(slot.length, 1);
  assert.equal(slot[0].writingId, "e_NEW");
});

test("organize: prunes pitches whose only deck records point at deleted writings", async () => {
  // e_gone was deleted (no longer in essays/drafts) but the pitch still
  // carries the stale record. Before the fix, hasWritings was true
  // (length > 0) so the prune kept the pitch — surfacing it in the
  // dropdown with no essay to show. After the fix, stale records are
  // dropped first, the deck becomes empty, the prune removes the pitch.
  const stored = {
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      deck: { "The Problem": [{ writingId: "e_gone", offset: 0, length: 5, addedAt: 100 }] },
    }],
    activeId: "p_1",
  };
  const result = await organize({
    storedBlob: stored,
    essays: [],
    drafts: [],
    cluster: async () => [],
    name: async () => null,
  });
  assert.equal(result.blob.pitches.length, 0);
  assert.equal(result.blob.activeId, null);
  assert.equal(result.summary.droppedStaleRecords, 1);
  assert.equal(result.summary.prunedEmpty, 1);
});

test("organize: drops stale records but keeps founder-named pitches with surviving records elsewhere", async () => {
  // A founder-named pitch with one stale and one live record keeps the
  // live one and drops the dead one. The pitch survives — both because
  // it has a personalTitle and because at least one record remains.
  const stored = {
    pitches: [{
      id: "p_1",
      personalTitle: "Side Project",
      deck: {
        "The Problem": [{ writingId: "e_gone", offset: 0, length: 5, addedAt: 100 }],
        "The Vision":  [{ writingId: "e_alive", offset: 0, length: 5, addedAt: 200 }],
      },
    }],
    activeId: "p_1",
  };
  const essays = [{ id: "e_alive", body: "delta epsilon zeta", createdAt: 200, updatedAt: 200 }];
  const result = await organize({
    storedBlob: stored,
    essays,
    drafts: [],
    cluster: async () => [],
    name: async () => null,
  });
  assert.equal(result.blob.pitches.length, 1);
  assert.equal(result.blob.pitches[0].deck["The Problem"].length, 0);
  assert.equal(result.blob.pitches[0].deck["The Vision"].length, 1);
  assert.equal(result.summary.droppedStaleRecords, 1);
});

test("organize: passes existing personalTitle / aiTitle as cluster hints", async () => {
  const stored = {
    pitches: [
      { id: "p_1", personalTitle: "Side Project", deck: {} },
      { id: "p_2", aiTitle: "Tinker", deck: {} },
      { id: "p_3", deck: {} }, // no title — skipped from the hint list
    ],
  };
  const essays = [makeEssay("e_1", "alpha beta gamma")];

  let seenTitles = null;
  const cluster = async ({ existingPitchTitles }) => {
    seenTitles = existingPitchTitles.slice().sort();
    return [];
  };
  const name = async () => null;

  await organize({ storedBlob: stored, essays, drafts: [], cluster, name });
  assert.deepEqual(seenTitles, ["Side Project", "Tinker"]);
});
