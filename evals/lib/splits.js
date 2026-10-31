"use strict";

/**
 * Fixed-seed train / dev / held-out test splits.
 *
 * Iteration loops may read **train** (fit) and **dev** (tune) only.
 * **test** is held out: run rarely via EVAL_SPLIT=test or --test, and every
 * test run increments the logged test-evaluation count.
 */

const crypto = require("node:crypto");

const DEFAULT_SEED = 42;
const DEFAULT_RATIOS = Object.freeze({ train: 0.6, dev: 0.2, test: 0.2 });

/** @param {number} seed */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable string hash → [0,1). SHA-256 of `seed::id` so nearby ids do not
 * cluster the way a short FNV mix does.
 */
function hashToUnit(str, seed) {
  const digest = crypto
    .createHash("sha256")
    .update(`${seed}::${str}`)
    .digest();
  // First 4 bytes as uint32
  const n = digest.readUInt32BE(0);
  return n / 4294967296;
}

/**
 * Assign an id to train|dev|test.
 * Uses rank-by-hash cut points so small N still gets all three splits
 * when N >= 3 (floor proportions, remainder to test).
 * @param {string} id
 * @param {{ seed?: number, ratios?: {train:number,dev:number,test:number}, universe?: string[] }} [opts]
 * @returns {'train'|'dev'|'test'}
 */
function assignSplit(id, opts) {
  const universe = opts && Array.isArray(opts.universe) ? opts.universe : null;
  if (universe && universe.length) {
    const splits = splitByKey(
      universe.map((u) => ({ id: u })),
      (x) => x.id,
      opts,
    );
    if (splits.train.some((x) => x.id === id)) return "train";
    if (splits.dev.some((x) => x.id === id)) return "dev";
    return "test";
  }
  // Single-id fallback: hash bucket (may leave a split empty for tiny sets).
  const seed = (opts && opts.seed) != null ? Number(opts.seed) : DEFAULT_SEED;
  const ratios = (opts && opts.ratios) || DEFAULT_RATIOS;
  const u = hashToUnit(String(id), seed);
  const trainEnd = ratios.train;
  const devEnd = ratios.train + ratios.dev;
  if (u < trainEnd) return "train";
  if (u < devEnd) return "dev";
  return "test";
}

/**
 * Partition items by a key function into train/dev/test.
 * Sort by hash(seed, key), then cut by floor(ratio * N). Guarantees each
 * non-empty quota when N >= 3 for default 60/20/20.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyFn
 * @param {{ seed?: number, ratios?: object }} [opts]
 */
function splitByKey(items, keyFn, opts) {
  const seed = (opts && opts.seed) != null ? Number(opts.seed) : DEFAULT_SEED;
  const ratios = (opts && opts.ratios) || DEFAULT_RATIOS;
  const list = [...(items || [])];
  list.sort((a, b) => {
    const ua = hashToUnit(String(keyFn(a)), seed);
    const ub = hashToUnit(String(keyFn(b)), seed);
    if (ua < ub) return -1;
    if (ua > ub) return 1;
    return String(keyFn(a)).localeCompare(String(keyFn(b)));
  });
  const n = list.length;
  let nTrain = Math.floor(n * ratios.train);
  let nDev = Math.floor(n * ratios.dev);
  let nTest = n - nTrain - nDev;
  // Ensure every split gets at least one item when possible.
  if (n >= 3) {
    if (nTest === 0) {
      if (nTrain >= nDev && nTrain > 1) {
        nTrain -= 1;
        nTest += 1;
      } else if (nDev > 1) {
        nDev -= 1;
        nTest += 1;
      }
    }
    if (nDev === 0) {
      if (nTrain > 1) {
        nTrain -= 1;
        nDev += 1;
      } else if (nTest > 1) {
        nTest -= 1;
        nDev += 1;
      }
    }
    if (nTrain === 0) {
      if (nDev > 1) {
        nDev -= 1;
        nTrain += 1;
      } else if (nTest > 1) {
        nTest -= 1;
        nTrain += 1;
      }
    }
  }
  return {
    train: list.slice(0, nTrain),
    dev: list.slice(nTrain, nTrain + nDev),
    test: list.slice(nTrain + nDev),
  };
}

/**
 * Which split the current process may evaluate.
 * Default: dev. test only when explicitly requested.
 */
function activeSplit(env, argv) {
  const e = env || process.env;
  const args = argv || process.argv.slice(2);
  if (args.includes("--test") || String(e.EVAL_SPLIT || "").toLowerCase() === "test") {
    return "test";
  }
  if (args.includes("--train") || String(e.EVAL_SPLIT || "").toLowerCase() === "train") {
    return "train";
  }
  return "dev";
}

function splitSeed(env) {
  const e = env || process.env;
  return Number(e.EVAL_SPLIT_SEED || e.EDNET_SAMPLE_SEED || DEFAULT_SEED);
}

module.exports = {
  DEFAULT_SEED,
  DEFAULT_RATIOS,
  mulberry32,
  hashToUnit,
  assignSplit,
  splitByKey,
  activeSplit,
  splitSeed,
};
