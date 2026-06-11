/* GET/PUT /api/user-data/team
 *
 * The founder's team state: { invited: [{ userId, name, question, at }] }
 * — who they've invited onto their team and which of their questions
 * brought the suggestion up. See src/renderer/story.js. The server
 * just round-trips the JSON like every other kind.
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("team");
