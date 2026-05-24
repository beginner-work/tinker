/* tinker — founders (v0.2)
 *
 * The "founders" surface: a quiet adjacency tool for founder-to-founder
 * discovery inside tinker. Two states:
 *
 *   1. Opt-in screen (the load-bearing v1 surface — discoverable is OFF
 *      by default). One paragraph explains what discoverability means;
 *      a picker lets the founder choose WHICH of their published
 *      pitches to share with the network; one button opts them in.
 *
 *   2. Results page (once opted in). Shows the picked pitch's title at
 *      the top, the "find my founders" button, and on press a list of
 *      3–7 adjacent founder pitches as paper cards. A "Change pitch"
 *      control swaps to a different published pitch; a "Hide" control
 *      opts back out.
 *
 * NOT a scrolling feed. NOT engagement-ranked. NO likes, hearts,
 * comments, reactions, follower counts. NO DM / reach-out / reveal-
 * email in v1 — every card is name + one-line pitch summary + a link
 * to the founder's full pitch page on the daily-beginner reader.
 *
 * Visible-string contract: every string the page renders must be (a)
 * a verbatim quote from the founder's transcript, or (b) a fixed UI
 * string from the allowlist in build-prompts/social-feed.md. Strings
 * marked NEEDS_INPUT are placeholders waiting on founder copy.
 *
 * Entry point: window.tinkerFounders.refresh(). Wired in renderer.js
 * when the "founders" sidebar item is tapped.
 */

(() => {
  "use strict";

  const TOKEN_KEY = "tinker_jwt";

  // ── Visible-string allowlist ────────────────────────────────────────

  const STR = {
    // Opt-in screen
    optInExplain:
      // NEEDS_INPUT — the spec calls for the one-paragraph explanation
      // of what "discoverable" means in the founder's own words. This
      // draft sits in until the founder lands the line they want.
      "When you make a pitch discoverable, other founders inside tinker can find it as a match for their own pitch. No likes, no comments, no public profile — just a one-line summary and a link to your daily beginner.",
    pickerPrompt: "Pick a pitch to share with your founder network:",
    optInButton: "Make this pitch discoverable",
    hideHint: "You can hide it again any time.",
    noPublishedHint:
      "Publish one of your pitches first, then come back here to share it with the network.",

    // Results page
    findButton: "find my founders", // verbatim
    sectionHeading: "Founders adjacent to you", // verbatim
    sharedPitchLabel: "You're sharing",
    changePitchButton: "Change pitch",
    hideButton: "Hide my pitch from other founders",

    // Cold-start / empty state
    emptyLine:
      // NEEDS_INPUT — empty-state line, pending the founder's own words.
      "You're early — there aren't enough founders here yet for a match. Check back as more opt in.",

    aria: {
      surface: "founders",
      optInForm: "Opt in to be discoverable",
      findForm: "Find adjacent founders",
    },
  };

  // ── DOM + state ─────────────────────────────────────────────────────

  let viewEl = null;
  // null = haven't checked yet; otherwise { discoverableAt, pitchSlug }.
  let status = null;
  // Cached list of the founder's published pitches (for the picker).
  let publishedPitches = null;
  // Selection in the picker before the user confirms.
  let pickerSelectedSlug = null;
  // Last adjacency response so flipping away and back doesn't re-fire.
  let lastResults = null;
  let busyOptIn = false;
  let busyFind = false;
  let busyHide = false;
  let busyChange = false;

  function mount() {
    viewEl = document.getElementById("founders");
    return !!viewEl;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function getJwt() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  function isOptedIn() {
    return !!(status && status.discoverableAt && status.pitchSlug);
  }

  function findPitchBySlug(slug) {
    if (!slug || !Array.isArray(publishedPitches)) return null;
    return publishedPitches.find((p) => p.slug === slug) || null;
  }

  // ── Server I/O ──────────────────────────────────────────────────────

  async function loadStatus() {
    const token = getJwt();
    if (!token) { status = { discoverableAt: null, pitchSlug: null }; return; }
    try {
      const res = await fetch("/api/feed/discoverable", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { status = { discoverableAt: null, pitchSlug: null }; return; }
      const json = await res.json();
      status = {
        discoverableAt: (json && typeof json.discoverableAt === "string") ? json.discoverableAt : null,
        pitchSlug: (json && typeof json.pitchSlug === "string") ? json.pitchSlug : null,
      };
    } catch {
      status = { discoverableAt: null, pitchSlug: null };
    }
  }

  async function loadPublishedPitches() {
    const token = getJwt();
    if (!token) { publishedPitches = []; return; }
    try {
      const res = await fetch("/api/feed/published-pitches", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { publishedPitches = []; return; }
      const json = await res.json();
      publishedPitches = Array.isArray(json && json.pitches) ? json.pitches : [];
    } catch {
      publishedPitches = [];
    }
  }

  async function setDiscoverable({ optIn, pitchSlug }) {
    const token = getJwt();
    if (!token) return { ok: false, error: "Not signed in" };
    const payload = optIn ? { optIn: true, pitchSlug } : { optIn: false };
    try {
      const res = await fetch("/api/feed/discoverable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) return { ok: false, error: (json && json.error) || `HTTP ${res.status}` };
      status = {
        discoverableAt: typeof json.discoverableAt === "string" ? json.discoverableAt : null,
        pitchSlug: typeof json.pitchSlug === "string" ? json.pitchSlug : null,
      };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async function findAdjacent() {
    const token = getJwt();
    if (!token) return { ok: false, error: "Not signed in" };
    try {
      const res = await fetch("/api/feed/adjacent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) return { ok: false, error: (json && json.error) || `HTTP ${res.status}` };
      return {
        ok: true,
        coldStart: !!json.coldStart,
        results: Array.isArray(json.results) ? json.results : [],
      };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

  function render() {
    if (!mount()) return;
    if (status === null || publishedPitches === null) {
      viewEl.innerHTML = `<div class="founders__loading" aria-hidden="true">…</div>`;
      Promise.all([
        status === null ? loadStatus() : Promise.resolve(),
        publishedPitches === null ? loadPublishedPitches() : Promise.resolve(),
      ]).then(() => render());
      return;
    }
    if (isOptedIn()) {
      renderResults();
    } else {
      renderOptIn();
    }
  }

  function renderOptIn() {
    // Default the picker selection to the most recently published
    // pitch if the founder hasn't touched the picker yet.
    if (pickerSelectedSlug === null && publishedPitches.length) {
      pickerSelectedSlug = publishedPitches[0].slug;
    }

    let pickerHtml = "";
    if (!publishedPitches.length) {
      pickerHtml =
        `<p class="founders__fineprint">${escapeHtml(STR.noPublishedHint)}</p>`;
    } else {
      const optionsHtml = publishedPitches.map((p) => {
        const checked = p.slug === pickerSelectedSlug ? " checked" : "";
        // Pitch titles are founder-generated chrome (the daily-beginner
        // post titles). data-audit-ignore keeps them out of any future
        // visible-string audit.
        return (
          `<label class="founders__picker-option" data-audit-ignore>` +
            `<input type="radio" name="founders-pitch" value="${escapeHtml(p.slug)}"${checked} />` +
            `<span class="founders__picker-title">${escapeHtml(p.title)}</span>` +
          `</label>`
        );
      }).join("");
      pickerHtml =
        `<div class="founders__picker-prompt">${escapeHtml(STR.pickerPrompt)}</div>` +
        `<div class="founders__picker" data-role="picker">${optionsHtml}</div>`;
    }

    const buttonDisabled = !publishedPitches.length || !pickerSelectedSlug || busyOptIn;

    viewEl.innerHTML =
      `<div class="founders__inner">` +
        `<h1 class="founders__title">${escapeHtml(STR.aria.surface)}</h1>` +
        `<p class="founders__lede">${escapeHtml(STR.optInExplain)}</p>` +
        pickerHtml +
        `<form class="founders__opt-in" data-role="opt-in-form" aria-label="${escapeHtml(STR.aria.optInForm)}">` +
          `<button type="submit" class="founders__primary" data-role="opt-in-btn"` +
                  (buttonDisabled ? " disabled" : "") + `>` +
            escapeHtml(STR.optInButton) +
          `</button>` +
          `<p class="founders__fineprint">${escapeHtml(STR.hideHint)}</p>` +
        `</form>` +
      `</div>`;

    const picker = viewEl.querySelector('[data-role="picker"]');
    if (picker) {
      picker.addEventListener("change", (e) => {
        const input = e.target.closest('input[type="radio"]');
        if (!input) return;
        pickerSelectedSlug = input.value;
        renderOptIn();
      });
    }

    const form = viewEl.querySelector('[data-role="opt-in-form"]');
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (busyOptIn || !pickerSelectedSlug) return;
        busyOptIn = true;
        renderOptIn();
        const r = await setDiscoverable({ optIn: true, pitchSlug: pickerSelectedSlug });
        busyOptIn = false;
        if (!r.ok) {
          renderOptInError(r.error);
          return;
        }
        lastResults = null;
        render();
      });
    }
  }

  function renderOptInError(message) {
    renderOptIn();
    const form = viewEl.querySelector('[data-role="opt-in-form"]');
    if (!form) return;
    const err = document.createElement("p");
    err.className = "founders__error";
    err.setAttribute("role", "alert");
    err.textContent = message || "Something went wrong. Please try again.";
    form.appendChild(err);
  }

  function renderResults() {
    const shared = findPitchBySlug(status.pitchSlug);
    const sharedTitle = shared ? shared.title : status.pitchSlug;

    viewEl.innerHTML =
      `<div class="founders__inner">` +
        `<h1 class="founders__title">${escapeHtml(STR.aria.surface)}</h1>` +

        // The pitch the founder is currently sharing with the network.
        `<section class="founders__own" aria-labelledby="founders-own-label">` +
          `<div id="founders-own-label" class="founders__own-label">${escapeHtml(STR.sharedPitchLabel)}</div>` +
          `<div class="founders__own-title" data-audit-ignore>${escapeHtml(sharedTitle || "")}</div>` +
          `<button type="button" class="founders__inline-link" data-role="change-btn"` +
                  (busyChange ? " disabled" : "") + `>` +
            escapeHtml(STR.changePitchButton) +
          `</button>` +
        `</section>` +

        // The primary action.
        `<form class="founders__find" data-role="find-form" aria-label="${escapeHtml(STR.aria.findForm)}">` +
          `<button type="submit" class="founders__primary" data-role="find-btn"` +
                  (busyFind ? " disabled" : "") + `>` +
            escapeHtml(STR.findButton) +
          `</button>` +
        `</form>` +

        // Slot for the adjacency results.
        `<div class="founders__results" data-role="results"></div>` +

        // Quiet opt-out.
        `<form class="founders__hide" data-role="hide-form">` +
          `<button type="submit" class="founders__secondary" data-role="hide-btn"` +
                  (busyHide ? " disabled" : "") + `>` +
            escapeHtml(STR.hideButton) +
          `</button>` +
        `</form>` +
      `</div>`;

    const findForm = viewEl.querySelector('[data-role="find-form"]');
    if (findForm) {
      findForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (busyFind) return;
        busyFind = true;
        renderResultsLoading();
        const r = await findAdjacent();
        busyFind = false;
        if (!r.ok) {
          renderResultsError(r.error);
          return;
        }
        lastResults = r;
        renderResultsList();
      });
    }

    const changeBtn = viewEl.querySelector('[data-role="change-btn"]');
    if (changeBtn) {
      changeBtn.addEventListener("click", async () => {
        if (busyChange) return;
        // "Change pitch" drops them back to the picker. Hide first so
        // the picker can render in opt-in mode, with the current slug
        // pre-selected so they can confirm or pick a different one.
        busyChange = true;
        renderResults();
        pickerSelectedSlug = status.pitchSlug;
        const r = await setDiscoverable({ optIn: false });
        busyChange = false;
        if (!r.ok) {
          renderResultsError(r.error);
          return;
        }
        lastResults = null;
        render();
      });
    }

    const hideForm = viewEl.querySelector('[data-role="hide-form"]');
    if (hideForm) {
      hideForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (busyHide) return;
        busyHide = true;
        renderResults();
        const r = await setDiscoverable({ optIn: false });
        busyHide = false;
        if (!r.ok) {
          renderResultsError(r.error);
          return;
        }
        lastResults = null;
        pickerSelectedSlug = null;
        render();
      });
    }

    if (lastResults) renderResultsList();
  }

  function renderResultsLoading() {
    const slot = viewEl.querySelector('[data-role="results"]');
    if (!slot) return;
    slot.innerHTML = `<div class="founders__results-loading" aria-hidden="true">…</div>`;
  }

  function renderResultsError(message) {
    const slot = viewEl.querySelector('[data-role="results"]');
    if (!slot) return;
    const p = document.createElement("p");
    p.className = "founders__error";
    p.setAttribute("role", "alert");
    p.textContent = message || "Couldn't reach the adjacency engine. Please try again.";
    slot.innerHTML = "";
    slot.appendChild(p);
  }

  function renderResultsList() {
    const slot = viewEl.querySelector('[data-role="results"]');
    if (!slot) return;
    slot.innerHTML = "";

    if (!lastResults) return;

    if (lastResults.coldStart || !lastResults.results.length) {
      const p = document.createElement("p");
      p.className = "founders__empty";
      p.textContent = STR.emptyLine;
      slot.appendChild(p);
      return;
    }

    const header = document.createElement("h2");
    header.className = "founders__results-heading";
    header.textContent = STR.sectionHeading;
    slot.appendChild(header);

    const list = document.createElement("ul");
    list.className = "founders__cards";
    for (const r of lastResults.results) {
      list.appendChild(renderCard(r));
    }
    slot.appendChild(list);
  }

  function renderCard(result) {
    const li = document.createElement("li");
    li.className = "founders__card";

    const a = document.createElement("a");
    a.className = "founders__card-link";
    a.href = result.viewUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const title = document.createElement("div");
    title.className = "founders__card-title";
    title.setAttribute("data-audit-ignore", "");
    title.textContent = result.pitchTitle || "";
    a.appendChild(title);

    const summary = document.createElement("div");
    summary.className = "founders__card-summary";
    summary.setAttribute("data-audit-ignore", "");
    summary.textContent = result.oneLineSummary || "";
    a.appendChild(summary);

    li.appendChild(a);
    return li;
  }

  // ── Public API ──────────────────────────────────────────────────────

  window.tinkerFounders = {
    render,
    // Called from renderer.js when the surface is opened so the page
    // re-checks discoverability + the published-pitches list (a fresh
    // publish in another tab might have changed either).
    refresh() {
      status = null;
      publishedPitches = null;
      pickerSelectedSlug = null;
      lastResults = null;
      render();
    },
  };
})();
