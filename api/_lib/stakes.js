/* Founder-coin staking ledger (Phase A: internal ledger, practice balance).
 *
 * Every founder on tinker has a "founder coin"; any signed-in member can
 * stake part of their staking balance against another founder's coin and
 * release it back later. Phase A keeps the whole thing as an internal
 * ledger in the shared TinkerUserData table — no real deposits, nothing
 * on-chain yet. The row shapes and the endpoint contracts are designed so
 * Phase B (real USDC settled on Base) swaps the settlement layer without
 * changing clients. Model, phases, and the regulatory flags live in
 * docs/crypto-staking.md.
 *
 * Two sibling kinds, plain JSON rows like every other user-data kind:
 *
 *   (userId,    "stake:wallet") — the member's staking side
 *       { balanceCents, currency, seededAt,
 *         stakes: [{ id, founderId, amountCents, at }] }
 *   (founderId, "stake:coin")   — the founder's coin
 *       { symbol, totalStakedCents, backers: { [stakerId]: cents } }
 *
 * Amounts are integer cents of USDC. A wallet is seeded once with
 * SEED_CENTS on first touch — a practice balance, labelled as such in the
 * client, so the mechanics run end-to-end before real money does.
 *
 * Both sides of a stake move inside one interactive Prisma transaction.
 * Two concurrent writers can still clobber each other on the same row
 * (whole-blob read-modify-write, same as every user-data kind); fine at
 * Phase A volume, called out in the doc as a Phase B item.
 */

"use strict";

const prisma = require("./db.js");

const WALLET_KIND = "stake:wallet";
const COIN_KIND = "stake:coin";
const CURRENCY = "USDC";
// 100.00 practice USDC. Generous enough to back several founders,
// small enough that nobody mistakes it for a real deposit.
const SEED_CENTS = 100 * 100;
// One stake is capped at the seed so a typo'd amount can't drain a
// future real balance in one move.
const MAX_STAKE_CENTS = SEED_CENTS;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// ── Row shapes ─────────────────────────────────────────────────────────

function normalizeWallet(row) {
  const d = row && row.data && typeof row.data === "object" ? row.data : null;
  if (!d) return null;
  return {
    balanceCents: Number.isInteger(d.balanceCents) ? d.balanceCents : 0,
    currency: CURRENCY,
    seededAt: typeof d.seededAt === "string" ? d.seededAt : null,
    stakes: Array.isArray(d.stakes)
      ? d.stakes.filter(
          (s) =>
            s &&
            typeof s.id === "string" &&
            typeof s.founderId === "string" &&
            Number.isInteger(s.amountCents) &&
            s.amountCents > 0,
        )
      : [],
  };
}

function normalizeCoin(row) {
  const d = row && row.data && typeof row.data === "object" ? row.data : null;
  const backers =
    d && d.backers && typeof d.backers === "object" ? d.backers : {};
  const clean = {};
  for (const [staker, cents] of Object.entries(backers)) {
    if (Number.isInteger(cents) && cents > 0) clean[staker] = cents;
  }
  return {
    symbol: d && typeof d.symbol === "string" && d.symbol ? d.symbol : null,
    totalStakedCents:
      d && Number.isInteger(d.totalStakedCents) && d.totalStakedCents > 0
        ? d.totalStakedCents
        : 0,
    backers: clean,
  };
}

// Ticker-style symbol for a founder coin: the letters of their profile
// name ("Tyler Lindow" → "TYLE"), falling back to a tail of the Stytch
// user id when there's no usable name yet.
function deriveSymbol(name, userId) {
  const letters = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (letters.length >= 2) return letters.slice(0, 4);
  const tail = String(userId || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return ("FDR" + tail.slice(-3)).slice(0, 6);
}

function newStakeId() {
  return (
    "stk_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

async function readWallet(tx, userId) {
  const row = await tx.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: WALLET_KIND } },
  });
  return normalizeWallet(row);
}

function seededWallet() {
  return {
    balanceCents: SEED_CENTS,
    currency: CURRENCY,
    seededAt: new Date().toISOString(),
    stakes: [],
  };
}

async function writeWallet(tx, userId, wallet) {
  await tx.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: WALLET_KIND } },
    create: { userId, kind: WALLET_KIND, data: wallet },
    update: { data: wallet },
  });
}

async function writeCoin(tx, founderId, coin) {
  await tx.tinkerUserData.upsert({
    where: { userId_kind: { userId: founderId, kind: COIN_KIND } },
    create: { userId: founderId, kind: COIN_KIND, data: coin },
    update: { data: coin },
  });
}

// The founder side of a coin needs a symbol the first time anyone
// stakes; it comes from the founder's own profile row when one exists.
async function ensureSymbol(tx, founderId, coin) {
  if (coin.symbol) return coin;
  const profile = await tx.tinkerUserData.findUnique({
    where: { userId_kind: { userId: founderId, kind: "profile" } },
  });
  const name =
    profile && profile.data && typeof profile.data === "object"
      ? profile.data.name
      : null;
  return { ...coin, symbol: deriveSymbol(name, founderId) };
}

// ── Public operations ──────────────────────────────────────────────────

/* Read (and on first touch, seed) the member's staking wallet. */
async function getWallet(userId) {
  const existing = normalizeWallet(
    await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: WALLET_KIND } },
    }),
  );
  if (existing) return existing;
  const wallet = seededWallet();
  try {
    await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: WALLET_KIND } },
      create: { userId, kind: WALLET_KIND, data: wallet },
      update: { data: wallet },
    });
  } catch {
    // A concurrent first touch already seeded it; the re-read below
    // (or the seeded copy we hold) is equally valid either way.
  }
  return wallet;
}

/* Public coin stats for a founder, plus the viewer's own position. */
async function getCoin(founderId, viewerId) {
  const coin = normalizeCoin(
    await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId: founderId, kind: COIN_KIND } },
    }),
  );
  return {
    founderId,
    symbol: coin.symbol || deriveSymbol(null, founderId),
    totalStakedCents: coin.totalStakedCents,
    backerCount: Object.keys(coin.backers).length,
    myStakeCents: (viewerId && coin.backers[viewerId]) || 0,
  };
}

/* Move `amountCents` from the member's balance into a stake on the
 * founder's coin. Both rows move in one transaction. */
async function placeStake(userId, founderId, amountCents) {
  if (typeof founderId !== "string" || !founderId.trim()) {
    throw httpError(400, "Body must include a `founderId`.");
  }
  founderId = founderId.trim();
  if (founderId === userId) {
    throw httpError(400, "You can't stake on your own coin.");
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw httpError(400, "`amountCents` must be a positive integer.");
  }
  if (amountCents > MAX_STAKE_CENTS) {
    throw httpError(400, "One stake is capped at 100.00 USDC.");
  }

  return prisma.$transaction(async (tx) => {
    // The founder must be a real tinker user — any row of theirs proves it.
    const founderRow = await tx.tinkerUserData.findFirst({
      where: { userId: founderId },
      select: { userId: true },
    });
    if (!founderRow) throw httpError(404, "No founder with that id.");

    const wallet = (await readWallet(tx, userId)) || seededWallet();
    if (wallet.balanceCents < amountCents) {
      throw httpError(400, "Insufficient staking balance.");
    }

    const stake = {
      id: newStakeId(),
      founderId,
      amountCents,
      at: new Date().toISOString(),
    };
    wallet.balanceCents -= amountCents;
    wallet.stakes.push(stake);

    let coin = normalizeCoin(
      await tx.tinkerUserData.findUnique({
        where: { userId_kind: { userId: founderId, kind: COIN_KIND } },
      }),
    );
    coin = await ensureSymbol(tx, founderId, coin);
    coin.totalStakedCents += amountCents;
    coin.backers[userId] = (coin.backers[userId] || 0) + amountCents;

    await writeWallet(tx, userId, wallet);
    await writeCoin(tx, founderId, coin);

    return {
      stake,
      wallet,
      coin: {
        founderId,
        symbol: coin.symbol,
        totalStakedCents: coin.totalStakedCents,
        backerCount: Object.keys(coin.backers).length,
        myStakeCents: coin.backers[userId],
      },
    };
  });
}

/* Release a stake back into the member's balance and shrink the coin. */
async function releaseStake(userId, stakeId) {
  if (typeof stakeId !== "string" || !stakeId.trim()) {
    throw httpError(400, "Body must include a `stakeId`.");
  }
  stakeId = stakeId.trim();

  return prisma.$transaction(async (tx) => {
    const wallet = await readWallet(tx, userId);
    const stake = wallet && wallet.stakes.find((s) => s.id === stakeId);
    if (!stake) throw httpError(404, "No stake with that id.");

    wallet.stakes = wallet.stakes.filter((s) => s.id !== stakeId);
    wallet.balanceCents += stake.amountCents;

    const coin = normalizeCoin(
      await tx.tinkerUserData.findUnique({
        where: {
          userId_kind: { userId: stake.founderId, kind: COIN_KIND },
        },
      }),
    );
    coin.totalStakedCents = Math.max(
      0,
      coin.totalStakedCents - stake.amountCents,
    );
    const mine = (coin.backers[userId] || 0) - stake.amountCents;
    if (mine > 0) coin.backers[userId] = mine;
    else delete coin.backers[userId];

    await writeWallet(tx, userId, wallet);
    await writeCoin(tx, stake.founderId, coin);

    return { wallet, released: stake };
  });
}

module.exports = {
  getWallet,
  getCoin,
  placeStake,
  releaseStake,
  deriveSymbol,
  WALLET_KIND,
  COIN_KIND,
  SEED_CENTS,
  MAX_STAKE_CENTS,
};
