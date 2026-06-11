/* tinker — your story (v0.106)
 *
 * The deck is gone. There is one story: every piece of writing the
 * founder has published, verbatim, in the order they wrote it, in one
 * place. Nothing rearranges it, nothing summarizes it, nothing slots it
 * under headings — the story reads exactly as it was written.
 *
 * When the story feels done, the founder LOCKS IT IN: they type the
 * number they're asking for, and the whole story publishes to their
 * public beginner profile. From then on it's in their pocket — pull out
 * the phone, the story and the number are already there, the QR is one
 * tap away, and the fundraising is automatic.
 *
 * This module owns:
 *   - the story model (published writings, oldest first, verbatim)
 *   - the lock state (the ask, when it was locked, what it contained)
 *   - the sidebar "Your story" block (in-progress drafts + the story's
 *     essays + the pocket)
 *   - the full story view rendered into #story
 *
 * Storage:
 *   - tinker.story.v1 (synced as kind "story")
 *       {
 *         ask: string | null,          // the number, verbatim as typed
 *         lockedAt: number | null,
 *         lockedEssayIds: [essayId],   // the story as it was when locked
 *         storiesUrl: string | null,   // the public page the lock published
 *       }
 *
 * Visible-string contract: essay titles and bodies (and the ask) render
 * verbatim — they are the founder's words. Everything else in this
 * surface is developer-authored chrome.
 *
 * Events:
 *   - listens: tinker:hydrated, tinker:auth-changed, tinker:writing-saved
 *   - fires:   tinker:story-changed (after a lock)
 */

(() => {
  "use strict";

  const STORY_KEY = "tinker.story.v1";
  const ESSAYS_KEY = "tinker.essays.v1";
  const DRAFTS_KEY = "tinker.drafts.v1";
  const TOKEN_KEY = "tinker_jwt";
  const MAX_ASK_LEN = 24;
  // Sidebar rows before the list folds into "…and N more". The full
  // story is always one tap away in the story view.
  const MAX_SIDEBAR_ROWS = 12;

  // ── Storage helpers ───────────────────────────────────────────────

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === undefined ? fallback : parsed;
    } catch { return fallback; }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* ignore */ }
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  function loadLock() {
    const raw = loadJson(STORY_KEY, null);
    if (!raw || typeof raw !== "object") {
      return { ask: null, lockedAt: null, lockedEssayIds: [], storiesUrl: null };
    }
    return {
      ask: typeof raw.ask === "string" && raw.ask.trim() ? raw.ask : null,
      lockedAt: Number.isFinite(Number(raw.lockedAt)) && Number(raw.lockedAt) > 0
        ? Number(raw.lockedAt)
        : null,
      lockedEssayIds: Array.isArray(raw.lockedEssayIds)
        ? raw.lockedEssayIds.filter((id) => typeof id === "string")
        : [],
      storiesUrl: typeof raw.storiesUrl === "string" && raw.storiesUrl ? raw.storiesUrl : null,
    };
  }

  function saveLock(lock) {
    saveJson(STORY_KEY, lock);
    if (window.tinkerSync && typeof window.tinkerSync.pushStory === "function") {
      window.tinkerSync.pushStory();
    }
  }

  // ── The story model ───────────────────────────────────────────────

  function bodyForDraft(draft) {
    if (draft && draft.stitched && draft.stitched.body) return String(draft.stitched.body);
    const turns = (draft && Array.isArray(draft.transcript)) ? draft.transcript : [];
    return turns.map((t) => String(t && t.a || "").trim()).filter(Boolean).join("\n\n");
  }

  // Every published writing with words in it — essays and quick
  // statuses alike — oldest first, so the story reads as the journey it
  // was. Archived writings stay out (they were put away on purpose).
  function storyEssays() {
    const arr = loadJson(ESSAYS_KEY, []);
    const list = Array.isArray(arr) ? arr : [];
    return list
      .filter((e) => e && typeof e.id === "string" && !e.archived && String(e.body || "").trim())
      .slice()
      .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
      .map((e) => ({
        id: e.id,
        title: typeof e.title === "string" ? e.title : "",
        body: String(e.body || ""),
        createdAt: Number(e.createdAt) || 0,
        kind: e.kind === "status" ? "status" : "essay",
      }));
  }

  // In-progress drafts, newest first — still part of "your writing all
  // in one place", just not in the story until they're finished.
  function draftsInProgress() {
    const arr = loadJson(DRAFTS_KEY, []);
    const list = Array.isArray(arr) ? arr : [];
    return list
      .filter((d) => d && typeof d.id === "string")
      .slice()
      .sort((a, b) => (Number(b.updatedAt) || Number(b.createdAt) || 0)
        - (Number(a.updatedAt) || Number(a.createdAt) || 0))
      .map((d) => ({
        id: d.id,
        title: String(d.title || (d.stitched && d.stitched.title) || "Untitled draft"),
        hasWords: !!bodyForDraft(d).trim(),
      }));
  }

  function wordCount() {
    let n = 0;
    for (const e of storyEssays()) {
      n += e.body.trim().split(/\s+/).filter(Boolean).length;
    }
    return n;
  }

  function getLock() {
    return loadLock();
  }

  // The writings that joined the story after the founder locked it.
  // [] when never locked (everything is "new" but there's nothing to
  // have grown FROM, so the pocket shows the lock-in invite instead).
  function grownSinceLock() {
    const lock = loadLock();
    if (!lock.lockedAt) return [];
    const known = new Set(lock.lockedEssayIds);
    return storyEssays().filter((e) => !known.has(e.id));
  }

  function sanitizeAsk(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) return null;
    return trimmed.length > MAX_ASK_LEN ? trimmed.slice(0, MAX_ASK_LEN) : trimmed;
  }

  // ── Lock it in ────────────────────────────────────────────────────
  //
  // One deliberate act: snapshot the story, keep the number, publish
  // the whole thing to the founder's public beginner profile (the
  // existing booklet row that profile already reads). After this the
  // story is in their pocket: phone out → story, number, QR.

  let lockInflight = false;

  async function lockIn(askValue) {
    if (lockInflight) return { ok: false, error: "Already locking" };
    const ask = sanitizeAsk(askValue);
    if (!ask) return { ok: false, error: "Type the number you're asking for first." };
    const essays = storyEssays();
    if (!essays.length) return { ok: false, error: "Write your first essay before locking in." };
    const t = token();
    if (!t) return { ok: false, error: "Sign in to lock your story in." };

    lockInflight = true;
    let res, json = null;
    try {
      res = await fetch("/api/publish/booklet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          pitches: [{
            title: "My story",
            slug: "story",
            stories: essays.map((e) => ({
              title: e.title || undefined,
              body: e.body,
            })),
          }],
        }),
      });
      try { json = await res.json(); } catch { /* ignore */ }
    } catch (err) {
      lockInflight = false;
      return { ok: false, error: "Couldn't reach the server — your story is safe here; try again in a moment." };
    }
    lockInflight = false;
    if (!res.ok || !json || !json.ok) {
      return { ok: false, error: (json && json.error) || `Couldn't publish (HTTP ${res.status}).` };
    }

    const lock = {
      ask,
      lockedAt: Date.now(),
      lockedEssayIds: essays.map((e) => e.id),
      storiesUrl: typeof json.storiesUrl === "string" ? json.storiesUrl : null,
    };
    saveLock(lock);
    fire("tinker:story-changed");
    return { ok: true, storiesUrl: lock.storiesUrl, lockedAt: lock.lockedAt };
  }

  function fire(name) {
    try { window.dispatchEvent(new CustomEvent(name)); }
    catch { /* ignore */ }
  }

  // ── Sidebar block ─────────────────────────────────────────────────

  let navEl = null;
  let draftsEl = null;
  let listEl = null;
  let countEl = null;
  let pocketEl = null;

  function ensureMount() {
    navEl = document.querySelector(".sidebar__story");
    if (!navEl) return;
    draftsEl = navEl.querySelector("[data-story-drafts]");
    listEl = navEl.querySelector("[data-story-list]");
    countEl = navEl.querySelector("[data-story-count]");
    pocketEl = navEl.querySelector("[data-story-pocket]");
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderNav() {
    ensureMount();
    if (!navEl) return;
    const essays = storyEssays();
    const drafts = draftsInProgress();

    // Cold start: nothing written yet — the sidebar stays brand +
    // Account only, same as before.
    if (!essays.length && !drafts.length) {
      navEl.hidden = true;
      return;
    }
    navEl.hidden = false;

    if (countEl) {
      const words = wordCount();
      countEl.textContent = essays.length
        ? `${essays.length} ${essays.length === 1 ? "piece" : "pieces"} · ${words.toLocaleString()} words`
        : "";
    }

    if (draftsEl) {
      draftsEl.innerHTML = "";
      for (const d of drafts) {
        const li = document.createElement("li");
        const btn = el("button", "sidebar__account-item sidebar__story-draft");
        btn.type = "button";
        const label = el("span", "sidebar__account-label", d.title);
        btn.appendChild(label);
        const tag = el("span", "sidebar__story-draft-tag", "in progress");
        btn.appendChild(tag);
        btn.addEventListener("click", () => {
          if (typeof window.tinkerResumeDraft === "function") window.tinkerResumeDraft(d.id);
        });
        li.appendChild(btn);
        draftsEl.appendChild(li);
      }
    }

    if (listEl) {
      listEl.innerHTML = "";
      const shown = essays.slice(0, MAX_SIDEBAR_ROWS);
      for (const e of shown) {
        const li = document.createElement("li");
        const btn = el("button", "sidebar__account-item sidebar__story-item");
        btn.type = "button";
        btn.setAttribute("data-essay-id", e.id);
        const label = el(
          "span",
          "sidebar__account-label",
          e.title || firstWords(e.body, 8),
        );
        btn.appendChild(label);
        btn.addEventListener("click", () => {
          if (typeof window.tinkerShowStory === "function") window.tinkerShowStory(e.id);
        });
        li.appendChild(btn);
        listEl.appendChild(li);
      }
      if (essays.length > shown.length) {
        const li = document.createElement("li");
        const more = el(
          "button",
          "sidebar__account-item sidebar__story-more",
          `…and ${essays.length - shown.length} more`,
        );
        more.type = "button";
        more.addEventListener("click", () => {
          if (typeof window.tinkerShowStory === "function") window.tinkerShowStory();
        });
        li.appendChild(more);
        listEl.appendChild(li);
      }
    }

    renderPocket();
  }

  // The pocket block at the bottom of the sidebar: the lock state at a
  // glance. Locked → the number, ready to pull out. Unlocked → the
  // invitation to read the story and lock it in.
  function renderPocket() {
    if (!pocketEl) return;
    pocketEl.innerHTML = "";
    const essays = storyEssays();
    const lock = loadLock();

    if (lock.lockedAt && lock.ask) {
      const card = el("button", "sidebar__pocket-card");
      card.type = "button";
      card.setAttribute("aria-label", "Open your locked story");
      card.appendChild(el("span", "sidebar__pocket-kicker", "In your pocket"));
      card.appendChild(el("span", "sidebar__pocket-ask", lock.ask));
      const grown = grownSinceLock().length;
      if (grown > 0) {
        card.appendChild(el(
          "span",
          "sidebar__pocket-note",
          `${grown} new ${grown === 1 ? "piece" : "pieces"} since you locked it`,
        ));
      }
      card.addEventListener("click", () => {
        if (typeof window.tinkerShowStory === "function") window.tinkerShowStory();
      });
      pocketEl.appendChild(card);
    } else if (essays.length) {
      const read = el("button", "sidebar__pitch-action sidebar__pitch-action--primary", "Read your story");
      read.type = "button";
      read.addEventListener("click", () => {
        if (typeof window.tinkerShowStory === "function") window.tinkerShowStory();
      });
      pocketEl.appendChild(read);
    }
  }

  function firstWords(text, n) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    const head = words.slice(0, n).join(" ");
    return words.length > n ? head + "…" : head;
  }

  // ── Story view ────────────────────────────────────────────────────

  let viewEl = null;

  function ensureView() {
    viewEl = document.getElementById("story");
  }

  function formatLockedDate(ts) {
    const d = new Date(ts);
    try {
      return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    } catch { return d.toDateString(); }
  }

  function paragraphs(mount, body) {
    const parts = String(body || "").split(/\n{2,}/);
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed) mount.appendChild(el("p", null, trimmed));
    }
  }

  // Render the whole story into #story. `anchorEssayId` scrolls that
  // essay into view after paint.
  function renderView(anchorEssayId) {
    ensureView();
    if (!viewEl) return;
    viewEl.innerHTML = "";
    const essays = storyEssays();
    const lock = loadLock();

    const inner = el("div", "story__inner");
    viewEl.appendChild(inner);

    const head = el("header", "story__head");
    head.appendChild(el("p", "story__kicker", "Your story"));
    if (lock.lockedAt && lock.ask) {
      const pocket = el("div", "story__locked-banner");
      pocket.appendChild(el("span", "story__locked-ask", lock.ask));
      pocket.appendChild(el(
        "span",
        "story__locked-date",
        `In your pocket since ${formatLockedDate(lock.lockedAt)}`,
      ));
      head.appendChild(pocket);
    }
    if (essays.length) {
      head.appendChild(el(
        "p",
        "story__meta",
        `${essays.length} ${essays.length === 1 ? "piece" : "pieces"} · ${wordCount().toLocaleString()} words · oldest first, exactly as you wrote them`,
      ));
    }
    inner.appendChild(head);

    if (!essays.length) {
      inner.appendChild(el(
        "p",
        "story__empty",
        "Your story hasn't started yet. Write your first essay and it will appear here, word for word.",
      ));
      return;
    }

    for (const e of essays) {
      const article = el("article", "story__piece");
      article.id = `story-essay-${e.id}`;
      if (e.title) article.appendChild(el("h2", "story__piece-title", e.title));
      const body = el("div", "story__piece-body");
      paragraphs(body, e.body);
      article.appendChild(body);
      inner.appendChild(article);
    }

    inner.appendChild(renderLockBlock(essays, lock));

    if (anchorEssayId) {
      setTimeout(() => {
        const target = document.getElementById(`story-essay-${anchorEssayId}`);
        if (target && typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      }, 30);
    }
  }

  // The end of the story: lock it in, or — once locked — the pocket.
  function renderLockBlock(essays, lock) {
    const block = el("section", "story__lock");
    const grown = lock.lockedAt ? grownSinceLock().length : 0;

    if (lock.lockedAt && lock.ask) {
      block.appendChild(el("h3", "story__lock-title", "In your pocket."));
      block.appendChild(el("p", "story__lock-ask", lock.ask));
      block.appendChild(el(
        "p",
        "story__lock-sub",
        `Locked in ${formatLockedDate(lock.lockedAt)}. Pull out your phone — the story and the number are already there.`,
      ));
      const row = el("div", "story__lock-actions");
      const qr = el("button", "story__lock-button", "Show my QR");
      qr.type = "button";
      qr.addEventListener("click", () => {
        if (window.tinkerBackMe && typeof window.tinkerBackMe.open === "function") {
          window.tinkerBackMe.open();
        }
      });
      row.appendChild(qr);
      if (lock.storiesUrl) {
        const link = el("a", "story__lock-link", "Open my public page");
        link.href = lock.storiesUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        row.appendChild(link);
      }
      block.appendChild(row);
      if (grown > 0) {
        block.appendChild(el(
          "p",
          "story__lock-grown",
          `Your story has grown — ${grown} new ${grown === 1 ? "piece" : "pieces"} since you locked it.`,
        ));
      }
      block.appendChild(lockForm(lock, grown > 0 ? "Lock it in again" : "Change the number"));
    } else {
      block.appendChild(el("h3", "story__lock-title", "Done with this story?"));
      block.appendChild(el(
        "p",
        "story__lock-sub",
        "Lock it in: type the number you're asking for, and your story — every word of it — goes to your public page. From then on it's in your pocket.",
      ));
      block.appendChild(lockForm(lock, "Lock it in"));
    }
    return block;
  }

  function lockForm(lock, submitLabel) {
    const form = el("form", "story__lock-form");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "story__lock-input";
    input.placeholder = "The number you're asking for";
    input.maxLength = MAX_ASK_LEN;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = lock.ask || "";
    form.appendChild(input);
    const submit = el("button", "story__lock-submit", submitLabel);
    submit.type = "submit";
    form.appendChild(submit);
    const status = el("p", "story__lock-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    form.appendChild(status);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit.disabled = true;
      status.textContent = "Locking it in…";
      lockIn(input.value).then((result) => {
        submit.disabled = false;
        if (result.ok) {
          status.textContent = "";
          renderView();
          renderNav();
        } else {
          status.textContent = result.error || "Couldn't lock it in — try again.";
        }
      });
    });
    return form;
  }

  // ── Public surface ────────────────────────────────────────────────

  const api = {
    storyEssays,
    draftsInProgress,
    wordCount,
    getLock,
    grownSinceLock,
    lockIn,
    renderNav,
    renderView,
    snapshot() { return JSON.parse(JSON.stringify(loadLock())); },
  };
  window.tinkerStory = api;

  // ── Event hooks ───────────────────────────────────────────────────

  window.addEventListener("tinker:hydrated", () => { renderNav(); });
  window.addEventListener("tinker:auth-changed", () => { renderNav(); });
  window.addEventListener("tinker:writing-saved", () => { renderNav(); });
  window.addEventListener("tinker:story-changed", () => { renderNav(); });

  function boot() {
    renderNav();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
