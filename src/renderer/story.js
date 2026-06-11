/* tinker — your story (v0.107)
 *
 * One story, verbatim. The story/pitch shows, for each of the eleven
 * slide categories, the MOST RECENT essay that fits it — distilled to
 * the 1–2 sentences that most represent the essay's main idea, plucked
 * verbatim from the body (max 2 per slide, so the whole pitch tops out
 * at 22 sentences). Tapping a piece opens the full essay. Nothing is
 * rearranged after the fact: a piece is tagged + plucked once, when
 * it's written, and a newer essay simply takes over its category.
 * Older takes stay in the class view (tap the kicker), the category
 * feeds, and the read view; the story is the current cut.
 *
 * When the story feels done, the founder LOCKS IT IN: they type the
 * number they're asking for, and the curated story publishes to their
 * public beginner profile. From then on it's in their pocket — pull
 * out the phone, the story and the number are already there, the QR is
 * one tap away, and the fundraising is automatic.
 *
 * This module owns:
 *   - the story model (most recent essay per slide category)
 *   - the one-shot classifier client that tags writings (essay.slide).
 *     Classification is ALL the AI does here — selection and display
 *     are recency and the founder's own words.
 *   - the lock state (the ask, when, what it contained)
 *   - the sidebar "Your story" block (pocket on top, then the story's
 *     pieces — published work only; in-progress drafts live in the
 *     writing flow, not the story)
 *   - the full story view rendered into #story, and the per-slide
 *     class view (every essay in a category, newest first — the
 *     newest is the one in the pitch)
 *   - the team block: suggestions for people who might be answering a
 *     question the founder leaves unanswered in their essays (see
 *     /api/team/suggest — nothing of theirs is shown), and the
 *     invites the founder has made (tinker.team.v1, synced as "team")
 *
 * Storage:
 *   - tinker.story.v1 (synced as kind "story")
 *       { ask, lockedAt, lockedEssayIds, storiesUrl }
 *   - the category tag lives ON the essay records (essay.slide,
 *     essay.slideCheckedAt), synced with the essays blob via
 *     window.tinkerStore.setEssaySlide.
 *
 * Visible-string contract: essay titles and bodies (and the ask)
 * render verbatim — they are the founder's words. The slide-category
 * kickers and labels are developer-authored chrome.
 *
 * Events:
 *   - listens: tinker:hydrated, tinker:auth-changed, tinker:writing-saved
 *   - fires:   tinker:story-changed (after a lock or a new tag)
 */

(() => {
  "use strict";

  const STORY_KEY = "tinker.story.v1";
  const ESSAYS_KEY = "tinker.essays.v1";
  const TEAM_KEY = "tinker.team.v1";
  const TOKEN_KEY = "tinker_jwt";
  const MAX_ASK_LEN = 24;
  // Sentences per slide in the pitch. 11 slides × 2 = the 22-sentence
  // ceiling the founder set.
  const PLUCK_PER_SLIDE = 2;
  // Gap between backfill classify calls so a large archive tags itself
  // gently instead of in one burst.
  const CLASSIFY_GAP_MS = 400;

  // The eleven slide categories, in the order the story reads. Same
  // literals as /api/classify.
  const SLIDE_CATEGORIES = [
    "The Problem",
    "A Persona",
    "Why Now?",
    "The Team",
    "The Product",
    "How We Make Money",
    "Go to Market",
    "The Moat",
    "The Vision",
    "Competition",
    "The Ask",
  ];

  // The 7-hue rainbow cycle the old sidebar rows wore — a category
  // keeps its colour wherever it appears.
  const SLIDE_COLOR_CYCLE = [
    "var(--logo-pink)",
    "var(--logo-orange)",
    "var(--logo-yellow)",
    "var(--logo-leaf)",
    "var(--logo-sky)",
    "var(--logo-mint)",
    "var(--logo-purple)",
  ];

  function colorFor(category) {
    const i = SLIDE_CATEGORIES.indexOf(category);
    if (i < 0) return SLIDE_COLOR_CYCLE[0];
    return SLIDE_COLOR_CYCLE[i % SLIDE_COLOR_CYCLE.length];
  }

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

  // Every published, non-archived writing with words in it — essays and
  // quick statuses — oldest first. The raw material the story curates.
  function allWritings() {
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
        slide: typeof e.slide === "string" && SLIDE_CATEGORIES.includes(e.slide)
          ? e.slide
          : null,
        slideCheckedAt: Number(e.slideCheckedAt) || 0,
        pluck: Array.isArray(e.pluck)
          ? e.pluck.filter((x) => typeof x === "string" && x.trim())
          : undefined,
      }));
  }

  // Mechanical sentence split — the fallback when no pluck is stored
  // yet. No lookbehind (older iOS Safari).
  function splitSentences(body) {
    const matches = String(body || "").match(/[^.!?…\n]+[.!?…]*/g) || [];
    return matches.map((t) => t.trim()).filter(Boolean);
  }

  // The pitch sentences for one writing: the stored pluck (verbatim,
  // validated against the body at classify time) or, until the pluck
  // arrives, the first sentences of the body. Never more than
  // PLUCK_PER_SLIDE.
  function pitchSentencesFor(w) {
    const stored = Array.isArray(w.pluck)
      ? w.pluck.filter((s) => typeof s === "string" && s.trim())
      : [];
    if (stored.length) return stored.slice(0, PLUCK_PER_SLIDE);
    return splitSentences(w.body).slice(0, PLUCK_PER_SLIDE);
  }

  // The story: for each slide category, in slide order, the most
  // recent writing tagged with it — carrying its pitch sentences. At
  // most eleven pieces × two sentences; categories with nothing yet
  // simply don't appear.
  function storyPieces() {
    const byCategory = new Map();
    for (const w of allWritings()) { // oldest → newest, so later wins
      if (!w.slide) continue;
      byCategory.set(w.slide, w);
    }
    const out = [];
    for (const c of SLIDE_CATEGORIES) {
      const w = byCategory.get(c);
      if (w) out.push({ ...w, sentences: pitchSentencesFor(w) });
    }
    return out;
  }

  // Every writing in one slide category, newest first. The first entry
  // is the one the story/pitch shows; the rest are the founder's
  // earlier takes on the same slide.
  function essaysForSlide(category) {
    if (!SLIDE_CATEGORIES.includes(category)) return [];
    return allWritings()
      .filter((w) => w.slide === category)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Words in the pitch as shown — the plucked sentences, not the full
  // essays behind them.
  function wordCount() {
    let n = 0;
    for (const e of storyPieces()) {
      for (const s of e.sentences) n += s.trim().split(/\s+/).filter(Boolean).length;
    }
    return n;
  }

  function getLock() {
    return loadLock();
  }

  // The story has changed since the lock when the curated selection no
  // longer matches what was locked — a new category covered, or a newer
  // essay took over a category. [] when never locked.
  function grownSinceLock() {
    const lock = loadLock();
    if (!lock.lockedAt) return [];
    const known = new Set(lock.lockedEssayIds);
    return storyPieces().filter((e) => !known.has(e.id));
  }

  function sanitizeAsk(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) return null;
    return trimmed.length > MAX_ASK_LEN ? trimmed.slice(0, MAX_ASK_LEN) : trimmed;
  }

  // ── One-shot classifier ───────────────────────────────────────────
  //
  // Each writing is tagged once: POST /api/classify → essay.slide.
  // Recency does the rest — no re-clustering, no moving things around.
  // The tag is written back through the renderer's store so the essays
  // blob stays single-owner, then synced like any other essay edit.

  const classifyInflight = new Set();

  function needsTag(w) {
    if (!w.slide) return !w.slideCheckedAt;
    // Tagged before plucking existed → one more pass to get the pluck.
    return w.pluck === undefined;
  }

  async function classifyWriting(writing) {
    if (!writing || classifyInflight.has(writing.id)) return;
    const t = token();
    if (!t) return;
    classifyInflight.add(writing.id);
    let slide = null;
    let sentences = [];
    let ok = false;
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          writingId: writing.id,
          title: writing.title || undefined,
          body: writing.body,
        }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json && typeof json === "object") {
          ok = true;
          slide = typeof json.slide === "string" && SLIDE_CATEGORIES.includes(json.slide)
            ? json.slide
            : null;
          sentences = Array.isArray(json.sentences)
            ? json.sentences.filter((x) => typeof x === "string" && x.trim())
            : [];
        }
      }
    } catch { /* network — retry on a later sweep */ }
    classifyInflight.delete(writing.id);
    if (!ok) return;
    const store = window.tinkerStore;
    if (store && typeof store.setEssaySlide === "function") {
      store.setEssaySlide(writing.id, slide, sentences);
    }
    fire("tinker:story-changed");
  }

  let backfillRunning = false;

  // Tag anything that hasn't been looked at yet — new publishes land
  // here via tinker:writing-saved; older archives drain gently on
  // hydrate/sign-in.
  async function classifySweep() {
    if (backfillRunning) return;
    if (!token()) return;
    const queue = allWritings().filter(needsTag);
    if (!queue.length) return;
    backfillRunning = true;
    try {
      for (const w of queue) {
        await classifyWriting(w);
        await new Promise((r) => setTimeout(r, CLASSIFY_GAP_MS));
      }
    } finally {
      backfillRunning = false;
    }
  }

  // ── Team ──────────────────────────────────────────────────────────
  //
  // Suggestions come from /api/team/suggest: people who might be
  // answering a question this founder leaves unanswered in their
  // essays, matched on what those people are writing in theirs. The
  // reply carries my own question, their name + phone, and the
  // matcher's one-line why — never their words.
  //
  // The connection itself is the mutual $9 handshake, paid on beginner
  // (all payments surface there): sending someone $9 IS the connection
  // request; they accept by sending $9 back. /api/team/connections
  // reads the edges beginner's Stripe webhook wrote into the shared DB:
  //   connected — $9 both ways
  //   waiting   — I sent; they haven't sent back
  //   incoming  — they sent me $9; I accept by sending $9 back

  // The pre-handshake local-invite record is undone: the $9 IS the
  // invite now, and the handshake edges are the only truth. Any invite
  // stored by the short-lived "Invite onto your team" button is purged
  // — locally, and on the server so it clears on every device. The
  // localStorage key doubles as the one-time flag: once removed, the
  // purge never re-runs (sync no longer hydrates the team kind back).
  function purgeLegacyInvites() {
    let had = false;
    try { had = localStorage.getItem(TEAM_KEY) !== null; } catch { /* ignore */ }
    if (!had) return;
    try { localStorage.removeItem(TEAM_KEY); } catch { /* ignore */ }
    const t = token();
    if (!t) return;
    fetch("/api/user-data/team", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
      },
      body: JSON.stringify({ data: { invited: [] } }),
    }).catch(() => { /* best-effort — retried next boot if the key returns */ });
  }

  // One fetch per session (manual refresh = reopen the story later).
  let teamState = { status: "idle", suggestions: [], me: "", connections: [] };

  // The beginner page where the $9 actually moves (Apple Pay). `from`
  // carries my id so the webhook can record my side of the handshake.
  function sendLinkFor(userId) {
    let url = "https://beginner.work/tyler-lindow?u=" + encodeURIComponent(userId);
    if (teamState.me) url += "&from=" + encodeURIComponent(teamState.me);
    return url + "#send9";
  }

  function openSendLink(userId) {
    try { window.open(sendLinkFor(userId), "_blank", "noopener"); }
    catch { /* ignore */ }
  }

  function connectionFor(userId) {
    return teamState.connections.find((c) => c && c.userId === userId) || null;
  }

  function fetchTeam() {
    if (teamState.status !== "idle") return;
    const t = token();
    if (!t) return;
    teamState = { ...teamState, status: "loading" };
    const headers = { Authorization: `Bearer ${t}` };
    Promise.all([
      fetch("/api/team/suggest", { method: "GET", headers })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch("/api/team/connections", { method: "GET", headers })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]).then(([suggest, conns]) => {
      teamState = {
        status: "loaded",
        suggestions: (suggest && Array.isArray(suggest.suggestions)) ? suggest.suggestions : [],
        me: (conns && typeof conns.me === "string") ? conns.me : "",
        connections: (conns && Array.isArray(conns.connections)) ? conns.connections : [],
      };
      // Repaint if the founder is still looking at the pitch.
      ensureView();
      if (viewEl && !viewEl.hidden && viewMode === "pitch") renderView();
    });
  }

  // ── Lock it in ────────────────────────────────────────────────────
  //
  // One deliberate act: snapshot the curated story, keep the number,
  // publish the whole thing to the founder's public beginner profile
  // (the existing booklet row that profile already reads). After this
  // the story is in their pocket: phone out → story, number, QR.

  let lockInflight = false;

  async function lockIn(askValue) {
    if (lockInflight) return { ok: false, error: "Already locking" };
    const ask = sanitizeAsk(askValue);
    if (!ask) return { ok: false, error: "Type the number you're asking for first." };
    const pieces = storyPieces();
    if (!pieces.length) return { ok: false, error: "Write your first essay before locking in." };
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
            // The pitch as shown: the plucked sentences, verbatim.
            stories: pieces.map((e) => ({
              title: e.title || undefined,
              body: e.sentences.join("\n\n"),
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
      lockedEssayIds: pieces.map((e) => e.id),
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
  //
  // The pocket first (phone out → the number is right there), then the
  // story's pieces. Published work only — no in-progress anything.

  let navEl = null;
  let listEl = null;
  let countEl = null;
  let pocketEl = null;

  function ensureMount() {
    navEl = document.querySelector(".sidebar__story");
    if (!navEl) return;
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
    const pieces = storyPieces();
    const anyWriting = allWritings().length > 0;

    // Cold start: nothing published yet — the sidebar stays brand +
    // Account only, same as before.
    if (!anyWriting) {
      navEl.hidden = true;
      return;
    }
    navEl.hidden = false;

    if (countEl) {
      countEl.textContent = pieces.length
        ? `${pieces.length} of ${SLIDE_CATEGORIES.length} slides · ${wordCount().toLocaleString()} words`
        : "";
    }

    renderPocket(pieces);

    if (listEl) {
      listEl.innerHTML = "";
      for (const e of pieces) {
        const li = document.createElement("li");
        const btn = el("button", "sidebar__account-item sidebar__story-item");
        btn.type = "button";
        btn.setAttribute("data-essay-id", e.id);
        const kicker = el("span", "sidebar__story-kicker", e.slide);
        kicker.style.color = colorFor(e.slide);
        btn.appendChild(kicker);
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
    }

  }

  // The pocket block at the top of the story sidebar: the lock state at
  // a glance. Locked → the number, ready to pull out. Unlocked → the
  // invitation to read the story.
  function renderPocket(pieces) {
    if (!pocketEl) return;
    pocketEl.innerHTML = "";
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
          `${grown} ${grown === 1 ? "slide" : "slides"} changed since you locked it`,
        ));
      }
      card.addEventListener("click", () => {
        if (typeof window.tinkerShowStory === "function") window.tinkerShowStory();
      });
      pocketEl.appendChild(card);
    } else if (pieces.length) {
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
  // "pitch" (the story) or "slide" (a class view) — used to decide
  // whether an async suggestions arrival should repaint.
  let viewMode = "pitch";

  function ensureView() {
    viewEl = document.getElementById("story");
  }

  function formatLockedDate(ts) {
    const d = new Date(ts);
    try {
      return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    } catch { return d.toDateString(); }
  }

  // Render the curated story into #story. `anchorEssayId` scrolls that
  // piece into view after paint.
  function renderView(anchorEssayId) {
    ensureView();
    if (!viewEl) return;
    viewMode = "pitch";
    viewEl.innerHTML = "";
    const pieces = storyPieces();
    const lock = loadLock();

    // No header — the floating drawer toggle owns the top-left corner
    // on mobile, so the view starts straight at the first piece (each
    // piece already wears its category kicker). The ask lives in the
    // sidebar pocket and the lock block at the end.
    const inner = el("div", "story__inner");
    viewEl.appendChild(inner);

    if (!pieces.length) {
      const anyWriting = allWritings().length > 0;
      inner.appendChild(el(
        "p",
        "story__empty",
        anyWriting
          ? "Your writing is here — it's being matched to the slides of your story. Give it a moment, then come back."
          : "Your story hasn't started yet. Write your first essay and it will appear here, word for word.",
      ));
      return;
    }

    for (const e of pieces) {
      const article = el("article", "story__piece");
      article.id = `story-essay-${e.id}`;
      const takes = essaysForSlide(e.slide).length;
      const kicker = el(
        "button",
        "story__piece-kicker",
        takes > 1 ? `${e.slide} · ${takes} takes` : e.slide,
      );
      kicker.type = "button";
      kicker.style.color = colorFor(e.slide);
      kicker.setAttribute("aria-label", `All your ${e.slide} essays`);
      kicker.addEventListener("click", () => { renderSlideView(e.slide); });
      article.appendChild(kicker);
      // The plucked sentences ARE the pitch; the full essay is one tap
      // away (the whole piece below the kicker opens it).
      const open = el("button", "story__piece-open");
      open.type = "button";
      open.setAttribute("aria-label", `Read the whole essay`);
      if (e.title) open.appendChild(el("h2", "story__piece-title", e.title));
      const body = el("div", "story__piece-body");
      for (const sentence of e.sentences) {
        body.appendChild(el("p", null, sentence));
      }
      open.appendChild(body);
      open.addEventListener("click", () => {
        if (typeof window.tinkerOpenEssay === "function") window.tinkerOpenEssay(e.id);
      });
      article.appendChild(open);
      inner.appendChild(article);
    }

    const teamBlock = renderTeamBlock();
    if (teamBlock) inner.appendChild(teamBlock);
    fetchTeam();

    inner.appendChild(renderLockBlock(pieces, lock));

    if (anchorEssayId) {
      setTimeout(() => {
        const target = document.getElementById(`story-essay-${anchorEssayId}`);
        if (target && typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      }, 30);
    }
  }

  // Every essay in one slide category, newest first. The newest is the
  // one the pitch shows; older takes open in the read view. Rendered
  // into the same #story surface; the back link returns to the pitch.
  function renderSlideView(category) {
    ensureView();
    if (!viewEl) return;
    viewMode = "slide";
    const takes = essaysForSlide(category);
    viewEl.innerHTML = "";
    const inner = el("div", "story__inner");
    viewEl.appendChild(inner);

    const back = el("button", "story__slide-back", "← Your story");
    back.type = "button";
    back.addEventListener("click", () => { renderView(); });
    inner.appendChild(back);

    const title = el("h2", "story__slide-title", category);
    title.style.color = colorFor(category);
    inner.appendChild(title);

    if (!takes.length) {
      inner.appendChild(el("p", "story__empty", "Nothing on this slide yet."));
      return;
    }

    const list = el("div", "story__slide-list");
    for (let i = 0; i < takes.length; i++) {
      const w = takes[i];
      const row = el("button", "story__slide-row");
      row.type = "button";
      if (i === 0) {
        row.classList.add("story__slide-row--current");
        row.appendChild(el("span", "story__slide-current", "In your pitch"));
      }
      row.appendChild(el(
        "span",
        "story__slide-row-title",
        w.title || firstWords(w.body, 10),
      ));
      row.appendChild(el("span", "story__slide-row-date", formatLockedDate(w.createdAt)));
      row.addEventListener("click", () => {
        if (typeof window.tinkerOpenEssay === "function") window.tinkerOpenEssay(w.id);
      });
      list.appendChild(row);
    }
    inner.appendChild(list);
  }

  // "Invite others onto your team": suggestions (a name, phone, my
  // question, the matcher's why) and the handshake roster. The $9 IS
  // the invite — every button routes to beginner, where the payment
  // lives. Returns null when there's nothing to show yet.
  function renderTeamBlock() {
    const fresh = teamState.suggestions.filter((s) => s && !connectionFor(s.userId));
    const conns = teamState.connections;
    if (!fresh.length && !conns.length) return null;

    const block = el("section", "story__team");
    const kicker = el("p", "story__team-kicker", "The Team");
    kicker.style.color = colorFor("The Team");
    block.appendChild(kicker);
    block.appendChild(el("h3", "story__team-title", "Invite others onto your team"));

    if (fresh.length) {
      block.appendChild(el(
        "p",
        "story__team-sub",
        "People who might be answering a question you've left open. $9 connects you — they accept by sending $9 back.",
      ));
      for (const s of fresh) {
        const card = el("div", "story__team-card");
        const head = el("div", "story__team-head");
        head.appendChild(el("span", "story__team-name", s.name || "A founder"));
        if (s.phone) {
          const tel = el("a", "story__team-phone", s.phone);
          tel.href = `sms:${s.phone}`;
          head.appendChild(tel);
        }
        card.appendChild(head);
        if (s.question) {
          card.appendChild(el("span", "story__team-asked", "you asked"));
          card.appendChild(el("blockquote", "story__team-question", s.question));
        }
        if (s.reason) {
          card.appendChild(el("span", "story__team-asked", "why them"));
          card.appendChild(el("p", "story__team-reason", s.reason));
        }
        const btn = el("button", "story__team-invite", "Send $9 to connect");
        btn.type = "button";
        btn.addEventListener("click", () => { openSendLink(s.userId); });
        card.appendChild(btn);
        block.appendChild(card);
      }
    }

    if (conns.length) {
      block.appendChild(el("p", "story__team-sub", "Your team:"));
      const list = el("div", "story__team-roster");
      for (const c of conns) {
        const row = el("div", "story__team-member");
        row.appendChild(el("span", "story__team-name", c.name || "A founder"));
        if (c.state === "connected") {
          row.appendChild(el("span", "story__team-invited", "Connected"));
        } else if (c.state === "waiting") {
          row.appendChild(el(
            "span",
            "story__team-pending",
            "You sent $9 — they accept by sending $9 back",
          ));
        } else {
          row.appendChild(el("span", "story__team-pending", "Sent you $9"));
          const accept = el("button", "story__team-invite", "Send $9 back to accept");
          accept.type = "button";
          accept.addEventListener("click", () => { openSendLink(c.userId); });
          row.appendChild(accept);
        }
        list.appendChild(row);
      }
      block.appendChild(list);
    }
    return block;
  }

  // The end of the story: lock it in, or — once locked — the pocket.
  function renderLockBlock(pieces, lock) {
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
          `Your story has moved — ${grown} ${grown === 1 ? "slide has" : "slides have"} a newer take since you locked it.`,
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
    SLIDE_CATEGORIES: SLIDE_CATEGORIES.slice(),
    allWritings,
    storyPieces,
    essaysForSlide,
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

  window.addEventListener("tinker:hydrated", () => {
    renderNav();
    classifySweep();
  });
  window.addEventListener("tinker:auth-changed", () => {
    renderNav();
    classifySweep();
  });
  window.addEventListener("tinker:writing-saved", () => {
    renderNav();
    classifySweep();
  });
  window.addEventListener("tinker:story-changed", () => { renderNav(); });

  function boot() {
    purgeLegacyInvites();
    renderNav();
    classifySweep();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
