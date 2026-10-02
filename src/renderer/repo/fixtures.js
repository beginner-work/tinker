/* Sample repository preview data only.
 *
 * UI skeleton — not a real repository layout. Swap this fixture when
 * architecture docs (LL-77 / LL-78 / LL-79) decide structure.
 * No git, storage, API, or folder conventions are implied.
 */

(function (root) {
  "use strict";

  var SAMPLE_REPO = {
    name: "Sample writing repo",
    branchLabel: "main (sample)",
    reflections: [
      {
        id: "ref-1",
        title: "Sample reflection",
        body: "A short placeholder reflection. Develop this into a piece in the tree.",
      },
      {
        id: "ref-2",
        title: "Another sample reflection",
        body: "Second placeholder. Honest notes start here before they become organized writing.",
      },
      {
        id: "ref-3",
        title: "Sample note to develop",
        body: "Third placeholder reflection waiting to become a repository piece.",
      },
    ],
    folders: [
      {
        id: "folder-essays",
        name: "Essays",
        pieces: [
          {
            id: "piece-1",
            title: "Sample piece",
            body: "Placeholder body for the first essay piece.",
          },
          {
            id: "piece-2",
            title: "Sample piece two",
            body: "Placeholder body for the second essay piece.",
          },
        ],
      },
      {
        id: "folder-notes",
        name: "Notes",
        pieces: [
          {
            id: "piece-3",
            title: "Sample note",
            body: "Placeholder body for a note in the tree.",
          },
        ],
      },
      {
        id: "folder-drafts",
        name: "Drafts",
        pieces: [
          {
            id: "piece-4",
            title: "Sample draft",
            body: "Placeholder body for a draft piece.",
          },
          {
            id: "piece-5",
            title: "Sample draft two",
            body: "Another placeholder draft.",
          },
        ],
      },
    ],
    history: [
      {
        id: "hist-1",
        pieceId: "piece-1",
        date: "2026-09-28",
        note: "Sample earlier pass",
        title: "Sample piece",
        body: "Read-only sample of an earlier version of this piece.",
      },
      {
        id: "hist-2",
        pieceId: "piece-1",
        date: "2026-09-20",
        note: "Sample first save",
        title: "Sample piece",
        body: "Read-only sample of the first saved version.",
      },
      {
        id: "hist-3",
        pieceId: "piece-3",
        date: "2026-09-15",
        note: "Sample note version",
        title: "Sample note",
        body: "Read-only sample history for the note piece.",
      },
    ],
  };

  root.tinkerRepoFixtures = {
    SAMPLE_REPO: SAMPLE_REPO,
  };
})(typeof window !== "undefined" ? window : globalThis);
