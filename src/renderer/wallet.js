/* wallet.js — the tinker wallet: receive beginner backer cards, show them.
 *
 * When someone backs beginner, the reveal on /investor-relations mints them a
 * "beginner card" and offers to deposit it here. beginner is a different
 * origin, so — exactly like the Back-me pass (#claim_pass=) and the cross-app
 * session handoffs (#ts=) — the card rides across in the URL fragment as
 * `#deposit_card=<base64url(json)>`. A fragment is never sent to a server, so
 * the card stays on the device.
 *
 * Two halves, both best-effort and on-device:
 *
 *  1. importDepositFromHash() — on load, if the launch URL carries a
 *     `deposit_card`, decode it and store it in localStorage["tinker.wallet.v1"]
 *     (deduped by card number), then strip the param so a refresh doesn't
 *     replay it. tinker is the wallet's source of truth. pwa-session.js only
 *     handles session params and leaves `deposit_card` untouched, so by the
 *     time this runs the card is still in the hash to read.
 *
 *  2. open() — the beginner-card visual lives in the beginner repo, so the
 *     wallet is shown by embedding beginner's /wallet page (the reciprocal of
 *     back-me.js's in-app iframe). We pass the stored cards into the iframe in
 *     the fragment (#cards=<base64url(json array)>); the page is a pure
 *     renderer. The signed-in user always carries their own beginner card, so
 *     we prepend it to whatever's been deposited — the wallet is never empty
 *     for them. The overlay takes the whole screen (a wall of cards, not the
 *     single card-sized Back-me pass). Auto-opens once right after a fresh
 *     deposit. In wrapped runtimes (Capacitor/Electron) we hand off to the
 *     system browser instead of framing, matching back-me/open-beginner.
 *
 * window.tinkerWallet = { list, open, close } exposes the read API; the profile
 * menu's "Wallet" calls open().
 *
 * No-op when localStorage is unavailable — worst case is a card that simply
 * isn't stored; nothing in the app breaks.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var WALLET_KEY = "tinker.wallet.v1";
  var DEPOSIT_PARAM = "deposit_card";
  // Canonical beginner wallet page. www, not the bare apex: the apex
  // 308-redirects to www, and in the PWA the in-app iframe would follow that
  // cross-origin redirect onto a host tinker's frame-src CSP doesn't allow —
  // same rule as back-me.js / open-beginner.js.
  var WALLET_PAGE = "https://www.beginner.work/wallet";

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

  // Append, or update the card with the same number. Ordered oldest-first so
  // the wallet reads as a history; newest deposit wins on conflict.
  function addCard(card) {
    var list = load();
    var entry = {
      name: card.name,
      amount: card.amount,
      tier: card.tier,
      no: card.no,
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

  // ── base64url(JSON) codec ────────────────────────────────────────────
  // Decode a deposited card. The payload is untrusted (anyone can craft a
  // #deposit_card= URL), so every field is coerced to a bounded string.
  function decodeCard(s) {
    try {
      var b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var json = decodeURIComponent(escape(atob(b64)));
      var obj = JSON.parse(json);
      if (!obj || typeof obj !== "object") return null;
      var str = function (v, n) { return String(v == null ? "" : v).slice(0, n); };
      var card = {
        name: str(obj.name, 80),
        amount: str(obj.amount, 40),
        tier: str(obj.tier, 40) || "Backer",
        no: str(obj.no, 40),
      };
      return card.no ? card : null;
    } catch (e) {
      return null;
    }
  }

  // Encode the wallet (display fields only) for the iframe fragment.
  function encodeCards(list) {
    try {
      var slim = list.map(function (c) {
        return { name: c.name, amount: c.amount, tier: c.tier, no: c.no };
      });
      var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(slim))));
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch (e) {
      return "";
    }
  }

  // ── The signed-in user's own beginner card ───────────────────────────
  // A stable, card-shaped id from the holder's name — same hash beginner's
  // investor-onboarding.js mints with, so the format matches the backer cards.
  function cardNumber(seed) {
    var s = String(seed || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var a = String(h % 10000);
    while (a.length < 4) a = "0" + a;
    var b = String(Math.floor(h / 10000) % 10000);
    while (b.length < 4) b = "0" + b;
    return a + " " + b + " " + new Date().getFullYear();
  }

  // The card the current user owns by default — their beginner card, named
  // after their profile (falling back to "Founder", as the profile menu does).
  function ownCard() {
    var name = "";
    try {
      var p = window.tinkerProfile && window.tinkerProfile.current;
      if (p && p.name) name = String(p.name).slice(0, 80);
    } catch (e) { name = ""; }
    return {
      name: name || "Founder",
      amount: "",
      tier: "Beginner",
      no: cardNumber(name || "beginner"),
    };
  }

  function walletUrl() {
    // tinker renders newest-last → top, so appending the own card floats it
    // above the deposited backer cards.
    var enc = encodeCards(load().concat([ownCard()]));
    return enc ? WALLET_PAGE + "#cards=" + enc : WALLET_PAGE;
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

  // ── Runtime handoff ──────────────────────────────────────────────────
  function isWrappedRuntime() {
    if (window.Capacitor) return true;
    if (window.tinker && window.tinker.supportsWebview === true) return true;
    return false;
  }

  function openExternal(u) {
    if (window.tinker && typeof window.tinker.openExternal === "function") {
      window.tinker.openExternal(u);
    } else {
      window.open(u, "_blank", "noopener,noreferrer");
    }
  }

  // ── In-app iframe overlay (reuses the Back-me overlay chrome) ─────────
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

  function openOverlay(url) {
    close();
    overlay = document.createElement("div");
    // Reuse the Back-me overlay chrome, but the --wallet modifier lets the
    // panel fill the screen — the wallet is a wall of cards, not one pass.
    overlay.className = "backme-overlay backme-overlay--wallet";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Your wallet");

    var backdrop = document.createElement("div");
    backdrop.className = "backme-overlay__backdrop";
    backdrop.addEventListener("click", close);
    overlay.appendChild(backdrop);

    var panel = document.createElement("div");
    panel.className = "backme-overlay__panel";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "backme-overlay__close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×"; // ×
    closeBtn.addEventListener("click", close);
    panel.appendChild(closeBtn);

    var frame = document.createElement("iframe");
    frame.className = "backme-overlay__frame";
    frame.setAttribute("title", "Your wallet");
    // The cards ride in the fragment (never sent); keep the Referer clean too.
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.src = url;
    panel.appendChild(frame);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);
    setTimeout(function () { try { closeBtn.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  function open() {
    var url = walletUrl();
    if (isWrappedRuntime()) openExternal(url);
    else openOverlay(url);
  }

  // ── Wiring ───────────────────────────────────────────────────────────
  importDepositFromHash();

  if (freshNo) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", open, { once: true });
    } else {
      setTimeout(open, 0);
    }
  }

  window.tinkerWallet = {
    list: load,
    open: open,
    close: close,
  };
})();
