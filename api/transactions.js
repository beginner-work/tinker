/* GET /api/transactions
 *
 * Returns the signed-in buyer's marketplace transactions, ordered
 * newest-first, with line items attached. Resolves the buyer by the
 * phone number on the Stytch session — the same phone the user
 * authenticated with — and reads the canonical Buyer/Transaction
 * tables that the beginner Express API owns.
 *
 * The Buyer/Transaction/Merchant/TransactionItem models are NOT
 * mirrored into web's Prisma schema on purpose: the schema is owned
 * by beginner/api/prisma, and a mirror would silently rot every time
 * a column changes there. Using parameterised raw SQL keeps web's
 * Prisma client free of model definitions while still going through
 * the connection pool.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const prisma = require("./_lib/db.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function pickPhone(session) {
  const user = (session && session.user) || {};
  const list = Array.isArray(user.phone_numbers) ? user.phone_numbers : [];
  const verified = list.find((p) => p && p.verified);
  const chosen = verified || list[0];
  return chosen && chosen.phone_number ? String(chosen.phone_number) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let phone = "";
  try {
    const token = extractBearer(req.headers && req.headers.authorization);
    const session = await authenticateSession(token);
    phone = pickPhone(session);
    if (!phone) {
      res.status(401).json({ error: "Session has no phone number." });
      return;
    }
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  try {
    const txns = await prisma.$queryRaw`
      SELECT
        t.id                   AS "id",
        t."totalAmount"        AS "totalAmount",
        t.status               AS "status",
        t."createdAt"          AS "createdAt",
        t."paymentCompletedAt" AS "paymentCompletedAt",
        m.name                 AS "merchantName"
      FROM "Transaction" t
      JOIN "Buyer"    b ON b.id = t."buyerId"
      JOIN "Merchant" m ON m.id = t."merchantId"
      WHERE b.phone = ${phone}
      ORDER BY t."createdAt" DESC
      LIMIT 100
    `;

    const ids = txns.map((t) => t.id);
    const items = ids.length
      ? await prisma.$queryRaw`
          SELECT
            id,
            "transactionId" AS "transactionId",
            description,
            price,
            quantity
          FROM "TransactionItem"
          WHERE "transactionId" = ANY(${ids})
        `
      : [];

    const byTxn = new Map();
    for (const it of items) {
      const list = byTxn.get(it.transactionId) || [];
      list.push({
        id: it.id,
        description: it.description,
        price: Number(it.price),
        quantity: Number(it.quantity),
      });
      byTxn.set(it.transactionId, list);
    }

    const out = txns.map((t) => ({
      id: t.id,
      totalAmount: Number(t.totalAmount),
      status: t.status,
      createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
      paymentCompletedAt:
        t.paymentCompletedAt instanceof Date
          ? t.paymentCompletedAt.toISOString()
          : t.paymentCompletedAt,
      merchantName: t.merchantName,
      items: byTxn.get(t.id) || [],
    }));

    res.status(200).json({ transactions: out });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
};
