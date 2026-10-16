/* GET/PUT /api/user-data/learning-progress
 *
 * Per-user ZPD level + current prompt toward a coding goal.
 * Whole-object semantics via shared TinkerUserData (Postgres / Prisma).
 */

"use strict";

const { makeHandler } = require("../_lib/user-data.js");

module.exports = makeHandler("learning_progress");
