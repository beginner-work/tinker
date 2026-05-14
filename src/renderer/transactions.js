/* tinker — transactions module (Phase A: localStorage only)
 *
 * Exposes a global "Connect bank account" button in the top-right of
 * the app. Tap it → modal that lets the founder paste JSON / CSV
 * transactions or add them by hand. Stored in
 * localStorage["tinker.transactions.v1"]. writing.js reads them via
 * window.tinkerTransactions.list() and threads them into Claude's
 * context so the interview can reference real spending while the
 * founder reflects.
 *
 * Phase B (separate PR) will replace the manual-entry path with a
 * Plaid Link flow + server-side storage. The list() shape stays the
 * same so writing.js doesn't need to change.
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

  function openModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "txn-modal";
    modal.innerHTML = `
      <div class="txn-modal__backdrop" data-close></div>
      <div class="txn-modal__card" role="dialog" aria-modal="true" aria-labelledby="txn-modal-title">
        <header class="txn-modal__head">
          <h2 id="txn-modal-title" class="txn-modal__title">Recent activity</h2>
          <button type="button" class="txn-modal__close" data-close aria-label="Close">×</button>
        </header>
        <p class="txn-modal__note">Not for taxes or bookkeeping. Transactions live here so that when you're reflecting on a moment, your recent activity can be in the room — to help you see how the way you spend, eat, move, and meet connects to how you conduct your business and your life. Paste, type, or import. Stored on this device.</p>

        <section class="txn-modal__section">
          <label class="txn-modal__label" for="txn-paste">Paste</label>
          <textarea id="txn-paste" class="txn-modal__paste" rows="4" placeholder='[{"date":"2026-05-08","merchant":"Whole Foods","amount":-45.23,"category":"Groceries"}]
or
date,merchant,amount,category
2026-05-08,Whole Foods,-45.23,Groceries'></textarea>
          <div class="txn-modal__row">
            <button type="button" class="txn-modal__btn" data-action="import">Import</button>
            <span class="txn-modal__msg" data-msg></span>
          </div>
        </section>

        <section class="txn-modal__section">
          <label class="txn-modal__label">Add by hand</label>
          <div class="txn-modal__manual">
            <input type="date" class="txn-modal__input" data-field="date" />
            <input type="text" class="txn-modal__input" data-field="merchant" placeholder="Merchant" />
            <input type="number" class="txn-modal__input txn-modal__input--num" data-field="amount" placeholder="Amount" step="0.01" />
            <input type="text" class="txn-modal__input" data-field="category" placeholder="Category (optional)" />
            <button type="button" class="txn-modal__btn" data-action="add">Add</button>
          </div>
        </section>

        <section class="txn-modal__section">
          <label class="txn-modal__label">Saved <span class="txn-modal__count" data-count></span></label>
          <div class="txn-modal__list" data-list></div>
        </section>

        <footer class="txn-modal__foot">
          <button type="button" class="txn-modal__btn txn-modal__btn--primary" data-close>Done</button>
        </footer>
      </div>
    `;
    document.body.appendChild(modal);
    document.documentElement.classList.add("txn-modal-open");

    // Wire close
    modal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", escClose);

    // Wire import
    const paste = modal.querySelector("#txn-paste");
    const msgEl = modal.querySelector("[data-msg]");
    modal.querySelector('[data-action="import"]').addEventListener("click", () => {
      const r = parseInput(paste.value);
      if (!r.ok) {
        msgEl.textContent = r.error;
        msgEl.dataset.kind = "err";
        return;
      }
      txns = r.rows.concat(txns);
      save(txns);
      notify();
      paste.value = "";
      msgEl.textContent = `Imported ${r.rows.length} transaction${r.rows.length === 1 ? "" : "s"}.`;
      msgEl.dataset.kind = "ok";
      renderList();
    });

    // Wire add-by-hand
    const fields = {
      date: modal.querySelector('[data-field="date"]'),
      merchant: modal.querySelector('[data-field="merchant"]'),
      amount: modal.querySelector('[data-field="amount"]'),
      category: modal.querySelector('[data-field="category"]'),
    };
    fields.date.value = new Date().toISOString().slice(0, 10);
    modal.querySelector('[data-action="add"]').addEventListener("click", () => {
      const row = normalise({
        date: fields.date.value,
        merchant: fields.merchant.value,
        amount: fields.amount.value,
        category: fields.category.value,
      });
      if (!row) {
        msgEl.textContent = "Need at least a merchant and a number for the amount.";
        msgEl.dataset.kind = "err";
        return;
      }
      txns = [row].concat(txns);
      save(txns);
      notify();
      fields.merchant.value = "";
      fields.amount.value = "";
      fields.category.value = "";
      msgEl.textContent = "Added.";
      msgEl.dataset.kind = "ok";
      renderList();
      fields.merchant.focus();
    });

    renderList();
  }

  function renderList() {
    if (!modal) return;
    const list = modal.querySelector("[data-list]");
    const count = modal.querySelector("[data-count]");
    count.textContent = txns.length ? `(${txns.length})` : "(none yet)";
    list.innerHTML = "";
    if (txns.length === 0) {
      const empty = document.createElement("div");
      empty.className = "txn-modal__empty";
      empty.textContent = "Nothing saved yet.";
      list.appendChild(empty);
      return;
    }
    txns.forEach((t) => {
      const row = document.createElement("div");
      row.className = "txn-modal__item";
      row.innerHTML =
        `<span class="txn-modal__item-date">${escapeHtml(t.date)}</span>` +
        `<span class="txn-modal__item-merchant">${escapeHtml(t.merchant)}</span>` +
        `<span class="txn-modal__item-amount">${formatAmount(t.amount)}</span>` +
        `<span class="txn-modal__item-category">${escapeHtml(t.category || "—")}</span>` +
        `<button type="button" class="txn-modal__item-del" aria-label="Delete">×</button>`;
      row.querySelector(".txn-modal__item-del").addEventListener("click", () => {
        txns = txns.filter((x) => x.id !== t.id);
        save(txns);
      notify();
        renderList();
      });
      list.appendChild(row);
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
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function formatAmount(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "";
    const sign = v < 0 ? "−" : "";
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  }

})();
