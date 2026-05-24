/* tinker — founders (v0.1)
 *
 * The "founders" surface: a quiet adjacency tool for founder-to-founder
 * discovery inside tinker. Two states:
 *
 *   1. Opt-in screen (the load-bearing v1 surface — discoverable is OFF
 *      by default). One paragraph explains what discoverability means,
 *      one button opts the founder in.
 *
 *   2. Results page (once opted in). Shows the founder's pitch summary
 *      at the top, the "find my founders" button, and on press a list
 *      of 3–7 adjacent founder pitches as paper cards. A small "Hide
 *      my pitch" control opts back out.
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
 * Entry point: window.tinkerFounders.render(). Wired in renderer.js
 * when the "founders" sidebar item is tapped.
 */

(() => {
  "use strict";

  const TOKEN_KEY = "tinker_jwt";

  // ── Visible-string allowlist ────────────────────────────────────────
  //
  // Mirror of build-prompts/social-feed.md. Strings here are either
  // verbatim from the founder's transcript (marked) or fixed UI labels.
  // Placeholders marked NEEDS_INPUT are drafts pending founder copy.

  const STR = {
    // Opt-in screen
    optInExplain:
      // NEEDS_INPUT — the spec calls for the one-paragraph explanation
      // of what "discoverable" means in the founder's own words. This
      // draft sits in until the founder lands the line they want.
      "When you make your pitch discoverable, other founders inside tinker can find it as a match for their own pitch. No likes, no comments, no public profile — just a one-line summary and a link to your daily beginner.",
    optInButton: "Make my pitch discoverable",
    hideHint: "You can hide it again any time.",

    // Results page
    findButton: "find my founders", // verbatim
    sectionHeading: "Founders adjacent to you", // verbatim
    yourPitchLabel: "Your pitch",
    hideButton: "Hide my pitch from other founders",
    viewPitchButton: "View pitch",

    // Cold-start / empty state
    emptyLine:
      // NEEDS_INPUT — empty-state line, pending the founder's own words.
      "You're early — there aren't enough founders here yet for a match. Check back as more opt in.",

    // Transient + plumbing strings (sidebar tab label is the literal
    // "founders" in index.html; aria/title attributes only)
    aria: {
      surface: "founders",
      optInForm: "Make my pitch discoverable",
      findForm: "Find adjacent founders",
    },
  };

  // ── DOM ─────────────────────────────────────────────────────────────

  let viewEl = null;
  // Cached opt-in status. null means "haven't checked the server yet";
  // a string is the ISO timestamp of when the founder opted in; the
  // empty string is the "checked, not opted in" state.
  let discoverableAt = null;
  // Last adjacency response so we can re-render without re-firing the
  // endpoint when the founder taps Hide / re-opens the page.
  let lastResults = null;
  let busyOptIn = false;
  let busyFind = false;
  let busyHide = false;

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

  // ── Pitch text for adjacency ────────────────────────────────────────
  //
  // The endpoint needs the requester's pitch in flat text form so Claude
  // can compare it against the candidates. Stitch the active pitch's
  // resolved deck phrases into "Heading: phrase. phrase." lines.

  function stitchActivePitchText() {
    const pm = window.tinkerPitches;
    if (!pm) return { text: "", title: "", missing: "no-module" };
    const pitch = typeof pm.getActivePitch === "function" ? pm.getActivePitch() : null;
    if (!pitch) return { text: "", title: "", missing: "no-pitch" };

    const headings = (pm.DECK_HEADINGS && pm.DECK_HEADINGS.length)
      ? pm.DECK_HEADINGS
      : [];
    const lines = [];
    for (const h of headings) {
      const recs = (pitch.deck && Array.isArray(pitch.deck[h])) ? pitch.deck[h] : [];
      const phrases = [];
      for (const rec of recs) {
        const body = bodyForWriting(rec.writingId);
        if (!body) continue;
        if (rec.offset < 0 || rec.offset + rec.length > body.length) continue;
        const slice = String(body.slice(rec.offset, rec.offset + rec.length))
          .replace(/\s+/g, " ").trim();
        if (slice) phrases.push(slice);
      }
      if (phrases.length) lines.push(`${h}: ${phrases.join(" ")}`);
    }
    const title = (pitch.personalTitle || pitch.aiTitle || "").trim();
    return {
      text: lines.join("\n"),
      title,
      missing: lines.length ? null : "no-phrases",
    };
  }

  function bodyForWriting(writingId) {
    try {
      const drafts = JSON.parse(localStorage.getItem("tinker.drafts.v1") || "[]") || [];
      const draft = Array.isArray(drafts) ? drafts.find((d) => d && d.id === writingId) : null;
      if (draft) {
        if (draft.stitched && draft.stitched.body) return String(draft.stitched.body);
        const turns = Array.isArray(draft.transcript) ? draft.transcript : [];
        return turns.map((t) => String(t && t.a || "").trim()).filter(Boolean).join("\n\n");
      }
      const essays = JSON.parse(localStorage.getItem("tinker.essays.v1") || "[]") || [];
      const essay = Array.isArray(essays) ? essays.find((e) => e && e.id === writingId) : null;
      if (essay) return String(essay.body || "");
    } catch { /* ignore */ }
    return "";
  }

  function isOptedIn() {
    return typeof discoverableAt === "string" && discoverableAt.length > 0;
  }

  // ── Server I/O ──────────────────────────────────────────────────────

  async function loadDiscoverable() {
    const token = getJwt();
    if (!token) { discoverableAt = ""; return; }
    try {
      const res = await fetch("/api/feed/discoverable", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { discoverableAt = ""; return; }
      const json = await res.json();
      discoverableAt = (json && typeof json.discoverableAt === "string")
        ? json.discoverableAt
        : "";
    } catch {
      discoverableAt = "";
    }
  }

  async function setDiscoverable(optIn) {
    const token = getJwt();
    if (!token) return { ok: false, error: "Not signed in" };
    try {
      const res = await fetch("/api/feed/discoverable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ optIn: !!optIn }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) return { ok: false, error: (json && json.error) || `HTTP ${res.status}` };
      discoverableAt = typeof json.discoverableAt === "string" ? json.discoverableAt : "";
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async function findAdjacent() {
    const token = getJwt();
    if (!token) return { ok: false, error: "Not signed in" };
    const { text, title, missing } = stitchActivePitchText();
    if (missing === "no-phrases" || !text) {
      // No pitch yet to compare against — treat the same as cold start
      // so the page renders the empty line rather than throwing.
      return { ok: true, coldStart: true, results: [] };
    }
    try {
      const res = await fetch("/api/feed/adjacent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pitchText: text, pitchTitle: title }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) return { ok: false, error: (json && json.error) || `HTTP ${res.status}` };
      return { ok: true, coldStart: !!json.coldStart, results: Array.isArray(json.results) ? json.results : [] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

  function render() {
    if (!mount()) return;
    viewEl.innerHTML = `<div class="founders__loading" aria-hidden="true">…</div>`;
    if (discoverableAt === null) {
      loadDiscoverable().then(() => render());
      return;
    }
    if (isOptedIn()) {
      renderResults();
    } else {
      renderOptIn();
    }
  }

  function renderOptIn() {
    viewEl.innerHTML =
      `<div class="founders__inner">` +
        `<h1 class="founders__title">${escapeHtml(STR.aria.surface)}</h1>` +
        `<p class="founders__lede">${escapeHtml(STR.optInExplain)}</p>` +
        `<form class="founders__opt-in" data-role="opt-in-form" aria-label="${escapeHtml(STR.aria.optInForm)}">` +
          `<button type="submit" class="founders__primary" data-role="opt-in-btn"` +
                  (busyOptIn ? " disabled" : "") + `>` +
            escapeHtml(STR.optInButton) +
          `</button>` +
          `<p class="founders__fineprint">${escapeHtml(STR.hideHint)}</p>` +
        `</form>` +
      `</div>`;

    const form = viewEl.querySelector('[data-role="opt-in-form"]');
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (busyOptIn) return;
        busyOptIn = true;
        renderOptIn();
        const r = await setDiscoverable(true);
        busyOptIn = false;
        if (!r.ok) {
          // Show a quiet inline error and re-render the opt-in screen
          // so the founder can try again.
          renderOptInError(r.error);
          return;
        }
        // Land on the results page once the timestamp comes back.
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
    const { title: pitchTitle } = stitchActivePitchText();
    const titleLine = pitchTitle ? escapeHtml(pitchTitle) : "";

    viewEl.innerHTML =
      `<div class="founders__inner">` +
        `<h1 class="founders__title">${escapeHtml(STR.aria.surface)}</h1>` +

        // The founder's own pitch summary at the top.
        (titleLine
          ? `<section class="founders__own" aria-labelledby="founders-own-label">` +
              `<div id="founders-own-label" class="founders__own-label">${escapeHtml(STR.yourPitchLabel)}</div>` +
              // The pitch title is founder-generated chrome — wrapped
              // in data-audit-ignore so the visible-string audit
              // doesn't complain about a developer-authored literal.
              `<div class="founders__own-title" data-audit-ignore>${titleLine}</div>` +
            `</section>`
          : "") +

        // The primary action.
        `<form class="founders__find" data-role="find-form" aria-label="${escapeHtml(STR.aria.findForm)}">` +
          `<button type="submit" class="founders__primary" data-role="find-btn"` +
                  (busyFind ? " disabled" : "") + `>` +
            escapeHtml(STR.findButton) +
          `</button>` +
        `</form>` +

        // Slot for the adjacency results (filled by renderResultsList).
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

    const hideForm = viewEl.querySelector('[data-role="hide-form"]');
    if (hideForm) {
      hideForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (busyHide) return;
        busyHide = true;
        renderResults();
        const r = await setDiscoverable(false);
        busyHide = false;
        if (!r.ok) {
          renderResultsError(r.error);
          return;
        }
        lastResults = null;
        render();
      });
    }

    // If we already have an adjacency response from this session, paint
    // it back so flipping away and back doesn't re-fire the endpoint.
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

    // The whole card is a link to the founder's pitch page. Title +
    // one-line summary lifted verbatim from the candidate's pitch live
    // inside that link; no other chrome.
    const a = document.createElement("a");
    a.className = "founders__card-link";
    a.href = result.viewUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const title = document.createElement("div");
    title.className = "founders__card-title";
    // Titles are founder-generated rather than fixed UI strings — the
    // audit ignores anything under data-audit-ignore.
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
    // re-checks discoverability (a fresh tab might have changed it).
    refresh() {
      discoverableAt = null;
      lastResults = null;
      render();
    },
  };
})();
