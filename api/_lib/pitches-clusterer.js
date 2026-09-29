/* Pitch clusterer removed (TYL-65). */
"use strict";

const DECK_HEADINGS = [];
const HEADING_DESCRIPTIONS = {};
const MAX_WRITINGS = 0;
const MAX_SNIPPET_CHARS = 0;
const MAX_BUCKETS = 0;
const CLUSTER_TEMPERATURE = 0;

function noop() { return null; }
async function asyncNoop() { return []; }

module.exports = {
  DECK_HEADINGS,
  HEADING_DESCRIPTIONS,
  MAX_WRITINGS,
  MAX_SNIPPET_CHARS,
  MAX_BUCKETS,
  CLUSTER_TEMPERATURE,
  buildClusterPrompt: noop,
  buildNamePrompt: noop,
  buildUserMessage: noop,
  validateTitle: noop,
  validateHeading: noop,
  fallbackPhrase: noop,
  fallbackHeading: noop,
  resolvePhraseText: noop,
  parseClassifierJson: noop,
  callClusterer: asyncNoop,
  normalizeInputs: () => [],
  reconcileClusters: () => [],
  clusterWritings: asyncNoop,
  nameWritings: asyncNoop,
};
