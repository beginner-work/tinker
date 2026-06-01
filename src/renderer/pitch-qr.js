/* tinker — pitch-qr (v0.1)
 *
 * The screen a founder lands on the moment they unlock Pitch (pre-seed,
 * $9/month). Stripe checkout lives over on beginner; on success it sends
 * the founder back to tinker with ?unlocked=1, and renderer.js opens this
 * surface. It is also where the sidebar "Pitch" button goes once the
 * founder is unlocked.
 *
 * Two things, the way the founder was promised on the /unlock page:
 *
 *   1. The QR code you pull out of your pocket. A REAL, scannable code
 *      (drawn by lib/qr.js — no image service, CSP-safe) that points at
 *      the founder's shareable "back me" link.
 *   2. A little preview of what folks see when they scan it — the
 *      "back me" card: the pitch up top, the code in the middle, and the
 *      Scan to back line, so the founder knows exactly what they're
 *      handing across the table before they hand it across the table.
 *
 * Plus a Share and a Copy-link control so the founder can send it on
 * without a face-to-face scan.
 *
 * The shareable link: a founder's published pitch on the daily-beginner
 * reader if we have one (stored at publish time under "tinker_back_url"),
 * otherwise the app's own start URL — so the code always scans to
 * *something* of theirs, even before they've published.
 *
 * Entry point: window.tinkerPitchQr.show(). Wired in renderer.js.
 */

(() => {
  "use strict";

  const BACK_URL_KEY = "tinker_back_url";

  const STR = {
    back: "Back",
    title: "Your pitch is ready to pull out of your pocket.",
    lede:
      "Show it to family and friends, they scan, and they back you — even if it's just a dollar.",
    previewLabel: "What they see when they scan",
    cardName: "Your pitch",
    cardTag: "Scan to come along for the build",
    scanLine: "Scan to back · from $1",
    share: "Show someone",
    copy: "Copy link",
    copied: "Copied",
    shareTitle: "Back me on beginner",
    shareText: "Come along for what I'm building — back me, even if it's just a dollar.",
    linkLabel: "Your link",
  };

  let viewEl = null;
  let copiedTimer = null;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // The link the QR encodes. Prefer the founder's published pitch on the
  // daily-beginner reader (saved at publish time); fall back to the app's
  // start URL so the code is always scannable, published or not.
  function backLink() {
    try {
      const stored = window.localStorage.getItem(BACK_URL_KEY);
      if (stored && /^https?:\/\//.test(stored)) return stored;
    } catch { /* ignore */ }
    const origin = window.location && window.location.origin;
    if (origin && /^https?:/.test(origin)) return origin + "/";
    return (window.location && window.location.href) || "";
  }

  // A trimmed, human-readable version of the link for the caption row.
  function prettyLink(url) {
    return String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  function qrSvg(link) {
    if (window.tinkerQR && typeof window.tinkerQR.toSvg === "function") {
      // Quartile ECC keeps the code readable even printed small or shown
      // on a slightly dirty phone screen across the dinner table.
      return window.tinkerQR.toSvg(link, {
        ecc: "Q",
        scale: 5,
        margin: 3,
        dark: "#2d2a26",
        light: "#fffdf7",
      });
    }
    return "";
  }

  function render() {
    if (!viewEl) return;
    const link = backLink();

    viewEl.innerHTML =
      '<div class="pitch-qr__inner">' +
      `<button type="button" class="pitch-qr__back" data-role="back">${escapeHtml(STR.back)}</button>` +
      `<h1 class="pitch-qr__title">${escapeHtml(STR.title)}</h1>` +
      `<p class="pitch-qr__lede">${escapeHtml(STR.lede)}</p>` +

      // The preview card — what a backer sees when they scan.
      `<p class="pitch-qr__preview-label">${escapeHtml(STR.previewLabel)}</p>` +
      '<div class="pitch-qr__card">' +
        `<p class="pitch-qr__card-name">${escapeHtml(STR.cardName)}</p>` +
        `<p class="pitch-qr__card-tag">${escapeHtml(STR.cardTag)}</p>` +
        `<div class="pitch-qr__code" data-role="code">${qrSvg(link)}</div>` +
        `<p class="pitch-qr__scan">${escapeHtml(STR.scanLine)}</p>` +
      "</div>" +

      // The link itself + the two ways to send it on.
      `<p class="pitch-qr__link"><span class="pitch-qr__link-label">${escapeHtml(STR.linkLabel)}:</span> ` +
        `<span class="pitch-qr__link-value" data-role="link">${escapeHtml(prettyLink(link))}</span></p>` +
      '<div class="pitch-qr__actions">' +
        `<button type="button" class="pitch-qr__btn pitch-qr__btn--primary" data-role="share">${escapeHtml(STR.share)}</button>` +
        `<button type="button" class="pitch-qr__btn pitch-qr__btn--ghost" data-role="copy">` +
          `<span data-role="copy-label">${escapeHtml(STR.copy)}</span></button>` +
      "</div>" +
      "</div>";

    wire(link);
  }

  function wire(link) {
    const back = viewEl.querySelector('[data-role="back"]');
    if (back) {
      back.addEventListener("click", () => {
        if (typeof window.tinkerShowPitch === "function") window.tinkerShowPitch();
      });
    }

    const shareBtn = viewEl.querySelector('[data-role="share"]');
    if (shareBtn) {
      shareBtn.addEventListener("click", () => doShare(link));
    }

    const copyBtn = viewEl.querySelector('[data-role="copy"]');
    if (copyBtn) {
      copyBtn.addEventListener("click", () => doCopy(link, copyBtn));
    }
  }

  async function doShare(link) {
    const payload = { title: STR.shareTitle, text: STR.shareText, url: link };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
        // fall through to clipboard
      }
    }
    const copyBtn = viewEl && viewEl.querySelector('[data-role="copy"]');
    doCopy(link, copyBtn);
  }

  async function doCopy(link, btn) {
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
        ok = true;
      }
    } catch { /* ignore */ }
    if (!ok || !btn) return;
    const label = btn.querySelector('[data-role="copy-label"]') || btn;
    const original = STR.copy;
    label.textContent = STR.copied;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { label.textContent = original; }, 1800);
  }

  function show() {
    viewEl = document.getElementById("pitch-qr");
    if (!viewEl) return;
    render();
  }

  window.tinkerPitchQr = { show };
})();
