/* Prisma persistence for the context model.
 *
 * Keeps the pure graph logic in @tinker/context-model and maps rows to
 * Concept / ConceptEdge / UserConceptBelief / ContextSignal.
 */

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
const defaultPrisma = require("../db.js");

async function ensureConcept(prisma, conceptInput) {
  const c = cm.makeConcept(conceptInput);
  const tags = Array.isArray(c.tags) ? c.tags : [];
  const row = await prisma.concept.upsert({
    where: { slug: c.slug },
    create: {
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      tags,
      targetDepth: c.targetDepth,
    },
    update: {
      title: c.title,
      description: c.description,
      tags,
      targetDepth: c.targetDepth,
    },
  });
  return row;
}

async function ensureConceptsByIds(prisma, conceptIds) {
  const ids = [...new Set((conceptIds || []).map(String).filter(Boolean))];
  const out = [];
  for (const idOrSlug of ids) {
    const existing =
      (await prisma.concept.findUnique({ where: { id: idOrSlug } })) ||
      (await prisma.concept.findUnique({ where: { slug: idOrSlug } }));
    if (existing) {
      out.push(existing);
      continue;
    }
    out.push(
      await ensureConcept(prisma, {
        id: idOrSlug,
        slug: idOrSlug,
        title: idOrSlug,
      }),
    );
  }
  return out;
}

/**
 * Load the user's beliefs + the shared concept graph into an in-memory graph.
 */
async function loadUserGraph(prismaClient, userId) {
  const prisma = prismaClient || defaultPrisma;
  const uid = String(userId || "");
  const [concepts, edges, beliefs] = await Promise.all([
    prisma.concept.findMany({ orderBy: { slug: "asc" } }),
    prisma.conceptEdge.findMany(),
    prisma.userConceptBelief.findMany({ where: { userId: uid } }),
  ]);
  const graph = new cm.ConceptGraph();
  for (const c of concepts) {
    graph.upsertConcept({
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      tags: c.tags,
      targetDepth: c.targetDepth,
    });
  }
  for (const e of edges) {
    graph.addEdge({
      fromId: e.fromId,
      toId: e.toId,
      type: e.type,
      weight: e.weight,
    });
  }
  for (const b of beliefs) {
    graph.setBelief(uid, b.conceptId, {
      depth: b.depth,
      confidence: b.confidence,
      evidenceCount: b.evidenceCount,
      updatedAt: b.updatedAt ? b.updatedAt.toISOString() : null,
    });
  }
  return graph;
}

/**
 * Persist beliefs that changed after applySignal.
 */
async function persistBeliefUpdates(prismaClient, userId, updates) {
  const prisma = prismaClient || defaultPrisma;
  const uid = String(userId || "");
  for (const row of updates || []) {
    await prisma.userConceptBelief.upsert({
      where: {
        userId_conceptId: { userId: uid, conceptId: row.conceptId },
      },
      create: {
        userId: uid,
        conceptId: row.conceptId,
        depth: row.next.depth,
        confidence: row.next.confidence,
        evidenceCount: row.next.evidenceCount,
      },
      update: {
        depth: row.next.depth,
        confidence: row.next.confidence,
        evidenceCount: row.next.evidenceCount,
      },
    });
  }
}

/**
 * Ingest one normalized signal: ensure concepts, update beliefs, append log.
 */
async function ingestSignal(prismaClient, userId, rawSignal, applyOpts) {
  const prisma = prismaClient || defaultPrisma;
  const uid = String(userId || "");
  const signal = cm.normalizeSignal(rawSignal);
  const conceptRows = await ensureConceptsByIds(prisma, signal.conceptIds);
  const conceptIds = conceptRows.map((c) => c.id);

  const graph = await loadUserGraph(prisma, uid);
  const applied = cm.applySignal(graph, uid, { ...signal, conceptIds }, {
    ...(applyOpts || {}),
    conceptIds,
  });
  await persistBeliefUpdates(prisma, uid, applied.updates);

  const created = await prisma.contextSignal.create({
    data: {
      userId: uid,
      type: signal.type,
      sessionId: signal.sessionId || "",
      sourceId: signal.sourceId || "",
      payload: signal.payload || {},
      at: new Date(signal.at),
      concepts: {
        create: conceptIds.map((conceptId) => ({ conceptId })),
      },
    },
    include: { concepts: true },
  });

  return {
    signal: created,
    updates: applied.updates.map((u) => ({
      conceptId: u.conceptId,
      depth: u.next.depth,
      confidence: u.next.confidence,
      evidenceCount: u.next.evidenceCount,
      zpd: cm.classifyConceptForUser(graph, uid, u.conceptId),
    })),
  };
}

/**
 * Read shape exposed to the signed-in user (what was inferred).
 */
async function readUserContext(prismaClient, userId) {
  const prisma = prismaClient || defaultPrisma;
  const uid = String(userId || "");
  const graph = await loadUserGraph(prisma, uid);
  const beliefs = graph.listBeliefs(uid).map((row) => {
    const zpd = cm.classifyConceptForUser(graph, uid, row.conceptId);
    return {
      conceptId: row.conceptId,
      slug: row.concept ? row.concept.slug : row.conceptId,
      title: row.concept ? row.concept.title : row.conceptId,
      targetDepth: row.concept ? row.concept.targetDepth : 0.5,
      depth: row.belief.depth,
      confidence: row.belief.confidence,
      evidenceCount: row.belief.evidenceCount,
      updatedAt: row.belief.updatedAt,
      zpdBand: zpd.band,
      zpdDelta: zpd.delta,
    };
  });
  const recentSignals = await prisma.contextSignal.findMany({
    where: { userId: uid },
    orderBy: { at: "desc" },
    take: 50,
    include: { concepts: true },
  });
  return {
    userId: uid,
    concepts: [...graph.concepts.values()],
    edges: graph.edges.slice(),
    beliefs,
    recentSignals: recentSignals.map((s) => ({
      id: s.id,
      type: s.type,
      at: s.at,
      sourceId: s.sourceId,
      sessionId: s.sessionId,
      conceptIds: (s.concepts || []).map((c) => c.conceptId),
      payload: s.payload,
    })),
  };
}

module.exports = {
  ensureConcept,
  ensureConceptsByIds,
  loadUserGraph,
  persistBeliefUpdates,
  ingestSignal,
  readUserContext,
  cm,
};
