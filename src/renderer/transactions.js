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
 *
 * Beginner card deposits: a backer who fills out beginner's "You are an
 * investor" flow mints a beginner card and taps "Deposit into your tinker
 * wallet". beginner hands the card over as `#deposit=<base64url-json>` — the
 * same on-device-only fragment channel as #ts / #claim_pass (a fragment is
 * never sent to a server). redeemBeginnerDeposit() reads it on load and lands
 * it in the wallet as a money-in deposit (a positive amount), so the backing
 * shows up in the Money market funds surface as a Deposit toward the founder's
 * Balance. No real money moves; this is the same local transaction store.
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
    // Add a money-in deposit to the wallet (positive amount). Used by the
    // beginner-card hand-off; safe to call directly with a normalised row.
    deposit(input) {
      const row = (input && input._beginner) ? input : normalise(input);
      if (!row) return null;
      row.amount = Math.abs(Number(row.amount) || 0);
      txns = [row].concat(txns);
      save(txns);
      notify();
      return row;
    },
    // Pure: decode a beginner `#deposit=` payload into a deposit row, or null
    // if it isn't a valid beginner backing. Exposed for tests.
    parseBeginnerDeposit(payload) { return parseBeginnerDeposit(payload); },
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

  // ── Beginner card deposits ───────────────────────────────────────────
  // base64url (no padding) decode → UTF-8 string. atob in the browser; Buffer
  // in the node test sandbox.
  function b64urlDecode(s) {
    let t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    let bin;
    if (typeof atob === "function") bin = atob(t);
    else if (typeof Buffer !== "undefined") bin = Buffer.from(t, "base64").toString("binary");
    else return "";
    try { return decodeURIComponent(escape(bin)); } catch { return bin; }
  }

  // Decode a beginner `#deposit=` payload into a normalised deposit row, or
  // null if it isn't a valid beginner backing. A backing is money INTO the
  // writing-investment fund, so it lands as a positive (money-in) deposit.
  function parseBeginnerDeposit(payload) {
    let json;
    try { json = JSON.parse(b64urlDecode(payload)); }
    catch { return null; }
    if (!json || typeof json !== "object") return null;
    if (json.src !== "beginner") return null;
    const amount = Number(json.amount);
    if (!Number.isFinite(amount)) return null;
    const merchant = String(json.label || "Backed beginner").trim() || "Backed beginner";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(json.date || ""))
      ? json.date
      : new Date().toISOString().slice(0, 10);
    return { id: nextId(), date, merchant, amount: Math.abs(amount), category: "beginner", _beginner: true };
  }

  // Read `#deposit=` on load, land it in the wallet, strip it so a refresh
  // can't re-deposit, then confirm with a small toast.
  function redeemBeginnerDeposit() {
    if (typeof location === "undefined" || typeof document === "undefined") return;
    let payload = "";
    try {
      payload = new URLSearchParams(String(location.hash || "").replace(/^#/, "")).get("deposit") || "";
    } catch { payload = ""; }
    if (!payload) return;

    const row = parseBeginnerDeposit(payload);

    // Strip the param from the fragment regardless of validity.
    try {
      const params = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
      params.delete("deposit");
      const rest = params.toString();
      if (typeof history !== "undefined" && history.replaceState) {
        history.replaceState(null, "", location.pathname + location.search + (rest ? "#" + rest : ""));
      }
    } catch { /* ignore */ }

    if (!row) return;
    txns = [row].concat(txns);
    save(txns);
    notify();
    showDepositToast(row);
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

  // ── Deposit confirmation toast ───────────────────────────────────────
  // A quiet, self-dismissing confirmation that a beginner card just landed
  // in the wallet. Styles are injected once (CSP allows inline <style>).
  function injectToastStyles() {
    if (document.getElementById("beginner-deposit-toast-styles")) return;
    const css = [
      ".beginner-deposit-toast{position:fixed;left:50%;bottom:24px;z-index:2147483600;",
      "transform:translateX(-50%) translateY(12px);opacity:0;",
      "display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);",
      "padding:12px 16px;border-radius:14px;background:#2d5a3d;color:#f5f3ef;",
      "font-family:'Instrument Sans','Inter',system-ui,-apple-system,sans-serif;",
      "font-size:14px;font-weight:600;line-height:1.4;",
      "box-shadow:0 12px 32px rgba(31,63,43,.34),0 4px 12px rgba(31,63,43,.22);",
      "transition:transform .28s cubic-bezier(.2,.7,.2,1),opacity .28s ease;}",
      ".beginner-deposit-toast.is-in{transform:translateX(-50%) translateY(0);opacity:1;}",
      ".beginner-deposit-toast__mark{width:20px;height:20px;flex:none;}",
      "@media (prefers-reduced-motion:reduce){.beginner-deposit-toast{transition:opacity .2s ease;transform:translateX(-50%);}",
      ".beginner-deposit-toast.is-in{transform:translateX(-50%);}}",
    ].join("");
    const style = document.createElement("style");
    style.id = "beginner-deposit-toast-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showDepositToast(row) {
    if (typeof document === "undefined" || !document.body) return;
    injectToastStyles();
    const toast = document.createElement("div");
    toast.className = "beginner-deposit-toast";
    toast.setAttribute("role", "status");
    const amt = Number(row && row.amount);
    const figure = Number.isFinite(amt) && amt > 0 ? " " + formatAmount(amt) : "";
    toast.innerHTML =
      '<svg class="beginner-deposit-toast__mark" viewBox="0 0 180 180" fill="none" aria-hidden="true">' +
      '<rect width="180" height="180" rx="40" fill="#f5f3ef" opacity="0.16"></rect>' +
      '<path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="12" stroke-linecap="round"></path>' +
      '<path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="12" fill="none" stroke-linejoin="round"></path>' +
      "</svg>" +
      "<span>Deposited" + escapeHtml(figure) + " from beginner into your wallet</span>";
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("is-in")));
    setTimeout(() => {
      toast.classList.remove("is-in");
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 320);
    }, 4200);
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

  // Redeem a beginner card hand-off, if one rode in on the fragment.
  redeemBeginnerDeposit();

})();
