"use strict";

const { rankSourcesForZpd } = require("./zpd.js");
const { noulSourceInZpd } = require("./jev.js");

/**
 * Recommend sources for a learner using the local ZPD classifier.
 * Optionally re-rank top candidates with Jev Noul when keys are present.
 *
 * @param {object} args
 * @param {import('./schema.js').ConceptGraph} args.graph
 * @param {string} args.userId
 * @param {{ id: string, title?: string, conceptIds?: string[], depth: number, summary?: string }[]} args.sources
 * @param {{ margin?: number, useJev?: boolean, fetchFn?: typeof fetch, env?: NodeJS.ProcessEnv, topK?: number }} [args.opts]
 */
async function recommendSources({ graph, userId, sources, opts }) {
  const ranked = rankSourcesForZpd(
    sources,
    (conceptId) => graph.getBelief(userId, conceptId).depth,
    { margin: opts && opts.margin },
  );

  const topK = (opts && opts.topK) || 5;
  const top = ranked.slice(0, Math.max(topK, ranked.length));

  if (!(opts && opts.useJev)) {
    return {
      recommendations: top,
      method: "local_zpd",
    };
  }

  const beliefSummary = graph.listBeliefs(userId).map((row) => ({
    conceptId: row.conceptId,
    title: row.concept ? row.concept.title : row.conceptId,
    depth: row.belief.depth,
    confidence: row.belief.confidence,
  }));

  const withJev = [];
  for (const row of top.slice(0, topK)) {
    const state = {
      learner_beliefs: beliefSummary,
      source: {
        id: row.source.id,
        title: row.source.title || row.source.id,
        depth: row.source.depth,
        summary: row.source.summary || "",
        conceptIds: row.source.conceptIds || [],
      },
      local_band: row.band,
    };
    try {
      const jev = await noulSourceInZpd(
        { state, sourceTitle: row.source.title || row.source.id },
        { fetchFn: opts.fetchFn, env: opts.env },
      );
      withJev.push({
        ...row,
        jevNoul: jev.noul,
        jevInZpd: jev.inZpd,
        rank: jev.inZpd ? Math.min(row.rank, 0) : row.rank + 0.5,
      });
    } catch (err) {
      withJev.push({
        ...row,
        jevError: err && err.message ? err.message : String(err),
      });
    }
  }

  withJev.sort((a, b) => {
    const aN = typeof a.jevNoul === "number" ? a.jevNoul : -1;
    const bN = typeof b.jevNoul === "number" ? b.jevNoul : -1;
    if (bN !== aN) return bN - aN;
    return a.rank - b.rank;
  });

  return {
    recommendations: withJev,
    method: "local_zpd+jev_noul",
  };
}

/**
 * Pick the single best source id (for eval hit-rate scoring).
 */
async function pickBestSourceId(args) {
  const result = await recommendSources(args);
  const first =
    result.recommendations && result.recommendations[0]
      ? result.recommendations[0].source.id
      : null;
  return { sourceId: first, ...result };
}

module.exports = {
  recommendSources,
  pickBestSourceId,
};
