/* GET /api/receipts
 *
 * Lists every receipt in the shared Postgres so tinker's sidebar
 * "Receipts" view can render the production catalogue. Click-through
 * to the rendered receipt page is served from /api/receipts/[id]
 * — same data, same origin, available in both preview and production
 * because both deploys point at the same DATABASE_URL.
 *
 * Auth mirrors /api/user-data/*: a Stytch session JWT in the
 * Authorization header. Anyone signed into tinker can list; we
 * don't scope by user because receipts are a public catalogue
 * (the per-receipt page itself is also public on the beginner API).
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function totalFor(items) {
  if (!Array.isArray(items)) return 0;
  let sum = 0;
  for (const it of items) {
    const price = Number(it && it.price);
    const qty = Number(it && it.qty);
    if (Number.isFinite(price) && Number.isFinite(qty)) sum += price * qty;
  }
  return sum;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const token = extractBearer(req.headers && req.headers.authorization);
    await authenticateSession(token);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  try {
    const rows = await prisma.receipt.findMany({
      orderBy: { createdAt: "desc" },
    });
    const receipts = rows.map((r) => ({
      id: r.id,
      date: r.date,
      maker: r.maker,
      makerLocation: r.makerLocation,
      customer: r.customer,
      total: totalFor(r.items),
    }));
    res.setHeader(
      "Cache-Control",
      "private, max-age=0, s-maxage=30, stale-while-revalidate=60",
    );
    res.status(200).json({ receipts });
  } catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
  }
};
