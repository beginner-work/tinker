/* tinker — deck switcher chrome
 *
 * A small dropdown rendered near the brand mark in the sidebar. Shows
 * the active deck's name; tapping reveals the full list plus an "Add
 * a deck" affordance.
 *
 * Visible only when:
 *   - tinkerAuth.isSubscribed() === true, AND
 *   - tinkerDecks.list().length > 1
 *
 * Paid users with only the default deck don't see the switcher yet —
 * the Add a deck affordance is reachable from the welcome page (welcome
 * tile or the validation review's primary button).
 *
 * Selecting a row calls tinkerDecks.setActive(id), closes the dropdown,
 * re-renders the sidebar tree, and returns to the welcome page if the
 * founder was on a screen showing deck-specific state.
 */

(() => {
  "use strict";

  // [NEEDS INPUT] — Add-a-deck modal copy. Placeholders until the
  // founder confirms.
  const ADD_DECK_LABEL = "Add a deck";
  const MODAL_HEADING = "Who's this pitch for?";
  const MODAL_BODY = "Tell us the name. We'll find their site and read it.";
  const NAME_PLACEHOLDER = "Y Combinator";
  const ADD_BUTTON_LABEL = "Add";
  const CANCEL_LABEL = "Cancel.";
  const READING_LABEL = "Reading…";

  let switcherEl = null;
  let modalEl = null;

  function isSubscribed() {
    if (window.tinkerAuth && typeof window.tinkerAuth.isSubscribed === "function") {
      try { return !!window.tinkerAuth.isSubscribed(); } catch { return false; }
    }
    return false;
  }

  function getDecks() {
    if (!window.tinkerDecks || typeof window.tinkerDecks.list !== "function") return [];
    try { return window.tinkerDecks.list() || []; } catch { return []; }
  }

  function activeDeck() {
    if (!window.tinkerDecks || typeof window.tinkerDecks.active !== "function") return null;
    try { return window.tinkerDecks.active(); } catch { return null; }
  }

  // ── Sidebar mount ───────────────────────────────────────────────────
  // The switcher lives in a slot inside the sidebar header next to the
  // brand. We append a host element on first render; visibility is
  // driven by render().
  function ensureMount() {
    const top = document.querySelector(".sidebar__top");
    if (!top) return null;
    if (switcherEl) return switcherEl;
    switcherEl = document.createElement("div");
    switcherEl.className = "deck-switcher";
    switcherEl.hidden = true;
    top.appendChild(switcherEl);
    return switcherEl;
  }

  function render() {
    const host = ensureMount();
    if (!host) return;
    const decks = getDecks();
    const subscribed = isSubscribed();
    if (!subscribed || decks.length <= 1) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML = "";

    const active = activeDeck();
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "deck-switcher__trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const name = document.createElement("span");
    name.className = "deck-switcher__name";
    name.textContent = active ? active.name : "";
    trigger.appendChild(name);

    const caret = document.createElement("span");
    caret.className = "deck-switcher__caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▾";
    trigger.appendChild(caret);

    trigger.addEventListener("click", () => toggleDropdown(host, trigger, decks));
    host.appendChild(trigger);
  }

  function toggleDropdown(host, trigger, decks) {
    const existing = host.querySelector(".deck-switcher__panel");
    if (existing) {
      existing.remove();
      trigger.setAttribute("aria-expanded", "false");
      return;
    }
    const panel = document.createElement("div");
    panel.className = "deck-switcher__panel";
    panel.setAttribute("role", "listbox");

    const activeId = (window.tinkerDecks && window.tinkerDecks.activeId && window.tinkerDecks.activeId()) || "default";
    for (const deck of decks) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "deck-switcher__row";
      if (deck.id === activeId) row.setAttribute("aria-current", "true");

      const label = document.createElement("span");
      label.className = "deck-switcher__row-name";
      label.textContent = deck.name;
      row.appendChild(label);

      if (deck.sourceUrl) {
        const host = document.createElement("span");
        host.className = "deck-switcher__row-host";
        try { host.textContent = new URL(deck.sourceUrl).host; }
        catch { host.textContent = ""; }
        row.appendChild(host);
      }

      row.addEventListener("click", () => {
        if (window.tinkerDecks && typeof window.tinkerDecks.setActive === "function") {
          window.tinkerDecks.setActive(deck.id);
        }
        panel.remove();
        trigger.setAttribute("aria-expanded", "false");
      });

      panel.appendChild(row);
    }

    const addRow = document.createElement("button");
    addRow.type = "button";
    addRow.className = "deck-switcher__row deck-switcher__row--add";
    const plus = document.createElement("span");
    plus.className = "deck-switcher__plus";
    plus.setAttribute("aria-hidden", "true");
    plus.textContent = "+";
    addRow.appendChild(plus);
    const addLabel = document.createElement("span");
    addLabel.className = "deck-switcher__row-name";
    addLabel.textContent = ADD_DECK_LABEL;
    addRow.appendChild(addLabel);
    addRow.addEventListener("click", () => {
      panel.remove();
      trigger.setAttribute("aria-expanded", "false");
      openAddDeck();
    });
    panel.appendChild(addRow);

    host.appendChild(panel);
    trigger.setAttribute("aria-expanded", "true");

    // Click-outside closes the dropdown. One-shot.
    setTimeout(() => {
      function onDocClick(ev) {
        if (!host.contains(ev.target)) {
          panel.remove();
          trigger.setAttribute("aria-expanded", "false");
          document.removeEventListener("click", onDocClick);
        }
      }
      document.addEventListener("click", onDocClick);
    }, 0);
  }

  // ── Add-a-deck modal ────────────────────────────────────────────────
  function openAddDeck() {
    if (modalEl) return;
    if (!isSubscribed()) {
      // Shouldn't be reachable for unpaid users, but defend.
      if (window.tinkerPayment && typeof window.tinkerPayment.open === "function") {
        window.tinkerPayment.open();
      }
      return;
    }
    modalEl = document.createElement("div");
    modalEl.className = "add-deck-modal";

    const backdrop = document.createElement("div");
    backdrop.className = "add-deck-modal__backdrop";
    backdrop.addEventListener("click", closeAddDeck);
    modalEl.appendChild(backdrop);

    const card = document.createElement("div");
    card.className = "add-deck-modal__card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");

    const h = document.createElement("h2");
    h.className = "add-deck-modal__heading";
    h.textContent = MODAL_HEADING;
    card.appendChild(h);

    const body = document.createElement("p");
    body.className = "add-deck-modal__body";
    body.textContent = MODAL_BODY;
    card.appendChild(body);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "add-deck-modal__input";
    input.placeholder = NAME_PLACEHOLDER;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.maxLength = 200;
    card.appendChild(input);

    const status = document.createElement("div");
    status.className = "add-deck-modal__status";
    status.setAttribute("aria-live", "polite");
    card.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "add-deck-modal__actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "add-deck-modal__cancel";
    cancel.textContent = CANCEL_LABEL;
    cancel.addEventListener("click", closeAddDeck);
    actions.appendChild(cancel);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "validation-button validation-button--primary add-deck-modal__add";
    add.textContent = ADD_BUTTON_LABEL;
    add.disabled = true;
    actions.appendChild(add);

    card.appendChild(actions);
    modalEl.appendChild(card);
    document.body.appendChild(modalEl);

    input.addEventListener("input", () => {
      add.disabled = input.value.trim().length < 2;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !add.disabled) {
        e.preventDefault();
        submit(input, status, add);
      }
      if (e.key === "Escape") closeAddDeck();
    });
    add.addEventListener("click", () => submit(input, status, add));

    setTimeout(() => input.focus(), 20);
  }

  function closeAddDeck() {
    if (!modalEl) return;
    modalEl.remove();
    modalEl = null;
  }

  async function submit(input, status, addBtn) {
    const name = input.value.trim();
    if (name.length < 2) return;
    addBtn.disabled = true;
    input.disabled = true;
    status.textContent = READING_LABEL;
    try {
      const token = (function () {
        try { return localStorage.getItem("tinker_jwt") || ""; }
        catch { return ""; }
      })();
      if (!token) throw new Error("Not signed in.");
      const res = await fetch("/api/validation/fetch-context", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const j = await res.json();
          if (j && j.error) msg = j.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      const json = await res.json();
      if (!json || !json.name) throw new Error("Empty response.");
      // Create the new deck on the client. The server-side cache row
      // is shared across paid users; this client only persists what's
      // needed to drive the renderer.
      if (window.tinkerDecks && typeof window.tinkerDecks.create === "function") {
        const id = window.tinkerDecks.create({
          name: json.name,
          sourceUrl: json.sourceUrl || null,
          sourceContext: json.sourceContext || null,
        });
        if (id) window.tinkerDecks.setActive(id);
      }
      closeAddDeck();
      // Land the founder on the welcome page in the new deck's context.
      const main = document.getElementById("stage") || document.querySelector("main.stage");
      if (main) {
        const sections = main.querySelectorAll(":scope > section");
        sections.forEach((s) => {
          s.hidden = s.id !== "welcome";
          if (s.id === "welcome") s.setAttribute("data-active", "");
          else s.removeAttribute("data-active");
        });
      }
    } catch (err) {
      input.disabled = false;
      addBtn.disabled = input.value.trim().length < 2;
      status.textContent = (err && err.message) || "Couldn't read this one.";
    }
  }

  // ── Boot ────────────────────────────────────────────────────────────
  window.tinkerDeckSwitcher = { render, openAddDeck };

  function boot() { render(); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener("tinker:decks-changed", () => render());
  window.addEventListener("tinker:auth-changed", () => render());
  window.addEventListener("tinker:subscription-changed", () => render());
})();
