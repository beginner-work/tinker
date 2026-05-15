/* receipts.js — Account → Receipts view.
 *
 * The sidebar's "Receipts" button (#nav-receipts) lands here. The view
 * lists the founder's saved transactions (window.tinkerTransactions)
 * as receipt rows and offers a button that delegates to the existing
 * transactions modal for adding more. Re-renders on every show and
 * whenever transactions change.
 */

(function () {
  "use strict";

  const navBtn = document.getElementById("nav-receipts");
  const view = document.getElementById("receipts");
  const listEl = document.getElementById("receipts-list");
  const emptyEl = document.getElementById("receipts-empty");
  const addBtn = document.getElementById("receipts-add");

  if (!navBtn || !view || !listEl || !emptyEl || !addBtn) return;

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

  function formatDate(d) {
    const s = String(d || "").trim();
    if (!s) return "";
    const parsed = new Date(s);
    if (Number.isNaN(parsed.getTime())) return s;
    return parsed.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function render() {
    const api = window.tinkerTransactions;
    const txns = (api && typeof api.list === "function") ? api.list() : [];
    listEl.innerHTML = "";
    if (!txns.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    for (const t of txns) {
      const li = document.createElement("li");
      li.className = "receipts__item";
      li.innerHTML =
        `<div class="receipts__item-row">` +
          `<span class="receipts__item-merchant">${escapeHtml(t.merchant || "")}</span>` +
          `<span class="receipts__item-amount">${escapeHtml(formatAmount(t.amount))}</span>` +
        `</div>` +
        `<div class="receipts__item-meta">` +
          `<span class="receipts__item-date">${escapeHtml(formatDate(t.date))}</span>` +
          (t.category ? ` · <span class="receipts__item-category">${escapeHtml(t.category)}</span>` : "") +
        `</div>`;
      listEl.appendChild(li);
    }
  }

  navBtn.addEventListener("click", () => {
    render();
    if (typeof window.tinkerShowReceipts === "function") {
      window.tinkerShowReceipts();
    } else if (view) {
      view.hidden = false;
    }
    // On mobile the sidebar lives inside a drawer; closing it lets
    // the receipts view actually surface after the tap.
    if (window.innerWidth <= 540) {
      delete document.body.dataset.drawerOpen;
      const toggle = document.getElementById("drawer-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }
  });

  addBtn.addEventListener("click", () => {
    const api = window.tinkerTransactions;
    if (api && typeof api.openAddModal === "function") api.openAddModal();
  });

  // Re-render when transactions change so the list reflects edits made
  // from the recent-activity modal while the receipts view is open.
  if (window.tinkerTransactions && typeof window.tinkerTransactions.subscribe === "function") {
    window.tinkerTransactions.subscribe(() => {
      if (!view.hidden) render();
    });
  }
})();
