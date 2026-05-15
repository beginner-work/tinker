/* GET /api/receipts/:id
 *
 * Renders one receipt as HTML so tinker's "Receipts" list can deep-link
 * a row to a full-page view in a new tab. Mirrors the canonical render
 * in beginner/api/src/routes/receipts.ts — kept here so tinker's
 * request path stays same-origin and self-contained (no cross-origin
 * call to the marketplace Express API, no CSP widening).
 *
 * Returns JSON when the client prefers it (Accept: application/json),
 * matching the beginner endpoint's content negotiation. Unauthenticated:
 * the public per-receipt page on the beginner API is also public, and
 * the list endpoint is the gated index.
 */

"use strict";

const prisma = require("../_lib/db.js");

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value) {
  const n = Number(value);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function renderReceiptHtml(receipt) {
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const subtotal = items.reduce(
    (sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0),
    0,
  );
  const paddedId = String(receipt.id).padStart(7, "0");

  const itemRows = items
    .map(
      (it) => `
        <li class="receipt__item">
          <div class="receipt__item-head">
            <span class="receipt__item-name">${escapeHtml(it.name)}</span>
            <span class="receipt__item-price">${escapeHtml(formatMoney(Number(it.price || 0) * Number(it.qty || 0)))}</span>
          </div>
          ${
            it.description
              ? `<p class="receipt__item-desc">${escapeHtml(it.description)}</p>`
              : ""
          }
          <p class="receipt__item-meta">${escapeHtml(`Qty ${it.qty} · ${formatMoney(it.price)} each`)}</p>
        </li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Receipt ${escapeHtml(paddedId)} · beginner</title>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" />
    <style>
      :root {
        --bg: #fffdf7;
        --ink: #2d2a26;
        --muted: #6f6a65;
        --line: #ede8e0;
        --forest: #2d5a3d;
        --parchment: #f7f0e3;
        --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
        --font-display: "Plus Jakarta Sans", "Inter", system-ui, sans-serif;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: var(--font-sans);
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      body {
        min-height: 100vh;
        display: flex;
        justify-content: center;
        padding: 48px 24px 64px;
        background:
          radial-gradient(circle at 20% 12%, rgba(123, 196, 122, 0.10), transparent 42%),
          radial-gradient(circle at 88% 18%, rgba(165, 180, 252, 0.12), transparent 38%),
          radial-gradient(circle at 50% 110%, rgba(253, 186, 116, 0.08), transparent 50%),
          var(--bg);
      }
      .receipt { max-width: 520px; width: 100%; display: flex; flex-direction: column; gap: 20px; }
      .receipt__brand { display: flex; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; }
      .receipt__wordmark { margin: 0; font-family: var(--font-display); font-weight: 700; font-size: 22px; letter-spacing: -0.02em; }
      .receipt__card {
        background: var(--parchment);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 28px 28px 24px;
        box-shadow: 0 1px 2px rgba(45, 90, 61, 0.05);
      }
      .receipt__header {
        display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
        padding-bottom: 18px; border-bottom: 1px dashed var(--line);
      }
      .receipt__label {
        display: inline-block; font-size: 11px; font-weight: 600;
        letter-spacing: 0.08em; text-transform: uppercase; color: var(--forest);
      }
      .receipt__number { margin: 4px 0 0; font-family: var(--font-display); font-weight: 700; font-size: 24px; letter-spacing: -0.01em; }
      .receipt__date { font-size: 13px; color: var(--muted); text-align: right; }
      .receipt__parties {
        display: grid; grid-template-columns: 1fr 1fr; gap: 18px;
        padding: 20px 0; border-bottom: 1px dashed var(--line);
      }
      .receipt__party-label {
        font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
        text-transform: uppercase; color: var(--muted); margin: 0 0 4px;
      }
      .receipt__party-name { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 16px; color: var(--ink); }
      .receipt__party-meta { margin: 2px 0 0; font-size: 13px; color: var(--muted); }
      .receipt__items {
        list-style: none; padding: 18px 0 6px; margin: 0;
        display: flex; flex-direction: column; gap: 16px; border-bottom: 1px dashed var(--line);
      }
      .receipt__item-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
      .receipt__item-name { font-family: var(--font-display); font-weight: 600; font-size: 15px; }
      .receipt__item-price { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 15px; }
      .receipt__item-desc { margin: 4px 0 0; font-size: 14px; color: var(--ink); opacity: 0.85; }
      .receipt__item-meta { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
      .receipt__total { display: flex; justify-content: space-between; align-items: baseline; padding: 18px 0 6px; }
      .receipt__total-label {
        font-family: var(--font-display); font-weight: 600; font-size: 14px;
        letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted);
      }
      .receipt__total-value {
        font-family: var(--font-display); font-weight: 700; font-size: 22px;
        font-variant-numeric: tabular-nums; color: var(--forest);
      }
      .receipt__acct {
        margin: 14px 0 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px; letter-spacing: 0.04em; color: var(--muted); text-align: right;
      }
      .receipt__footer { margin: 0; font-size: 13px; color: var(--muted); text-align: center; }
      @media (max-width: 520px) {
        body { padding: 28px 16px 48px; }
        .receipt__card { padding: 22px 20px 20px; }
        .receipt__parties { grid-template-columns: 1fr; gap: 14px; }
      }
    </style>
  </head>
  <body>
    <main class="receipt">
      <a class="receipt__brand" href="/" aria-label="tinker home">
        <span class="receipt__wordmark">tinker</span>
      </a>

      <section class="receipt__card" aria-labelledby="receipt-number">
        <header class="receipt__header">
          <div>
            <span class="receipt__label">Receipt</span>
            <p class="receipt__number" id="receipt-number">№ ${escapeHtml(paddedId)}</p>
          </div>
          <p class="receipt__date">${escapeHtml(receipt.date)}</p>
        </header>

        <div class="receipt__parties">
          <div>
            <p class="receipt__party-label">From</p>
            <p class="receipt__party-name">${escapeHtml(receipt.maker)}</p>
            <p class="receipt__party-meta">${escapeHtml(receipt.makerLocation)}</p>
          </div>
          <div>
            <p class="receipt__party-label">To</p>
            <p class="receipt__party-name">${escapeHtml(receipt.customer)}</p>
          </div>
        </div>

        <ul class="receipt__items">${itemRows}
        </ul>

        <div class="receipt__total">
          <span class="receipt__total-label">Total</span>
          <span class="receipt__total-value">${escapeHtml(formatMoney(subtotal))}</span>
        </div>

        <p class="receipt__acct">${escapeHtml(receipt.acct)}</p>
      </section>

      <p class="receipt__footer">Thank you. &copy; 2026 tinker</p>
    </main>
  </body>
</html>`;
}

function wantsJson(req) {
  const accept = (req.headers && req.headers.accept) || "";
  if (!accept) return false;
  const lower = accept.toLowerCase();
  if (lower.includes("application/json") && !lower.includes("text/html")) return true;
  // application/json explicitly listed with a higher q than text/html — close
  // enough; the real negotiation happens in the browser which sends text/html.
  return lower.indexOf("application/json") >= 0 && lower.indexOf("text/html") < 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const id = String(
    (req.query && req.query.id) ||
      (req.url ? req.url.split("?")[0].split("/").pop() : ""),
  );
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }

  let receipt;
  try {
    receipt = await prisma.receipt.findUnique({ where: { id } });
  } catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
    return;
  }

  if (!receipt) {
    if (wantsJson(req)) {
      res.status(404).json({ error: "Receipt not found" });
    } else {
      res.status(404).setHeader("Content-Type", "text/plain").send("Receipt not found");
    }
    return;
  }

  if (wantsJson(req)) {
    res.status(200).json(receipt);
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );
  res.status(200).send(renderReceiptHtml(receipt));
};
