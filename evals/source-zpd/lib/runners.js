"use strict";

const path = require("node:path");
const cm = require(path.join(
  __dirname,
  "..",
  "..",
  "..",
  "packages",
  "context-model",
  "src",
  "index.js",
));
const {
  loadEvalConfig,
  renderTemplate,
  jevSourceNoulQuestion,
  noulThreshold,
} = require("../../config/load.js");

/**
 * Build an in-memory graph for a case (single or multi-session).
 */
function graphForCase(caseRow) {
  const graph = new cm.ConceptGraph();
  const userId = "learner";
  const depths = caseRow.learnerDepthByConcept || {};
  for (const [conceptId, depth] of Object.entries(depths)) {
    graph.upsertConcept({
      id: conceptId,
      slug: conceptId,
      title: conceptId,
      targetDepth: 0.5,
    });
    graph.setBelief(userId, conceptId, {
      depth: Number(depth) || 0,
      confidence: 0.7,
      evidenceCount: 3,
    });
  }

  if (caseRow.multiSession && Array.isArray(caseRow.sessions)) {
    for (const session of caseRow.sessions) {
      for (const signal of session.signals || []) {
        cm.applySignal(graph, userId, signal);
      }
    }
  }

  for (const source of caseRow.sources || []) {
    for (const cid of source.conceptIds || []) {
      if (!graph.concepts.has(cid)) {
        graph.upsertConcept({ id: cid, slug: cid, title: cid });
      }
    }
  }

  return { graph, userId };
}

/**
 * Tinker recommender (local ZPD; optional Jev with versioned Noul config).
 */
async function runTinkerCase(caseRow, opts) {
  const { graph, userId } = graphForCase(caseRow);
  const pack =
    (opts && opts.config) ||
    loadEvalConfig({ env: (opts && opts.env) || process.env });

  // Local rank first
  let result = await cm.pickBestSourceId({
    graph,
    userId,
    sources: caseRow.sources,
    opts: {
      useJev: false,
      fetchFn: opts && opts.fetchFn,
      env: opts && opts.env,
      topK: 5,
    },
  });

  if (opts && opts.useJev && cm.resolveJevConfig(opts.env).available) {
    const ranked = result.recommendations || [];
    const beliefSummary = graph.listBeliefs(userId).map((row) => ({
      conceptId: row.conceptId,
      title: row.concept ? row.concept.title : row.conceptId,
      depth: row.belief.depth,
      confidence: row.belief.confidence,
    }));
    const withJev = [];
    const question = jevSourceNoulQuestion(pack, "");
    const threshold = noulThreshold(pack);
    for (const row of ranked.slice(0, 5)) {
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
        const jev = await cm.noulSourceInZpd(
          {
            state,
            sourceTitle: row.source.title || row.source.id,
            question: {
              ...question,
              instructions: renderTemplate(pack.jevSourceNoul.instructions, {
                sourceTitle: row.source.title || row.source.id,
              }),
            },
            threshold,
          },
          { fetchFn: opts.fetchFn, env: opts.env },
        );
        withJev.push({
          ...row,
          jevNoul: jev.noul,
          jevInZpd: jev.inZpd,
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
      return bN - aN;
    });
    result = {
      sourceId: withJev[0] ? withJev[0].source.id : null,
      recommendations: withJev,
      method: "local_zpd+jev_noul",
    };
  }

  const predicted = result.sourceId;
  const hits = (caseRow.inBandSourceIds || []).includes(predicted);
  return {
    method: result.method,
    version: pack.version,
    predicted,
    hit: hits,
    recommendations: (result.recommendations || []).slice(0, 3).map((r) => ({
      id: r.source.id,
      band: r.band,
      jevNoul: r.jevNoul,
    })),
  };
}

/**
 * Claude-only source pick using versioned templates (no agent modeling).
 * Uses AI Gateway when available, else Anthropic direct.
 */
async function runClaudeCase(caseRow, opts) {
  const env = (opts && opts.env) || process.env;
  const { callClaudeMessages } = require("../../lib/claude-client.js");
  const pack =
    (opts && opts.config) || loadEvalConfig({ env });
  const sourceList = (caseRow.sources || [])
    .map(
      (s) =>
        `- id=${s.id} title=${s.title} depth=${s.depth} concepts=${(s.conceptIds || []).join(",")}: ${s.summary || ""}`,
    )
    .join("\n");
  const statement = caseRow.multiSession
    ? (caseRow.sessions || [])
        .map((s, i) => `Session ${i + 1}: ${s.honestStatement}`)
        .join("\n")
    : caseRow.honestStatement;

  const user = renderTemplate(pack.claudeSourcePick.userTemplate, {
    statement,
    sourceList,
  });

  const result = await callClaudeMessages({
    system: pack.claudeSourcePick.system,
    user,
    maxTokens: 40,
    temperature: 0,
    env,
    fetchFn: opts && opts.fetchFn,
  });
  if (result.skipped) {
    return result;
  }
  const text = String(result.text || "").trim();
  const ids = (caseRow.sources || []).map((s) => s.id);
  const predicted = ids.find((id) => text.includes(id)) || text.split(/\s+/)[0];
  return {
    skipped: false,
    method: "claude-only",
    version: pack.version,
    predicted,
    hit: (caseRow.inBandSourceIds || []).includes(predicted),
    raw: text,
    provider: result.provider,
    model: result.model,
  };
}

module.exports = {
  graphForCase,
  runTinkerCase,
  runClaudeCase,
};
