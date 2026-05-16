/* tinker — transactions module
 *
 * Two surfaces, deliberately split:
 *
 * 1) Sidebar Account → Transactions opens a modal that fetches the
 *    signed-in buyer's marketplace transactions from /api/transactions
 *    (resolved by the phone number on the Stytch session). Read-only
 *    listing with inline-expand rows showing line items and status.
 *
 * 2) window.tinkerTransactions.list() / .subscribe() still expose a
 *    localStorage-backed list ("tinker.transactions.v1") used by
 *    seeds.js (merchant suggestions) and writing.js (Claude context).
 *    No UI writes into it now; .seed() is available from the console
 *    for populating sample data. Folding marketplace transactions
 *    into that flow is a follow-up.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.transactions.v1";

  // ── Storage ──────────────────────────────────────────────────────────
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function save(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // localStorage full or denied — nothing to do here in v1.
    }
  }
  function nextId() {
    return "t_" + Math.random().toString(36).slice(2, 10);
  }

  let txns = load();
  const subscribers = new Set();
  function notify() { subscribers.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }

  // Generates ~5 weeks of realistic sample activity anchored to today —
  // a weekly grocery run, M/W/F coffee, a couple of lunches, a
  // subscription, and a few one-offs. Used to seed the heatmap so the
  // founder can see the visualisation without typing real transactions
  // in first.
  function buildSeedSamples() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out = [];
    const add = (daysAgo, merchant, amount, category) => {
      const d = new Date(today);
      d.setDate(today.getDate() - daysAgo);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({ id: nextId(), date, merchant, amount, category: category || "", _demo: true });
    };
    // Weekly groceries (Saturdays-ish)
    add(2,  "Whole Foods",     -58.23, "Groceries");
    add(9,  "Whole Foods",     -64.17, "Groceries");
    add(16, "Whole Foods",     -42.88, "Groceries");
    add(23, "Whole Foods",     -71.04, "Groceries");
    add(30, "Trader Joe's",    -38.92, "Groceries");
    // M/W/F-ish coffee
    add(1,  "Coffee Roaster",  -4.75,  "Coffee");
    add(3,  "Coffee Roaster",  -4.75,  "Coffee");
    add(5,  "Coffee Roaster",  -5.25,  "Coffee");
    add(8,  "Coffee Roaster",  -4.75,  "Coffee");
    add(10, "Coffee Roaster",  -4.75,  "Coffee");
    add(12, "Coffee Roaster",  -5.25,  "Coffee");
    add(15, "Coffee Roaster",  -4.75,  "Coffee");
    add(17, "Coffee Roaster",  -4.75,  "Coffee");
    // Lunches
    add(4,  "Sweetgreen",      -14.80, "Food");
    add(11, "Chipotle",        -12.40, "Food");
    add(18, "Sweetgreen",      -15.20, "Food");
    // Subscription
    add(15, "Notion",          -16.00, "Subscriptions");
    add(28, "Notion",          -16.00, "Subscriptions");
    // One-offs
    add(6,  "Uber",            -22.15, "Transit");
    add(13, "Amazon",          -38.99, "Goods");
    add(20, "Bookshop",        -24.50, "Books");
    return out;
  }

  // ── Public API ──────────────────────────────────────────────────────
  window.tinkerTransactions = {
    list() { return txns.slice(); },
    count() { return txns.length; },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    seed() {
      const samples = buildSeedSamples();
      txns = samples.concat(txns);
      save(txns);
      notify();
      return samples.length;
    },
    clearDemoData() {
      const before = txns.length;
      txns = txns.filter((t) => !t || !t._demo);
      if (txns.length !== before) {
        save(txns);
        notify();
      }
    },
    openAddModal() { openModal(); },
  };

  // ── Parsing ─────────────────────────────────────────────────────────
  // Accept either a JSON array of {date, merchant, amount, category?} or
  // a CSV with a header row. CSV is intentionally minimal (no escaped
  // commas / quotes); the founder can always paste JSON if their bank
  // export is fancier.
  function parseInput(text) {
    const t = (text || "").trim();
    if (!t) return { ok: false, error: "Nothing to import." };

    if (t.startsWith("[")) {
      try {
        const arr = JSON.parse(t);
        if (!Array.isArray(arr)) return { ok: false, error: "Expected a JSON array." };
        return { ok: true, rows: arr.map(normalise).filter(Boolean) };
      } catch (err) {
        return { ok: false, error: "Couldn't parse JSON: " + err.message };
      }
    }

    // CSV path
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return { ok: false, error: "CSV needs a header row plus at least one row." };
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idx = {
      date: header.indexOf("date"),
      merchant: header.findIndex((h) => h === "merchant" || h === "description" || h === "name"),
      amount: header.indexOf("amount"),
      category: header.indexOf("category"),
    };
    if (idx.date < 0 || idx.merchant < 0 || idx.amount < 0) {
      return { ok: false, error: "CSV header must include date, merchant (or description), amount." };
    }
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map((c) => c.trim());
      const row = normalise({
        date: cells[idx.date],
        merchant: cells[idx.merchant],
        amount: cells[idx.amount],
        category: idx.category >= 0 ? cells[idx.category] : "",
      });
      if (row) rows.push(row);
    }
    return { ok: true, rows };
  }

  function normalise(raw) {
    if (!raw) return null;
    const merchant = String(raw.merchant || raw.description || raw.name || "").trim();
    if (!merchant) return null;
    const amount = Number(raw.amount);
    if (!Number.isFinite(amount)) return null;
    const date = String(raw.date || "").trim() || new Date().toISOString().slice(0, 10);
    const category = String(raw.category || "").trim();
    return { id: nextId(), date, merchant, amount, category };
  }

  // ── Modal ────────────────────────────────────────────────────────────
  let modal = null;
  const expanded = new Set();

  const TOKEN_KEY = "tinker_jwt";
  function authToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  let serverTxns = [];
  let loadState = "idle"; // idle | loading | ok | error | unauth
  let loadError = "";

  function openModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "txn-modal";
    modal.innerHTML = `
      <div class="txn-modal__backdrop" data-close></div>
      <div class="txn-modal__card" role="dialog" aria-modal="true" aria-labelledby="txn-modal-title">
        <header class="txn-modal__head">
          <h2 id="txn-modal-title" class="txn-modal__title">Transactions</h2>
          <button type="button" class="txn-modal__close" data-close aria-label="Close">×</button>
        </header>
        <p class="txn-modal__note">Purchases on your beginner account. Tap a row for the line items.</p>
        <section class="txn-modal__section">
          <div class="txn-modal__list" data-list aria-live="polite"></div>
        </section>
        <footer class="txn-modal__foot">
          <button type="button" class="txn-modal__btn txn-modal__btn--primary" data-close>Done</button>
        </footer>
      </div>
    `;
    document.body.appendChild(modal);
    document.documentElement.classList.add("txn-modal-open");

    modal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", escClose);

    loadAndRender();
  }

  async function loadAndRender() {
    if (!modal) return;
    const t = authToken();
    if (!t) {
      loadState = "unauth";
      renderList();
      return;
    }
    loadState = "loading";
    renderList();
    try {
      const res = await fetch("/api/transactions", {
        headers: { Accept: "application/json", Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.error || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
      }
      const body = await res.json();
      serverTxns = Array.isArray(body.transactions) ? body.transactions : [];
      loadState = "ok";
      renderList();
    } catch (err) {
      if (err && err.status === 401) {
        loadState = "unauth";
      } else {
        loadState = "error";
        loadError = (err && err.message) || "unknown error";
      }
      renderList();
    }
  }

  function renderList() {
    if (!modal) return;
    const list = modal.querySelector("[data-list]");
    list.innerHTML = "";

    if (loadState === "loading") {
      const el = document.createElement("div");
      el.className = "txn-modal__empty";
      el.textContent = "Loading…";
      list.appendChild(el);
      return;
    }
    if (loadState === "unauth") {
      const el = document.createElement("div");
      el.className = "txn-modal__empty";
      el.textContent = "Sign in to view your transactions.";
      list.appendChild(el);
      return;
    }
    if (loadState === "error") {
      const el = document.createElement("div");
      el.className = "txn-modal__empty";
      el.dataset.kind = "err";
      el.textContent = `Couldn't load transactions: ${loadError}`;
      list.appendChild(el);
      return;
    }
    if (serverTxns.length === 0) {
      const el = document.createElement("div");
      el.className = "txn-modal__empty";
      el.textContent = "No transactions yet.";
      list.appendChild(el);
      return;
    }

    serverTxns.forEach((t) => {
      const entry = document.createElement("div");
      entry.className = "txn-modal__entry";
      if (expanded.has(t.id)) entry.classList.add("txn-modal__entry--open");

      const row = document.createElement("div");
      row.className = "txn-modal__item";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-expanded", expanded.has(t.id) ? "true" : "false");
      row.innerHTML =
        `<span class="txn-modal__item-date">${escapeHtml(formatShortDate(t.createdAt))}</span>` +
        `<span class="txn-modal__item-merchant">${escapeHtml(t.merchantName || "—")}</span>` +
        `<span class="txn-modal__item-amount">${formatAmount(-Math.abs(Number(t.totalAmount) || 0))}</span>` +
        `<span class="txn-modal__item-category">${escapeHtml(prettyStatus(t.status))}</span>` +
        `<svg class="txn-modal__item-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">` +
          `<path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
        `</svg>`;
      const toggle = () => {
        if (expanded.has(t.id)) expanded.delete(t.id);
        else expanded.add(t.id);
        renderList();
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
      entry.appendChild(row);

      if (expanded.has(t.id)) {
        const detail = document.createElement("div");
        detail.className = "txn-modal__detail";
        const items = Array.isArray(t.items) ? t.items : [];
        const itemsHtml = items
          .map((it) => {
            const qty = Number(it.quantity) || 1;
            const lineTotal = (Number(it.price) || 0) * qty;
            return (
              `<li class="txn-modal__detail-item">` +
                `<span class="txn-modal__detail-item-desc">${escapeHtml(it.description || "—")}</span>` +
                `<span class="txn-modal__detail-item-qty">${qty > 1 ? `× ${escapeHtml(String(qty))}` : ""}</span>` +
                `<span class="txn-modal__detail-item-price">${formatAmount(-Math.abs(lineTotal))}</span>` +
              `</li>`
            );
          })
          .join("");
        detail.innerHTML =
          `<dl class="txn-modal__detail-grid">` +
            `<dt>Date</dt><dd>${escapeHtml(formatLongDate(t.createdAt))}</dd>` +
            `<dt>Merchant</dt><dd>${escapeHtml(t.merchantName || "—")}</dd>` +
            `<dt>Status</dt><dd><span class="txn-modal__detail-tag">${escapeHtml(prettyStatus(t.status))}</span></dd>` +
            (t.paymentCompletedAt
              ? `<dt>Paid</dt><dd>${escapeHtml(formatLongDate(t.paymentCompletedAt))}</dd>`
              : "") +
            `<dt>Total</dt><dd class="txn-modal__detail-amount">${formatAmount(-Math.abs(Number(t.totalAmount) || 0))}</dd>` +
          `</dl>` +
          (itemsHtml ? `<ul class="txn-modal__detail-items">${itemsHtml}</ul>` : "");
        entry.appendChild(detail);
      }

      list.appendChild(entry);
    });
  }

  function closeModal() {
    if (!modal) return;
    modal.remove();
    modal = null;
    document.documentElement.classList.remove("txn-modal-open");
    document.removeEventListener("keydown", escClose);
  }

  function escClose(e) {
    if (e.key === "Escape") closeModal();
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function formatAmount(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "";
    const sign = v < 0 ? "−" : "";
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  }
  function formatShortDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || "");
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function formatLongDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || "");
    try {
      return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    } catch {
      return String(iso);
    }
  }
  function prettyStatus(s) {
    if (!s) return "—";
    return String(s).toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ── Sidebar entry ───────────────────────────────────────────────────
  function wireNav() {
    const btn = document.getElementById("nav-transactions");
    if (!btn) return;
    btn.addEventListener("click", openModal);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireNav);
  } else {
    wireNav();
  }

})();
