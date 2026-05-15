/* tinker — receipts module
 *
 * Wires the sidebar's "Receipts" button to a modal listing every
 * receipt in the production catalogue. The list comes from
 * /api/receipts (Stytch-gated); clicking a row opens the rendered
 * receipt page (/api/receipts/:id) in a new tab.
 *
 * Same UX shell as transactions.js — overlay + backdrop, Esc to
 * close, body scroll locked while open — to keep the modal patterns
 * consistent across the app.
 */

(() => {
  "use strict";

  const TOKEN_KEY = "tinker_jwt";

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function formatMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "";
    return `$${v.toFixed(2)}`;
  }

  function paddedId(id) {
    return String(id == null ? "" : id).padStart(7, "0");
  }

  async function fetchReceipts() {
    const t = token();
    const headers = { Accept: "application/json" };
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch("/api/receipts", { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    return Array.isArray(body.receipts) ? body.receipts : [];
  }

  let modal = null;

  function openModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "txn-modal receipts-modal";
    modal.innerHTML = `
      <div class="txn-modal__backdrop" data-close></div>
      <div class="txn-modal__card" role="dialog" aria-modal="true" aria-labelledby="receipts-modal-title">
        <header class="txn-modal__head">
          <h2 id="receipts-modal-title" class="txn-modal__title">Receipts</h2>
          <button type="button" class="txn-modal__close" data-close aria-label="Close">×</button>
        </header>
        <p class="txn-modal__note">Receipts from the production ledger. Tap any row to open the full receipt in a new tab.</p>
        <section class="txn-modal__section">
          <div class="receipts-modal__list" data-list aria-live="polite">
            <div class="txn-modal__empty">Loading…</div>
          </div>
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
    const list = modal.querySelector("[data-list]");
    try {
      const receipts = await fetchReceipts();
      renderList(list, receipts);
    } catch (err) {
      list.innerHTML = "";
      const msg = document.createElement("div");
      msg.className = "txn-modal__empty";
      msg.dataset.kind = "err";
      msg.textContent =
        err && err.status === 401
          ? "Sign in to view receipts."
          : `Couldn't load receipts: ${err && err.message ? err.message : "unknown error"}`;
      list.appendChild(msg);
    }
  }

  function renderList(list, receipts) {
    list.innerHTML = "";
    if (!receipts.length) {
      const empty = document.createElement("div");
      empty.className = "txn-modal__empty";
      empty.textContent = "No receipts yet.";
      list.appendChild(empty);
      return;
    }
    receipts.forEach((r) => {
      const row = document.createElement("a");
      row.className = "receipts-modal__item";
      row.href = `/api/receipts/${encodeURIComponent(r.id)}`;
      row.target = "_blank";
      row.rel = "noopener";
      row.innerHTML =
        `<span class="receipts-modal__item-num">№ ${escapeHtml(paddedId(r.id))}</span>` +
        `<span class="receipts-modal__item-date">${escapeHtml(r.date || "")}</span>` +
        `<span class="receipts-modal__item-parties">` +
          `<span class="receipts-modal__item-maker">${escapeHtml(r.maker || "")}</span>` +
          `<span class="receipts-modal__item-customer">→ ${escapeHtml(r.customer || "")}</span>` +
        `</span>` +
        `<span class="receipts-modal__item-total">${escapeHtml(formatMoney(r.total))}</span>`;
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

  function wire() {
    const btn = document.getElementById("nav-receipts");
    if (!btn) return;
    btn.addEventListener("click", openModal);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  window.tinkerReceipts = { open: openModal };
})();
