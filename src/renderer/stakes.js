/* stakes.js — founder coins: stake your balance against other founders.
 *
 * Every founder has a coin (see api/_lib/stakes.js); this panel is the
 * member-facing side. It shows the signed-in founder's own coin (symbol,
 * total backed, backer count), their staking balance, their active
 * stakes with a release control, and — when they're opted in to the
 * founders surface — the adjacent founders from /api/feed/adjacent as
 * the people they can stake on. Phase A is an internal practice ledger
 * denominated in USDC cents; the panel says so plainly. Phase B swaps
 * the settlement layer for real USDC on-chain without changing this UI
 * (docs/crypto-staking.md).
 *
 * Reuses the backme-overlay shell classes for the modal; the inner
 * .stakes-* layout lives in profile.css. Opened from the profile menu
 * ("Founder coins"), wired in profile.js like the Wallet entry.
 *
 * window.tinkerStakes = { open, close }.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";

  var STR = {
    title: "Founder coins",
    practiceNote:
      "This is a practice balance — 100.00 USDC of play money so you can back founders for real before real money arrives.",
    yourCoin: "Your coin",
    balanceLabel: "Your staking balance",
    stakesHeading: "Your stakes",
    noStakes: "You haven't staked on anyone yet.",
    backHeading: "Founders you can back",
    notDiscoverable:
      "Share a pitch on the founders surface first — the founders adjacent to you are the ones you can back.",
    loadFailed: "Couldn't load your staking ledger. Try again in a moment.",
    stakeButton: "Stake",
    releaseButton: "Release",
    backers: "backers",
    backer: "backer",
    backed: "backed",
    amountPlaceholder: "5.00",
  };

  var overlay = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }

  function authedFetch(url, opts) {
    var t = token();
    opts = opts || {};
    opts.headers = Object.assign(
      { Authorization: "Bearer " + t },
      opts.headers || {},
    );
    return fetch(url, opts);
  }

  // Cents → "12.34 USDC". The ledger is integer cents end to end; the
  // panel is the only place amounts become decimal strings.
  function fmt(cents) {
    var n = Number(cents) || 0;
    return (n / 100).toFixed(2) + " USDC";
  }

  // "5.00" (dollars-style input) → 500 cents, or null when unparseable.
  function parseAmount(raw) {
    var s = String(raw || "").trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    var cents = Math.round(parseFloat(s) * 100);
    return cents > 0 ? cents : null;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ── Server I/O ──────────────────────────────────────────────────────

  function loadWallet() {
    return authedFetch("/api/stakes/wallet").then(function (r) {
      if (!r.ok) throw new Error("wallet " + r.status);
      return r.json();
    });
  }

  function loadCoin(founderId) {
    return authedFetch(
      "/api/stakes/coin?founder=" + encodeURIComponent(founderId),
    ).then(function (r) {
      if (!r.ok) throw new Error("coin " + r.status);
      return r.json();
    });
  }

  // Adjacent founders are the "who can I back" list. A 400 means the
  // member isn't opted in / has no shared pitch — that's a normal state,
  // not an error; the panel shows the opt-in hint instead.
  function loadBackable() {
    return authedFetch("/api/feed/adjacent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then(function (r) {
      if (r.status === 400) return { results: [] };
      if (!r.ok) throw new Error("adjacent " + r.status);
      return r.json();
    }).then(function (json) {
      return (json && Array.isArray(json.results)) ? json.results : [];
    }).catch(function () { return []; });
  }

  function placeStake(founderId, amountCents) {
    return authedFetch("/api/stakes/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ founderId: founderId, amountCents: amountCents }),
    }).then(function (r) {
      return r.json().then(function (json) {
        if (!r.ok) throw new Error((json && json.error) || "Stake failed");
        return json;
      });
    });
  }

  function releaseStake(stakeId) {
    return authedFetch("/api/stakes/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stakeId: stakeId }),
    }).then(function (r) {
      return r.json().then(function (json) {
        if (!r.ok) throw new Error((json && json.error) || "Release failed");
        return json;
      });
    });
  }

  // ── Rendering ───────────────────────────────────────────────────────

  function renderCoinLine(coin) {
    var line = el("div", "stakes-coin");
    line.appendChild(el("span", "stakes-coin__symbol", coin.symbol || ""));
    var backers = Number(coin.backerCount) || 0;
    line.appendChild(el(
      "span",
      "stakes-coin__meta",
      fmt(coin.totalStakedCents) + " " + STR.backed + " · " +
        backers + " " + (backers === 1 ? STR.backer : STR.backers),
    ));
    return line;
  }

  function renderStakeRow(stake, body) {
    var row = el("div", "stakes-row");
    var label = el("div", "stakes-row__label");
    label.appendChild(el("div", "stakes-row__title", fmt(stake.amountCents)));
    label.appendChild(el("div", "stakes-row__sub", stake.founderName || stake.founderId));
    row.appendChild(label);

    var release = el("button", "stakes-row__button", STR.releaseButton);
    release.type = "button";
    release.addEventListener("click", function () {
      release.disabled = true;
      releaseStake(stake.id)
        .then(function () { refresh(body); })
        .catch(function (err) {
          release.disabled = false;
          showError(row, err.message);
        });
    });
    row.appendChild(release);
    return row;
  }

  function renderBackableCard(founder, body) {
    var card = el("div", "stakes-card");
    var label = el("div", "stakes-row__label");
    label.appendChild(el("div", "stakes-row__title", founder.pitchTitle || founder.userId));
    if (founder.oneLineSummary) {
      label.appendChild(el("div", "stakes-row__sub", founder.oneLineSummary));
    }
    card.appendChild(label);

    var coinLine = el("div", "stakes-coin__meta", "");
    card.appendChild(coinLine);
    loadCoin(founder.userId).then(function (coin) {
      coinLine.textContent =
        (coin.symbol ? coin.symbol + " · " : "") +
        fmt(coin.totalStakedCents) + " " + STR.backed +
        (coin.myStakeCents ? " · " + fmt(coin.myStakeCents) + " yours" : "");
    }).catch(function () { /* stats are decoration; the form still works */ });

    var form = el("form", "stakes-form");
    var input = el("input", "stakes-form__input");
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = STR.amountPlaceholder;
    input.setAttribute("aria-label", "Amount to stake in USDC");
    form.appendChild(input);

    var button = el("button", "stakes-form__button", STR.stakeButton);
    button.type = "submit";
    form.appendChild(button);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var cents = parseAmount(input.value);
      if (cents == null) { showError(card, "Enter an amount like 5.00"); return; }
      button.disabled = true;
      placeStake(founder.userId, cents)
        .then(function () { refresh(body); })
        .catch(function (err) {
          button.disabled = false;
          showError(card, err.message);
        });
    });
    card.appendChild(form);
    return card;
  }

  function showError(host, message) {
    var prior = host.querySelector(".stakes-error");
    if (prior) prior.remove();
    host.appendChild(el("div", "stakes-error", message || "Something went wrong."));
  }

  function refresh(body) {
    body.textContent = "";
    body.appendChild(el("h2", "stakes-title", STR.title));
    body.appendChild(el("p", "stakes-note", STR.practiceNote));

    Promise.all([loadWallet(), loadCoin("me"), loadBackable()])
      .then(function (parts) {
        var wallet = parts[0], myCoin = parts[1], backable = parts[2];

        body.appendChild(el("h3", "stakes-heading", STR.yourCoin));
        body.appendChild(renderCoinLine(myCoin));

        var balance = el("div", "stakes-balance");
        balance.appendChild(el("span", "stakes-balance__label", STR.balanceLabel));
        balance.appendChild(el("span", "stakes-balance__value", fmt(wallet.balanceCents)));
        body.appendChild(balance);

        body.appendChild(el("h3", "stakes-heading", STR.stakesHeading));
        // Names for the stake rows come from the adjacent list when the
        // founder is in it; otherwise the row shows the raw id.
        var names = {};
        backable.forEach(function (f) { names[f.userId] = f.pitchTitle; });
        if (!wallet.stakes.length) {
          body.appendChild(el("p", "stakes-empty", STR.noStakes));
        } else {
          wallet.stakes.forEach(function (stake) {
            stake.founderName = names[stake.founderId];
            body.appendChild(renderStakeRow(stake, body));
          });
        }

        body.appendChild(el("h3", "stakes-heading", STR.backHeading));
        if (!backable.length) {
          body.appendChild(el("p", "stakes-empty", STR.notDiscoverable));
        } else {
          backable.forEach(function (founder) {
            body.appendChild(renderBackableCard(founder, body));
          });
        }
      })
      .catch(function () {
        body.appendChild(el("p", "stakes-error", STR.loadFailed));
      });
  }

  // ── Overlay shell (same shape as wallet.js / back-me.js) ────────────

  function onKeydown(ev) {
    if (ev.key === "Escape") { ev.stopPropagation(); close(); }
  }

  function close() {
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
  }

  function open() {
    close();
    overlay = document.createElement("div");
    overlay.className = "backme-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", STR.title);

    var backdrop = el("div", "backme-overlay__backdrop");
    backdrop.addEventListener("click", close);
    overlay.appendChild(backdrop);

    var panel = el("div", "backme-overlay__panel stakes-panel");

    var closeBtn = el("button", "backme-overlay__close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", close);
    panel.appendChild(closeBtn);

    var body = el("div", "stakes-body");
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);
    setTimeout(function () { try { closeBtn.focus(); } catch (e) { /* ignore */ } }, 0);

    refresh(body);
  }

  window.tinkerStakes = { open: open, close: close };
})();
