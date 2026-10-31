"use strict";

/** @typedef {'prerequisite' | 'related'} EdgeType */
/** @typedef {'too_easy' | 'in_zpd' | 'too_hard'} ZpdBand */
/** @typedef {'honest_statement' | 'reading' | 'ask' | 'skip' | 'response' | 'lecture' | 'explanation'} SignalType */

/**
 * Ordered depth levels used with Jev Score criteria and local heuristics.
 * Index is the discrete level; continuous depth is level / (N-1).
 */
const DEPTH_LEVELS = Object.freeze([
  {
    id: "unfamiliar",
    label: "Unfamiliar: has not meaningfully encountered the concept",
  },
  {
    id: "novice",
    label: "Novice: recognizes terms but cannot apply unaided",
  },
  {
    id: "working",
    label: "Working: can apply with support or scaffolding",
  },
  {
    id: "fluent",
    label: "Fluent: correct unaided application in typical settings",
  },
  {
    id: "transfer",
    label: "Transfer: can extend, teach, or transfer the concept",
  },
]);

const DEPTH_MAX_LEVEL = DEPTH_LEVELS.length - 1;

const ZPD_BANDS = Object.freeze(["too_easy", "in_zpd", "too_hard"]);

/**
 * @param {number} level
 * @returns {number} continuous depth in [0, 1]
 */
function levelToDepth(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n / DEPTH_MAX_LEVEL));
}

/**
 * @param {number} depth
 * @returns {number} nearest discrete level 0..DEPTH_MAX_LEVEL
 */
function depthToLevel(depth) {
  const d = Number(depth);
  if (!Number.isFinite(d)) return 0;
  return Math.min(
    DEPTH_MAX_LEVEL,
    Math.max(0, Math.round(d * DEPTH_MAX_LEVEL)),
  );
}

/**
 * @param {Partial<{id:string,slug:string,title:string,description:string,tags:string[],targetDepth:number}>} input
 */
function makeConcept(input) {
  const id = String((input && input.id) || "").trim();
  const slug = String((input && input.slug) || id).trim();
  if (!id) throw new Error("concept id required");
  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => String(t)).filter(Boolean)
    : [];
  const targetDepth =
    typeof input.targetDepth === "number" && Number.isFinite(input.targetDepth)
      ? Math.min(1, Math.max(0, input.targetDepth))
      : 0.5;
  return {
    id,
    slug,
    title: String((input && input.title) || slug),
    description: String((input && input.description) || ""),
    tags,
    targetDepth,
  };
}

/**
 * @param {Partial<{fromId:string,toId:string,type:EdgeType,weight:number}>} input
 */
function makeEdge(input) {
  const fromId = String((input && input.fromId) || "").trim();
  const toId = String((input && input.toId) || "").trim();
  const type = input && input.type === "related" ? "related" : "prerequisite";
  if (!fromId || !toId) throw new Error("edge fromId and toId required");
  const weight =
    typeof input.weight === "number" && Number.isFinite(input.weight)
      ? input.weight
      : 1;
  return { fromId, toId, type, weight };
}

/**
 * @param {Partial<{depth:number,confidence:number,updatedAt:string|null,evidenceCount:number}>} [prior]
 */
function makeBelief(prior) {
  const depth =
    prior && typeof prior.depth === "number" && Number.isFinite(prior.depth)
      ? Math.min(1, Math.max(0, prior.depth))
      : 0;
  const confidence =
    prior &&
    typeof prior.confidence === "number" &&
    Number.isFinite(prior.confidence)
      ? Math.min(1, Math.max(0, prior.confidence))
      : 0.1;
  const evidenceCount =
    prior &&
    typeof prior.evidenceCount === "number" &&
    Number.isFinite(prior.evidenceCount)
      ? Math.max(0, Math.floor(prior.evidenceCount))
      : 0;
  return {
    depth,
    confidence,
    evidenceCount,
    updatedAt: (prior && prior.updatedAt) || null,
  };
}

/**
 * In-memory concept graph + per-user beliefs.
 */
class ConceptGraph {
  constructor() {
    /** @type {Map<string, ReturnType<typeof makeConcept>>} */
    this.concepts = new Map();
    /** @type {ReturnType<typeof makeEdge>[]} */
    this.edges = [];
    /** @type {Map<string, Map<string, ReturnType<typeof makeBelief>>>} */
    this.beliefs = new Map();
  }

  /** @param {Parameters<typeof makeConcept>[0]} concept */
  upsertConcept(concept) {
    const c = makeConcept(concept);
    this.concepts.set(c.id, c);
    return c;
  }

  /** @param {Parameters<typeof makeEdge>[0]} edge */
  addEdge(edge) {
    const e = makeEdge(edge);
    this.edges.push(e);
    return e;
  }

  /**
   * @param {string} userId
   * @param {string} conceptId
   */
  getBelief(userId, conceptId) {
    const uid = String(userId || "");
    const cid = String(conceptId || "");
    const byUser = this.beliefs.get(uid);
    if (!byUser || !byUser.has(cid)) return makeBelief();
    return makeBelief(byUser.get(cid));
  }

  /**
   * @param {string} userId
   * @param {string} conceptId
   * @param {Parameters<typeof makeBelief>[0]} belief
   */
  setBelief(userId, conceptId, belief) {
    const uid = String(userId || "");
    const cid = String(conceptId || "");
    if (!uid || !cid) throw new Error("userId and conceptId required");
    let byUser = this.beliefs.get(uid);
    if (!byUser) {
      byUser = new Map();
      this.beliefs.set(uid, byUser);
    }
    const next = makeBelief({
      ...belief,
      updatedAt: new Date().toISOString(),
    });
    byUser.set(cid, next);
    return next;
  }

  /** @param {string} userId */
  listBeliefs(userId) {
    const uid = String(userId || "");
    const byUser = this.beliefs.get(uid);
    if (!byUser) return [];
    const out = [];
    for (const [conceptId, belief] of byUser.entries()) {
      const concept = this.concepts.get(conceptId) || null;
      out.push({
        conceptId,
        concept,
        belief: makeBelief(belief),
      });
    }
    return out;
  }

  toJSON() {
    return {
      concepts: [...this.concepts.values()],
      edges: this.edges.slice(),
      beliefs: [...this.beliefs.entries()].map(([userId, map]) => ({
        userId,
        concepts: [...map.entries()].map(([conceptId, belief]) => ({
          conceptId,
          ...makeBelief(belief),
        })),
      })),
    };
  }

  /** @param {ReturnType<ConceptGraph['toJSON']>} data */
  static fromJSON(data) {
    const g = new ConceptGraph();
    for (const c of (data && data.concepts) || []) g.upsertConcept(c);
    for (const e of (data && data.edges) || []) g.addEdge(e);
    for (const row of (data && data.beliefs) || []) {
      for (const b of row.concepts || []) {
        g.setBelief(row.userId, b.conceptId, b);
      }
    }
    return g;
  }
}

module.exports = {
  DEPTH_LEVELS,
  DEPTH_MAX_LEVEL,
  ZPD_BANDS,
  levelToDepth,
  depthToLevel,
  makeConcept,
  makeEdge,
  makeBelief,
  ConceptGraph,
};
