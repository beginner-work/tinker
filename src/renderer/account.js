/* tinker — account page (v0.102)
 *
 * Owns the inside of <section id="account">. Two states, drawn from
 * the presence of the setup blob in localStorage:
 *
 *   1. Pre-setup → a small two-field setup form (Name, LinkedIn
 *      account, Save). Submitting writes
 *      tinker.account.setup.v1 = { name, linkedin, completedAt }
 *      and re-renders into state 2.
 *   2. Post-setup → a dashboard with the founder's name + plan
 *      tier at the top, then section widgets below (Money market
 *      funds → transactions.js data relabeled as deposits; LinkedIn
 *      fits → linkedin-fit.js's existing render(); Plan → tier
 *      cards drawn verbatim from pitch-deck.md slide 10).
 *
 * The sidebar's nav-account row's label is state-driven from the
 * same blob: "Account setup" before setup, "Account" + name after.
 *
 * Storage:
 *   - tinker.account.setup.v1 → { name, linkedin, completedAt }
 *   - tinker.plan.v1          → { tier }
 * Both round-trip through sync.js.
 *
 * Allowlist for visible strings inside the page + sidebar row:
 *   (a) Founder transcript verbatim — e.g. the framing line
 *       "money → a way to see their investments in writing grow"
 *   (b) pitch-deck.md verbatim — tier names and prices
 *   (c) Fixed UI allowlist (UI_STRINGS below)
 *   (d) Live underlying data — founder's name, LinkedIn account,
 *       deposit amounts/dates, fit counts, tier name from storage.
 */

(() => {
  "use strict";

  // ── Allowlist ───────────────────────────────────────────────────────
  // (c) Fixed UI strings the page is allowed to render. Anything else
  // visible inside <section id="account"> or the sidebar Account row
  // must trace to (a), (b), or (d) above.
  const UI_STRINGS = {
    accountSetup: "Account setup",
    account: "Account",
    name: "Name",
    linkedinAccount: "LinkedIn account",
    save: "Save",
    moneyMarketFunds: "Money market funds",
    balance: "Balance",
    deposit: "Deposit",
    deposits: "Deposits",
    linkedinFits: "LinkedIn fits",
    plan: "Plan",
    pick: "Pick",
    contact: "Contact",
    comingSoon: "Coming soon",
    current: "current",
    pleaseEnterName: "Please enter a name.",
    pleaseEnterLinkedin: "Please enter your LinkedIn account.",
  };

  // (a) Founder's verbatim framing for the Money market funds section.
  // Lifted from the build prompt's "money → a way to see their
  // investments in writing grow". Treated as a single quote — do not
  // edit, expand, or paraphrase.
  const MMF_FRAMING = "money → a way to see their investments in writing grow";

  // (b) Tier strings drawn verbatim from pitch-deck.md slide 10
  // ("$7, $35, $70 — and enterprise-level pricing beyond that" and
  // "Free to start, $7 a month once they use it enough"). The deck's
  // numbers and labels are the source of truth; we render five tiers,
  // each as a single display label.
  //
  // `tier` is the canonical value stored in tinker.plan.v1.tier — also
  // the verbatim deck string for that tier. `display` is the form the
  // founder sees in the Plan section's tier card; the numbered tiers
  // append " / month" to the verbatim "$N" since the deck calls them
  // "monthly subscriptions" in the same line.
  const TIERS = [
    { tier: "Free to start", display: "Free to start" },
    { tier: "$7",            display: "$7 / month" },
    { tier: "$35",           display: "$35 / month" },
    { tier: "$70",           display: "$70 / month" },
    { tier: "Enterprise",    display: "Enterprise" },
  ];

  // Section accent colors — drawn from tokens/rainbow-web.json. One per
  // section, in the IDE-coloring spirit called out in the build prompt
  // ("Money market funds → green, LinkedIn fits → blue, Plan → purple").
  const ACCENT_GREEN  = "#7bc47a"; // logo-leaf
  const ACCENT_BLUE   = "#7dd3fc"; // logo-sky
  const ACCENT_PURPLE = "#c8b6e2"; // logo-purple

  // ── Storage ─────────────────────────────────────────────────────────
  const LS_ACCOUNT = "tinker.account.setup.v1";
  const LS_PLAN = "tinker.plan.v1";

  function loadAccount() {
    try {
      const raw = localStorage.getItem(LS_ACCOUNT);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      // A setup is "done" iff both name and linkedin are non-empty AND
      // completedAt is present. Anything else (legacy partial writes,
      // hand-edited localStorage) re-shows the setup form.
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      const linkedin = typeof parsed.linkedin === "string" ? parsed.linkedin.trim() : "";
      const completedAt = typeof parsed.completedAt === "string" ? parsed.completedAt : "";
      if (!name || !linkedin || !completedAt) return null;
      return { name, linkedin, completedAt };
    } catch {
      return null;
    }
  }

  function saveAccount(blob) {
    try { localStorage.setItem(LS_ACCOUNT, JSON.stringify(blob)); }
    catch { /* localStorage full or denied — best effort */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushAccount === "function") {
      window.tinkerSync.pushAccount();
    }
  }

  function loadPlan() {
    try {
      const raw = localStorage.getItem(LS_PLAN);
      if (!raw) return { tier: "Free to start" };
      const parsed = JSON.parse(raw);
      const validTiers = TIERS.map((t) => t.tier);
      if (parsed && typeof parsed === "object" && validTiers.includes(parsed.tier)) {
        return { tier: parsed.tier };
      }
      return { tier: "Free to start" };
    } catch {
      return { tier: "Free to start" };
    }
  }

  // ── Sidebar row sync ────────────────────────────────────────────────
  // Sidebar row label is state-driven from loadAccount() and recomputed
  // every render. Pre-setup: "Account setup", name span hidden.
  // Post-setup: "Account" + the user's name in the secondary line.
  function refreshSidebarRow() {
    const labelEl = document.querySelector("[data-account-row-label]");
    const nameEl = document.querySelector("[data-account-row-name]");
    if (!labelEl || !nameEl) return;
    const acc = loadAccount();
    if (acc) {
      labelEl.textContent = UI_STRINGS.account;
      nameEl.textContent = acc.name;
      nameEl.hidden = false;
    } else {
      labelEl.textContent = UI_STRINGS.accountSetup;
      nameEl.textContent = "";
      nameEl.hidden = true;
    }
  }

  // ── DOM helpers ─────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "style") node.setAttribute("style", v);
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "hidden") {
          if (v) node.hidden = true;
        } else {
          node.setAttribute(k, v);
        }
      }
    }
    if (children) {
      for (const child of [].concat(children)) {
        if (child == null) continue;
        node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
      }
    }
    return node;
  }

  // Format a transaction date string (YYYY-MM-DD) as "Jan 4". Dates
  // come from the underlying transactions data; this is (d) display
  // formatting only — no editorial words added.
  function formatDepositDate(iso) {
    const s = String(iso || "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const month = months[Number(m[2]) - 1];
    const day = String(Number(m[3]));
    return month ? `${month} ${day}` : s;
  }

  function formatMoney(n) {
    const v = Math.abs(Number(n) || 0);
    return `$${v.toFixed(2)}`;
  }

  // Pull the rows from transactions.js that represent the user's
  // payments TO tinker (subscription deposits into their writing-
  // investment fund). [NEEDS INPUT: scope of deposits] — the founder
  // hasn't named the underlying data shape, so we default to:
  // categorize anything tagged "tinker" or "Tinker" or "Subscriptions"
  // as a deposit. If the founder later clarifies (e.g. only specific
  // merchants count), this filter is the place to narrow.
  function getDeposits() {
    const api = window.tinkerTransactions;
    if (!api || typeof api.list !== "function") return [];
    const all = api.list();
    return all
      .filter((t) => {
        if (!t) return false;
        const merchant = String(t.merchant || "").toLowerCase();
        const category = String(t.category || "").toLowerCase();
        return (
          merchant.includes("tinker") ||
          category === "subscriptions" ||
          category === "tinker"
        );
      })
      .map((t) => ({
        id: t.id,
        date: t.date,
        amount: Math.abs(Number(t.amount) || 0),
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  // ── Setup form ──────────────────────────────────────────────────────
  function renderSetupForm(root) {
    root.innerHTML = "";

    const inner = el("div", { class: "account__inner account__inner--setup" });

    // Page title — same string as the sidebar row pre-setup. Both
    // resolve to UI_STRINGS.accountSetup so the allowlist audit sees
    // one origin for two visible nodes.
    inner.appendChild(el("h1", {
      class: "account__title",
      text: UI_STRINGS.accountSetup,
    }));

    const form = el("form", {
      class: "account__form",
      novalidate: "novalidate",
      onsubmit: (e) => {
        e.preventDefault();
        submitSetup(form, root);
      },
    });

    // Name field
    const nameWrap = el("div", { class: "account__field" });
    nameWrap.appendChild(el("label", {
      class: "account__field-label",
      for: "account-setup-name",
      text: UI_STRINGS.name,
    }));
    nameWrap.appendChild(el("input", {
      class: "account__field-input",
      id: "account-setup-name",
      name: "name",
      type: "text",
      autocomplete: "name",
      spellcheck: "false",
    }));
    nameWrap.appendChild(el("p", {
      class: "account__field-error",
      "data-field-error": "name",
      hidden: true,
    }));
    form.appendChild(nameWrap);

    // LinkedIn field
    const linkedinWrap = el("div", { class: "account__field" });
    linkedinWrap.appendChild(el("label", {
      class: "account__field-label",
      for: "account-setup-linkedin",
      text: UI_STRINGS.linkedinAccount,
    }));
    linkedinWrap.appendChild(el("input", {
      class: "account__field-input",
      id: "account-setup-linkedin",
      name: "linkedin",
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
    }));
    linkedinWrap.appendChild(el("p", {
      class: "account__field-error",
      "data-field-error": "linkedin",
      hidden: true,
    }));
    form.appendChild(linkedinWrap);

    // Save button
    form.appendChild(el("div", { class: "account__form-actions" }, [
      el("button", {
        class: "account__save",
        type: "submit",
        text: UI_STRINGS.save,
      }),
    ]));

    inner.appendChild(form);
    root.appendChild(inner);

    // Drop focus into the first empty field.
    setTimeout(() => {
      const first = form.querySelector('input[name="name"]');
      if (first) first.focus();
    }, 30);
  }

  function submitSetup(form, root) {
    const nameInput = form.querySelector('input[name="name"]');
    const linkedinInput = form.querySelector('input[name="linkedin"]');
    const nameError = form.querySelector('[data-field-error="name"]');
    const linkedinError = form.querySelector('[data-field-error="linkedin"]');

    const name = (nameInput.value || "").trim();
    const linkedin = (linkedinInput.value || "").trim();

    let invalid = false;
    if (!name) {
      nameError.textContent = UI_STRINGS.pleaseEnterName;
      nameError.hidden = false;
      invalid = true;
    } else {
      nameError.textContent = "";
      nameError.hidden = true;
    }
    if (!linkedin) {
      linkedinError.textContent = UI_STRINGS.pleaseEnterLinkedin;
      linkedinError.hidden = false;
      invalid = true;
    } else {
      linkedinError.textContent = "";
      linkedinError.hidden = true;
    }
    if (invalid) return;

    const blob = { name, linkedin, completedAt: new Date().toISOString() };
    saveAccount(blob);
    refreshSidebarRow();
    renderDashboard(root);
  }

  // ── Dashboard ───────────────────────────────────────────────────────
  function renderDashboard(root) {
    const acc = loadAccount();
    if (!acc) {
      renderSetupForm(root);
      return;
    }
    const plan = loadPlan();

    root.innerHTML = "";
    const inner = el("div", { class: "account__inner account__inner--dashboard" });

    // Header: name + plan tier. Both come from underlying data (d),
    // no editorial chrome.
    const header = el("header", { class: "account__header" }, [
      el("h1", { class: "account__name", text: acc.name }),
      el("p", { class: "account__tier", text: planDisplay(plan.tier) }),
    ]);
    inner.appendChild(header);

    // Section: Money market funds (green).
    inner.appendChild(renderMmfSection());
    // Section: LinkedIn fits (blue) — relocates the existing
    // #linkedin-fit element into this section so linkedin-fit.js's
    // render() entry point can still find its DOM target.
    inner.appendChild(renderLinkedinFitsSection());
    // Section: Plan (purple).
    inner.appendChild(renderPlanSection(plan));

    root.appendChild(inner);

    // Kick the linkedin-fit module once its DOM target is mounted.
    if (window.tinkerLinkedinFit && typeof window.tinkerLinkedinFit.render === "function") {
      window.tinkerLinkedinFit.render();
    }
  }

  // Render the plan tier label as it should appear in the header.
  // Returns the same `display` form used by the tier cards so the
  // header and the Plan section stay in sync.
  function planDisplay(tierKey) {
    const tier = TIERS.find((t) => t.tier === tierKey);
    if (!tier) return "Free to start";
    return tier.display;
  }

  function makeSectionWrap(title, accent) {
    const section = el("section", { class: "account__section" });
    section.style.setProperty("--account-accent", accent);
    section.appendChild(el("div", { class: "account__section-marker", "aria-hidden": "true" }));
    section.appendChild(el("h2", { class: "account__section-title", text: title }));
    return section;
  }

  function renderMmfSection() {
    const section = makeSectionWrap(UI_STRINGS.moneyMarketFunds, ACCENT_GREEN);
    // Sub-line: founder's verbatim framing (a). One quote, no
    // editorializing.
    section.appendChild(el("p", { class: "account__section-sub", text: MMF_FRAMING }));

    const deposits = getDeposits();
    const total = deposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

    // Balance row — "Balance" label (c) + sum of deposits (d).
    const body = el("div", { class: "account__widget account__widget--mmf" });
    body.appendChild(el("div", { class: "account__mmf-balance" }, [
      el("span", { class: "account__mmf-balance-label", text: UI_STRINGS.balance }),
      el("span", { class: "account__mmf-balance-value", text: formatMoney(total) }),
    ]));

    // Deposits list — "Deposits" label (c) + rows of (deposit
    // amount, date) from underlying data (d). Each row is labeled
    // "Deposit" (singular, c) so the visible-string audit catches it
    // — but per-row labels stay short.
    body.appendChild(el("h3", { class: "account__mmf-list-head", text: UI_STRINGS.deposits }));

    const list = el("ul", { class: "account__mmf-list" });
    if (deposits.length === 0) {
      // No editorial copy on an empty list — just show the section
      // chrome and rely on Balance: $0.00 to communicate state.
    } else {
      for (const d of deposits) {
        list.appendChild(el("li", { class: "account__mmf-row" }, [
          el("span", { class: "account__mmf-row-label", text: UI_STRINGS.deposit }),
          el("span", { class: "account__mmf-row-amount", text: formatMoney(d.amount) }),
          el("span", { class: "account__mmf-row-date", text: formatDepositDate(d.date) }),
        ]));
      }
    }
    body.appendChild(list);
    section.appendChild(body);
    return section;
  }

  function renderLinkedinFitsSection() {
    const section = makeSectionWrap(UI_STRINGS.linkedinFits, ACCENT_BLUE);
    // Mount slot: the existing #linkedin-fit element is moved here so
    // linkedin-fit.js's render() can still find its DOM target by id.
    // The slot is the section's body; we wrap to keep the section's
    // chrome (marker + title) above the moved-in content.
    const slot = el("div", { class: "account__widget account__widget--linkedin" });
    const lifEl = document.getElementById("linkedin-fit");
    if (lifEl) {
      // Detach from previous parent (the stage), strip the [hidden]
      // attribute so it actually renders inside the dashboard.
      lifEl.hidden = false;
      slot.appendChild(lifEl);
    }
    section.appendChild(slot);
    return section;
  }

  function renderPlanSection(plan) {
    const section = makeSectionWrap(UI_STRINGS.plan, ACCENT_PURPLE);
    const list = el("div", { class: "account__widget account__widget--plan" });

    const currentTier = plan.tier;

    for (const tier of TIERS) {
      const isCurrent = tier.tier === currentTier;
      const card = el("div", {
        class: "account__tier-card" + (isCurrent ? " account__tier-card--current" : ""),
      });

      // Tier display label — derived from the deck verbatim (b).
      // "Free to start", "$7 / month", "$35 / month", "$70 / month",
      // "Enterprise".
      card.appendChild(el("div", { class: "account__tier-title", text: tier.display }));

      if (isCurrent) {
        card.appendChild(el("span", { class: "account__tier-chip", text: UI_STRINGS.current }));
      } else {
        // [NEEDS INPUT: payment integration] — v1 ships the picker
        // disabled. [NEEDS INPUT: enterprise contact path] for the
        // Enterprise row's "Contact" CTA.
        const ctaLabel = tier.tier === "Enterprise" ? UI_STRINGS.contact : UI_STRINGS.pick;
        const cta = el("button", {
          type: "button",
          class: "account__tier-cta",
          disabled: "disabled",
          title: UI_STRINGS.comingSoon,
        }, [ctaLabel]);
        const note = el("span", { class: "account__tier-note", text: UI_STRINGS.comingSoon });
        card.appendChild(cta);
        card.appendChild(note);
      }

      list.appendChild(card);
    }

    section.appendChild(list);
    return section;
  }

  // ── Page mount ──────────────────────────────────────────────────────
  function mount() {
    const root = document.getElementById("account");
    if (!root) return null;
    return root;
  }

  function show() {
    const root = mount();
    if (!root) return;
    if (typeof window.tinkerShowAccountStage === "function") {
      window.tinkerShowAccountStage();
    } else {
      // Fallback for very-early calls before renderer.js wires the
      // helper. Drop into the simpler reveal path.
      root.hidden = false;
    }
    const acc = loadAccount();
    if (acc) renderDashboard(root);
    else renderSetupForm(root);
  }

  // ── Boot ────────────────────────────────────────────────────────────
  // Sidebar row label needs to be correct at first paint, before the
  // founder taps anything. The button is in the DOM at DOMContentLoaded
  // time (renderer.js doesn't replace it), so it's safe to read +
  // write on initial load.
  function init() {
    refreshSidebarRow();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
  // Hydration may have written a freshly-fetched account blob in from
  // the server. Re-sync the sidebar row label and re-render the page
  // if it's currently visible.
  window.addEventListener("tinker:hydrated", () => {
    refreshSidebarRow();
    const root = document.getElementById("account");
    if (root && !root.hidden) {
      const acc = loadAccount();
      if (acc) renderDashboard(root);
      else renderSetupForm(root);
    }
  });

  window.tinkerAccount = {
    show,
    refreshSidebarRow,
    /** Test/debug only — read the current persisted account blob. */
    _loadAccount: loadAccount,
    _loadPlan: loadPlan,
  };
})();
