/* tinker — pitches client removed (TYL-65).
 * Pitch decks are gone. Story parts remain on /story-parts.
 */
(() => {
  "use strict";
  window.tinkerPitches = {
    getPitch() { return null; },
    findPitchForWriting() { return null; },
    readingOrder() { return []; },
    scheduleOrganize() {},
  };
})();
