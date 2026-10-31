/* Preload for `npm test`: point TINKER_PRIVATE_DIR at the sanitized
 * test double so ask sources / optional private overlays resolve without
 * shipping real Lindow Labs teaching material in the public tree.
 *
 * Production should set TINKER_PRIVATE_DIR to the real private pack.
 * Callers that already set TINKER_PRIVATE_DIR keep their value.
 */
"use strict";

const path = require("node:path");

if (!String(process.env.TINKER_PRIVATE_DIR || "").trim()) {
  process.env.TINKER_PRIVATE_DIR = path.join(
    __dirname,
    "fixtures",
    "private-pack",
  );
}
