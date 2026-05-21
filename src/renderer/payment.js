/* tinker — payment screen
 *
 * One view: $8/mo to add more pitches. Continue button calls
 * /api/payment/checkout-session and redirects the browser to Stripe
 * Checkout. Apple Pay is enabled at the Stripe dashboard level — the
 * browser surfaces it on supporting devices automatically.
 *
 * Anti-patterns:
 *   - No celebration UI on success. After payment, the deck-switcher
 *     chrome appears in its slot and the Add a deck affordance becomes
 *     interactive. That's the entire transition.
 *   - No motion. No transitions, no animations.
 */

(() => {
  "use strict";

  // [NEEDS INPUT] — payment heading + body. Placeholders until the
  // founder confirms.
  const HEADING = "$8 / month to add more pitches.";
  const BODY = "One pitch is yours forever. More pitches need $8 / month.";
  const CONTINUE_LABEL = "Continue";
  const NOT_NOW_LABEL = "Not now.";

  let section = null;
  let returnToReview = false;

  function ensureSection() {
    if (section) return section;
    const main = document.getElementById("stage") || document.querySelector("main.stage");
    if (!main) return null;
    section = document.createElement("section");
    section.id = "payment";
    section.className = "payment";
    section.hidden = true;
    main.appendChild(section);
    return section;
  }

  function render() {
    if (!section) return;
    section.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "payment__inner";

    const h = document.createElement("h1");
    h.className = "payment__heading";
    h.textContent = HEADING;
    inner.appendChild(h);

    const body = document.createElement("p");
    body.className = "payment__body";
    body.textContent = BODY;
    inner.appendChild(body);

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "validation-button validation-button--primary payment__cta";
    cta.textContent = CONTINUE_LABEL;
    cta.addEventListener("click", () => {
      cta.disabled = true;
      startCheckout()
        .catch((err) => {
          cta.disabled = false;
          renderError(inner, err);
        });
    });
    inner.appendChild(cta);

    const notNow = document.createElement("button");
    notNow.type = "button";
    notNow.className = "payment__not-now";
    notNow.textContent = NOT_NOW_LABEL;
    notNow.addEventListener("click", close);
    inner.appendChild(notNow);

    section.appendChild(inner);
  }

  function renderError(container, err) {
    let existing = container.querySelector(".payment__error");
    if (!existing) {
      existing = document.createElement("p");
      existing.className = "payment__error";
      container.appendChild(existing);
    }
    existing.textContent = (err && err.message) || "Couldn't reach the payment screen.";
  }

  async function startCheckout() {
    let token = "";
    try { token = localStorage.getItem("tinker_jwt") || ""; }
    catch { /* ignore */ }
    if (!token) throw new Error("Not signed in.");
    const res = await fetch("/api/payment/checkout-session", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) {
      let msg = `Checkout failed (${res.status})`;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const json = await res.json();
    if (!json || !json.url) throw new Error("Stripe URL missing.");
    window.location.href = json.url;
  }

  function showOnlyPayment() {
    const main = document.getElementById("stage") || document.querySelector("main.stage");
    if (!main) return;
    const sections = main.querySelectorAll(":scope > section");
    sections.forEach((s) => {
      if (s === section) {
        s.hidden = false;
      } else {
        s.hidden = true;
        s.removeAttribute("data-active");
      }
    });
  }

  function open({ returnToReview: rtr } = {}) {
    ensureSection();
    render();
    returnToReview = !!rtr;
    showOnlyPayment();
  }

  function close() {
    if (section) section.hidden = true;
    if (returnToReview && window.tinkerValidation && typeof window.tinkerValidation.refreshTile === "function") {
      // The review screen has been torn down by this point; route back
      // to the welcome / base feed.
    }
    const main = document.getElementById("stage") || document.querySelector("main.stage");
    if (main) {
      const welcome = main.querySelector("#welcome");
      if (welcome) {
        welcome.hidden = false;
        welcome.setAttribute("data-active", "");
      }
    }
    returnToReview = false;
  }

  // ── Post-payment routing ────────────────────────────────────────────
  // Stripe redirects back to /?paid=1 on success. We strip the query
  // param, refresh window.tinkerAuth.isSubscribed(), and route the
  // founder to the deck switcher / Add-a-deck flow.
  function handlePostPaymentReturn() {
    try {
      const url = new URL(window.location.href);
      const paid = url.searchParams.get("paid");
      if (paid === null) return;
      url.searchParams.delete("paid");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      if (paid === "1") {
        // Trigger an auth refresh so the renderer can pick up the new
        // subscription state. The auth module re-fetches on
        // tinker:auth-changed.
        try { window.dispatchEvent(new CustomEvent("tinker:auth-changed", { detail: { source: "payment-return" } })); }
        catch { /* ignore */ }
        if (window.tinkerAuth && typeof window.tinkerAuth.refreshSubscription === "function") {
          window.tinkerAuth.refreshSubscription().then(() => {
            // Route the founder into the Add-a-deck flow now that they
            // can create additional decks.
            if (window.tinkerDeckSwitcher && typeof window.tinkerDeckSwitcher.openAddDeck === "function") {
              window.tinkerDeckSwitcher.openAddDeck();
            }
          });
        } else if (window.tinkerDeckSwitcher && typeof window.tinkerDeckSwitcher.openAddDeck === "function") {
          window.tinkerDeckSwitcher.openAddDeck();
        }
      }
    } catch { /* ignore */ }
  }

  // ── Boot ────────────────────────────────────────────────────────────
  window.tinkerPayment = { open, close };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handlePostPaymentReturn, { once: true });
  } else {
    handlePostPaymentReturn();
  }
})();
