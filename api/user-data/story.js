/* GET/PUT /api/user-data/story
 *
 * The founder's locked-in story state: { ask, lockedAt, lockedEssayIds,
 * storiesUrl }. See src/renderer/story.js for the shape and semantics —
 * the server just round-trips the JSON like every other kind.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("story");
