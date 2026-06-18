/* wallet.js — the tinker wallet: receive and hold beginner backer cards.
 *
 * When someone backs beginner, the reveal on /investor-relations mints them
 * a "beginner card" in their own name and offers to deposit it here. beginner
 * is a different origin, so — exactly like the Back-me pass (#claim_pass=) and
 * the cross-app session handoffs (#ts=) — the card rides across in the URL
 * fragment as `#deposit_card=<base64url(json)>`. A fragment is never sent to a
 * server, so the card stays on the device.
 *
 * This file does three things, all best-effort and same-origin:
 *
 *  1. importDepositFromHash() — on load, if the launch URL carries a
 *     `deposit_card`, decode it, store it in localStorage["tinker.wallet.v1"]
 *     (deduped by card number, so a re-deposit updates rather than piles up),
 *     and strip the param so a refresh doesn't replay it. pwa-session.js
 *     leaves `deposit_card` in the hash untouched — it only handles session
 *     params — so by the time this runs the card is still there to read.
 *
 *  2. open()/close() — a self-contained overlay (its own injected styles, no
 *     dependency on styles.css) that shows the cards in the wallet, rendered
 *     with the same forest beginner-card face. Auto-opens once right after a
 *     fresh deposit so the card visibly lands; reachable any time after via
 *     window.tinkerWallet.open().
 *
 *  3. window.tinkerWallet = { list, open, close } — the read API, so the
 *     deposit persists somewhere a permanent wallet entry (a future sidebar /
 *     profile-menu row) can hang off without re-deriving any of this.
 *
 * No-op when localStorage is unavailable. Worst case in any failure mode is a
 * card that simply isn't stored — nothing in the app breaks.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var WALLET_KEY = "tinker.wallet.v1";
  var DEPOSIT_PARAM = "deposit_card";

  // ── Storage ──────────────────────────────────────────────────────────
  function load() {
    try {
      var raw = localStorage.getItem(WALLET_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function save(list) {
    try { localStorage.setItem(WALLET_KEY, JSON.stringify(list)); }
    catch (e) { /* private mode / quota — the card just won't persist */ }
  }

  // Append, or update the existing card with the same number. Newest deposit
  // wins on conflict; ordered oldest-first so the wallet reads as a history.
  function addCard(card) {
    var list = load();
    var entry = {
      v: 1,
      name: card.name,
      amount: card.amount,
      tier: card.tier,
      no: card.no,
      issued: card.issued,
      depositedAt: Date.now(),
    };
    var i = -1;
    for (var k = 0; k < list.length; k++) {
      if (list[k] && list[k].no === card.no) { i = k; break; }
    }
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    save(list);
    return entry;
  }

  // ── Decode the deposited card ────────────────────────────────────────
  // base64url(JSON), the shape beginner's investor-onboarding.js encodes.
  // Everything is coerced to a bounded string — the payload is untrusted
  // (anyone can craft a #deposit_card= URL), so it's only ever rendered as
  // text, never as markup or anything executable.
  function decodeCard(s) {
    try {
      var b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var json = decodeURIComponent(escape(atob(b64)));
      var obj = JSON.parse(json);
      if (!obj || typeof obj !== "object") return null;
      var str = function (v, n) { return String(v == null ? "" : v).slice(0, n); };
      var card = {
        v: 1,
        name: str(obj.name, 80),
        amount: str(obj.amount, 40),
        tier: str(obj.tier, 40) || "Backer",
        no: str(obj.no, 40),
        issued: str(obj.issued, 40),
      };
      return card.no ? card : null;
    } catch (e) {
      return null;
    }
  }

  var freshNo = null;

  function importDepositFromHash() {
    var hash;
    try { hash = location.hash || ""; } catch (e) { return; }
    if (hash.length < 2) return;

    var params;
    try { params = new URLSearchParams(hash.slice(1)); } catch (e) { return; }

    var raw = params.get(DEPOSIT_PARAM);
    if (!raw) return;

    var card = decodeCard(raw);
    if (card) {
      addCard(card);
      freshNo = card.no;
    }

    // Strip it so a refresh doesn't re-deposit / re-open the wallet.
    params.delete(DEPOSIT_PARAM);
    var rest = params.toString();
    var cleanHash = rest ? "#" + rest : "";
    try {
      history.replaceState(null, "", location.pathname + location.search + cleanHash);
    } catch (e) { /* ignore */ }
  }

  // ── Overlay UI ───────────────────────────────────────────────────────
  var STYLE_ID = "tw-wallet-style";
  var CSS = [
    ".tw-overlay{position:fixed;inset:0;z-index:2147483600;display:flex;",
    "align-items:center;justify-content:center;padding:24px;}",
    ".tw-overlay__backdrop{position:absolute;inset:0;background:rgba(20,24,21,0.55);",
    "backdrop-filter:blur(2px);}",
    ".tw-panel{position:relative;width:100%;max-width:460px;max-height:90vh;overflow:auto;",
    "background:#fffdf7;border:1px solid #ede8e0;border-radius:22px;padding:24px;",
    "box-shadow:0 24px 60px rgba(35,71,49,0.30);",
    "font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,sans-serif;}",
    ".tw-panel__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 0 4px;}",
    ".tw-panel__title{margin:0;font-family:Fraunces,Georgia,serif;font-weight:700;",
    "font-size:20px;letter-spacing:-0.01em;color:#2d2a26;}",
    ".tw-panel__sub{margin:2px 0 18px;font-size:13px;color:#6f6a65;}",
    ".tw-close{flex:none;width:32px;height:32px;border:0;border-radius:50%;cursor:pointer;",
    "background:#f3eee5;color:#4a4742;font-size:18px;line-height:1;}",
    ".tw-close:hover{background:#ede8e0;}",
    ".tw-cards{display:flex;flex-direction:column;gap:14px;}",
    ".tw-card{position:relative;overflow:hidden;padding:20px 22px 18px;border-radius:18px;",
    "color:#f3f6f1;background:radial-gradient(130% 150% at 0% 0%,#3a6b4b 0%,#2d5a3d 46%,#234731 100%);",
    "border:1px solid rgba(255,255,255,0.14);box-shadow:0 14px 32px rgba(35,71,49,0.26),",
    "inset 0 1px 0 rgba(255,255,255,0.12);aspect-ratio:1.586/1;display:flex;flex-direction:column;",
    "justify-content:space-between;}",
    ".tw-card__top{display:flex;align-items:center;justify-content:space-between;gap:12px;}",
    ".tw-card__brand{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:16px;letter-spacing:-0.01em;}",
    ".tw-card__kind{font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;",
    "color:rgba(243,246,241,0.72);}",
    ".tw-card__no{margin:0;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;",
    "font-size:clamp(14px,4.4vw,19px);letter-spacing:0.12em;}",
    ".tw-card__foot{display:flex;align-items:flex-end;gap:16px;}",
    ".tw-field{display:flex;flex-direction:column;gap:3px;min-width:0;}",
    ".tw-field--amt{margin-left:auto;text-align:right;}",
    ".tw-label{font-size:9px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;",
    "color:rgba(243,246,241,0.62);}",
    ".tw-value{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:14px;letter-spacing:-0.01em;",
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".tw-field--amt .tw-value{color:#cdeacb;}",
    ".tw-empty{margin:8px 0 0;font-size:14px;color:#6f6a65;}",
  ].join("");

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  var SEED_MARK =
    '<svg viewBox="0 0 180 180" fill="none" width="22" height="22" role="img" aria-label="beginner seed mark" style="vertical-align:-4px;margin-right:7px">' +
    '<rect width="180" height="180" rx="40" fill="#2d5a3d"></rect>' +
    '<path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"></path>' +
    '<path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"></path>' +
    '<path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"></path>' +
    '<path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"></path></svg>';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Build one card face. All card data is set via textContent, never innerHTML.
  function renderCard(card) {
    var c = el("div", "tw-card");

    var top = el("div", "tw-card__top");
    var brand = el("span", "tw-card__brand");
    brand.innerHTML = SEED_MARK; // static, trusted markup
    brand.appendChild(document.createTextNode("beginner"));
    top.appendChild(brand);
    top.appendChild(el("span", "tw-card__kind", "Backer Card"));
    c.appendChild(top);

    c.appendChild(el("p", "tw-card__no", card.no || ""));

    var foot = el("div", "tw-card__foot");
    var holder = el("span", "tw-field");
    holder.appendChild(el("span", "tw-label", "Cardholder"));
    holder.appendChild(el("span", "tw-value", card.name || "Backer"));
    foot.appendChild(holder);

    if (card.issued) {
      var iss = el("span", "tw-field");
      iss.appendChild(el("span", "tw-label", "Issued"));
      iss.appendChild(el("span", "tw-value", card.issued));
      foot.appendChild(iss);
    }
    if (card.amount) {
      var amt = el("span", "tw-field tw-field--amt");
      amt.appendChild(el("span", "tw-label", "Backing"));
      amt.appendChild(el("span", "tw-value", card.amount));
      foot.appendChild(amt);
    }
    c.appendChild(foot);
    return c;
  }

  var overlay = null;

  function close() {
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }

  // justDeposited: when true, the header confirms a fresh deposit.
  function open(justDeposited) {
    ensureStyle();
    close();

    var cards = load();

    overlay = el("div", "tw-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Your wallet");

    var backdrop = el("div", "tw-overlay__backdrop");
    backdrop.addEventListener("click", close);
    overlay.appendChild(backdrop);

    var panel = el("div", "tw-panel");

    var head = el("div", "tw-panel__head");
    head.appendChild(el("h2", "tw-panel__title", justDeposited ? "Card deposited" : "Your wallet"));
    var closeBtn = el("button", "tw-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", close);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    panel.appendChild(el(
      "p", "tw-panel__sub",
      justDeposited
        ? "Your beginner card is in your wallet."
        : (cards.length === 1 ? "1 beginner card." : cards.length + " beginner cards.")
    ));

    if (!cards.length) {
      panel.appendChild(el("p", "tw-empty", "No cards yet. Back beginner to mint one."));
    } else {
      var stack = el("div", "tw-cards");
      // Newest first.
      for (var i = cards.length - 1; i >= 0; i--) stack.appendChild(renderCard(cards[i]));
      panel.appendChild(stack);
    }

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);
    setTimeout(function () { try { closeBtn.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  // ── Wiring ───────────────────────────────────────────────────────────
  importDepositFromHash();

  if (freshNo) {
    var show = function () { open(true); };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", show, { once: true });
    } else {
      setTimeout(show, 0);
    }
  }

  window.tinkerWallet = {
    list: load,
    open: function () { open(false); },
    close: close,
  };
})();
