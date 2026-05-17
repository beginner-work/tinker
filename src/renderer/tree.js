/* tinker — sidebar tree (Earth → Seed → Growth vector)
 *
 * The v0.101 sidebar revamp's centerpiece. Replaces the flat seed-card
 * list that used to live in #home-list with a three-tier mirror of
 * the founder's writing life:
 *
 *   Earth         — a place they write from (e.g. "home", "cafe").
 *                   The top-level rows.
 *   Seed          — an AI-derived topic cluster inside an Earth.
 *                   Verbatim phrase lifted from one of the founder's
 *                   writings under that Earth. 2–5 per Earth.
 *   Growth vector — a more specific topic inside a Seed. Verbatim
 *                   phrase too. Tap opens the underlying writing —
 *                   or, when multiple writings share the same
 *                   growth vector, expands a small list to choose
 *                   from.
 *
 * Storage shape (localStorage["tinker.tree.v1"], same shape returned
 * by /api/cluster):
 *   {
 *     updatedAt: number,
 *     earths: [
 *       {
 *         earthId: string,        // normalised Earth key
 *         earthName: string,      // display name (verbatim user input)
 *         seeds: [
 *           {
 *             label: string,            // verbatim substring of a writing
 *             sourceWritingId: string,  // draft or essay id
 *             sourceOffset: number,
 *             sourceLength: number,
 *             growthVectors: [
 *               {
 *                 label: string,
 *                 sourceWritingId: string,
 *                 sourceOffset: number,
 *                 sourceLength: number,
 *                 writingIds: string[], // 1+ drafts/essays
 *               },
 *               ...
 *             ],
 *           },
 *           ...
 *         ],
 *       },
 *       ...
 *     ],
 *   }
 *
 * Empty branches are dropped server-side. If `earths` is empty, the
 * <nav> is hidden entirely — cold-start users see brand + Account +
 * footer with nothing between.
 */

(() => {
  "use strict";

  const STORAGE_TREE = "tinker.tree.v1";
  const STORAGE_DRAFTS = "tinker.drafts.v1";
  const STORAGE_ESSAYS = "tinker.essays.v1";
  const TOKEN_KEY = "tinker_jwt";
  const STALE_MS = 24 * 60 * 60 * 1000;

  const mountEl = document.getElementById("sidebar-tree");

  // Per-render UI state. Survives re-renders for the lifetime of the
  // session; cleared on hydration so a sync from another device
  // doesn't keep the wrong row expanded.
  let expandedEarths = new Set();
  let expandedSeeds = new Set();
  let expandedGrowthVectors = new Set();
  let lastTree = null;
  let isRefreshing = false;
  let lastError = null;

  function loadTree() {
    try {
      const raw = localStorage.getItem(STORAGE_TREE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.earths)) return null;
      return parsed;
    } catch { return null; }
  }
  function saveTree(tree) {
    try { localStorage.setItem(STORAGE_TREE, JSON.stringify(tree)); }
    catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushTree === "function") {
      window.tinkerSync.pushTree();
    }
  }

  // ── Default expand state ──────────────────────────────────────────
  // First paint: open the most-recently-used Earth, leave the rest
  // collapsed. The MRU is the Earth whose latest underlying writing
  // has the highest timestamp. Calculated against the cached drafts/
  // essays so this works before any clustering has run.
  function pickMruEarth(tree) {
    if (!tree || !Array.isArray(tree.earths) || !tree.earths.length) return null;
    const writingTimes = new Map();
    try {
      const drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]");
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          if (d && d.id) writingTimes.set(d.id, d.updatedAt || d.createdAt || 0);
        }
      }
    } catch { /* ignore */ }
    try {
      const essays = JSON.parse(localStorage.getItem(STORAGE_ESSAYS) || "[]");
      if (Array.isArray(essays)) {
        for (const e of essays) {
          if (e && e.id) writingTimes.set(e.id, e.createdAt || 0);
        }
      }
    } catch { /* ignore */ }

    let bestEarth = null;
    let bestTime = -1;
    for (const earth of tree.earths) {
      let earthBest = 0;
      for (const seed of earth.seeds || []) {
        for (const gv of seed.growthVectors || []) {
          for (const wId of gv.writingIds || []) {
            const t = writingTimes.get(wId) || 0;
            if (t > earthBest) earthBest = t;
          }
        }
      }
      if (earthBest > bestTime) {
        bestTime = earthBest;
        bestEarth = earth.earthId;
      }
    }
    return bestEarth;
  }

  // ── Rendering ─────────────────────────────────────────────────────
  function render() {
    if (!mountEl) return;
    const tree = lastTree || loadTree();

    if (!tree || !tree.earths || tree.earths.length === 0) {
      mountEl.innerHTML = "";
      mountEl.hidden = true;
      return;
    }

    // First-paint default: open MRU Earth if nothing's been touched yet.
    if (expandedEarths.size === 0) {
      const mru = pickMruEarth(tree);
      if (mru) expandedEarths.add(mru);
    }

    mountEl.hidden = false;
    if (isRefreshing) {
      mountEl.dataset.refreshing = "1";
    } else {
      delete mountEl.dataset.refreshing;
    }

    const earthsList = document.createElement("ul");
    earthsList.className = "sidebar__tree-list sidebar__tree-list--earths";

    for (const earth of tree.earths) {
      earthsList.appendChild(renderEarth(earth));
    }

    mountEl.innerHTML = "";
    if (lastError) {
      // Tiny retry affordance next to the topmost Earth. The `↻` glyph
      // is in the allowed-strings list (developer chrome, not AI
      // output) — see the visible-string audit in the build spec.
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "sidebar__tree-retry";
      retry.title = "Refresh";
      retry.setAttribute("aria-label", "Refresh sidebar tree");
      retry.textContent = "↻";
      retry.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        refresh({ manual: true });
      });
      mountEl.appendChild(retry);
    }
    mountEl.appendChild(earthsList);
  }

  function renderEarth(earth) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-earth";
    if (expandedEarths.has(earth.earthId)) li.dataset.expanded = "1";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--earth";
    btn.setAttribute("aria-expanded", expandedEarths.has(earth.earthId) ? "true" : "false");
    btn.innerHTML =
      `<span class="sidebar__tree-twirl" aria-hidden="true"></span>` +
      `<span class="sidebar__account-label sidebar__tree-label">${escapeHtml(earth.earthName)}</span>`;
    btn.addEventListener("click", () => {
      if (expandedEarths.has(earth.earthId)) expandedEarths.delete(earth.earthId);
      else expandedEarths.add(earth.earthId);
      render();
    });
    li.appendChild(btn);

    if (expandedEarths.has(earth.earthId) && Array.isArray(earth.seeds) && earth.seeds.length) {
      const ul = document.createElement("ul");
      ul.className = "sidebar__tree-list sidebar__tree-list--seeds";
      for (let i = 0; i < earth.seeds.length; i++) {
        ul.appendChild(renderSeed(earth.earthId, i, earth.seeds[i]));
      }
      li.appendChild(ul);
    }
    return li;
  }

  function renderSeed(earthId, idx, seed) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-seed";
    const seedKey = `${earthId}:${idx}`;
    if (expandedSeeds.has(seedKey)) li.dataset.expanded = "1";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--seed";
    btn.setAttribute("aria-expanded", expandedSeeds.has(seedKey) ? "true" : "false");
    btn.innerHTML =
      `<span class="sidebar__tree-twirl" aria-hidden="true"></span>` +
      `<span class="sidebar__account-label sidebar__tree-label">${escapeHtml(seed.label)}</span>`;
    btn.addEventListener("click", () => {
      if (expandedSeeds.has(seedKey)) expandedSeeds.delete(seedKey);
      else expandedSeeds.add(seedKey);
      render();
    });
    li.appendChild(btn);

    if (expandedSeeds.has(seedKey) && Array.isArray(seed.growthVectors) && seed.growthVectors.length) {
      const ul = document.createElement("ul");
      ul.className = "sidebar__tree-list sidebar__tree-list--gvs";
      for (let i = 0; i < seed.growthVectors.length; i++) {
        ul.appendChild(renderGrowthVector(earthId, idx, i, seed.growthVectors[i]));
      }
      li.appendChild(ul);
    }
    return li;
  }

  function renderGrowthVector(earthId, seedIdx, gvIdx, gv) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-gv";
    const gvKey = `${earthId}:${seedIdx}:${gvIdx}`;
    const count = Array.isArray(gv.writingIds) ? gv.writingIds.length : 0;
    const hasBadge = count >= 2;
    const isExpanded = expandedGrowthVectors.has(gvKey);
    if (isExpanded) li.dataset.expanded = "1";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--gv";

    let inner =
      `<span class="sidebar__tree-twirl ${hasBadge ? "sidebar__tree-twirl--chevron" : "sidebar__tree-twirl--dot"}" aria-hidden="true"></span>` +
      `<span class="sidebar__account-label sidebar__tree-label">${escapeHtml(gv.label)}</span>`;
    if (hasBadge) {
      // (N) — chrome glyph, allowed by the build spec.
      inner += `<span class="sidebar__tree-badge">(${count})</span>`;
    }
    btn.innerHTML = inner;

    btn.addEventListener("click", () => {
      if (hasBadge) {
        if (isExpanded) expandedGrowthVectors.delete(gvKey);
        else expandedGrowthVectors.add(gvKey);
        render();
        return;
      }
      // Single underlying writing: open it.
      openWriting(gv.writingIds && gv.writingIds[0]);
    });
    li.appendChild(btn);

    if (hasBadge && isExpanded) {
      const ul = document.createElement("ul");
      ul.className = "sidebar__tree-list sidebar__tree-list--writings";
      for (const wid of gv.writingIds || []) {
        ul.appendChild(renderWritingRow(wid));
      }
      li.appendChild(ul);
    }
    return li;
  }

  function renderWritingRow(writingId) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-writing";
    const writing = resolveWriting(writingId);
    if (!writing) {
      // Underlying writing was deleted between cluster runs. Drop the
      // row entirely rather than render a placeholder string (which
      // would fail the visible-string audit).
      return li;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--writing";
    btn.innerHTML =
      `<span class="sidebar__tree-twirl sidebar__tree-twirl--dot" aria-hidden="true"></span>` +
      `<span class="sidebar__account-label sidebar__tree-label">${escapeHtml(writing.title)}</span>`;
    btn.addEventListener("click", () => openWriting(writingId));
    li.appendChild(btn);
    return li;
  }

  function resolveWriting(writingId) {
    if (!writingId) return null;
    try {
      const drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]");
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          if (d && d.id === writingId) {
            const title = (d.stitched && d.stitched.title) || d.title || null;
            // No title → skip. Renders nothing instead of an
            // AI/developer-authored placeholder.
            if (!title || title === "Untitled draft") return null;
            return { kind: "draft", id: d.id, title };
          }
        }
      }
    } catch { /* ignore */ }
    try {
      const essays = JSON.parse(localStorage.getItem(STORAGE_ESSAYS) || "[]");
      if (Array.isArray(essays)) {
        for (const e of essays) {
          if (e && e.id === writingId) {
            if (!e.title) return null;
            return { kind: "essay", id: e.id, title: e.title };
          }
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  function openWriting(writingId) {
    if (!writingId) return;
    try {
      const essays = JSON.parse(localStorage.getItem(STORAGE_ESSAYS) || "[]");
      if (Array.isArray(essays) && essays.some((e) => e && e.id === writingId)) {
        if (typeof window.tinkerOpenEssay === "function") {
          window.tinkerOpenEssay(writingId);
          return;
        }
      }
    } catch { /* ignore */ }
    try {
      const drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]");
      if (Array.isArray(drafts) && drafts.some((d) => d && d.id === writingId)) {
        if (typeof window.tinkerResumeDraft === "function") {
          window.tinkerResumeDraft(writingId);
        }
      }
    } catch { /* ignore */ }
  }

  // ── Refresh from server ───────────────────────────────────────────
  // Builds the request payload (drafts + essays, hidden Earths
  // filtered out), POSTs to /api/cluster, and updates the cache.
  async function refresh() {
    const token = (() => {
      try { return localStorage.getItem(TOKEN_KEY) || ""; }
      catch { return ""; }
    })();
    if (!token) return;
    if (isRefreshing) return;

    isRefreshing = true;
    render();

    try {
      const payload = buildClusterPayload();
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`cluster ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.earths)) {
        throw new Error("cluster response shape");
      }
      const next = { updatedAt: Date.now(), earths: data.earths };
      lastTree = next;
      lastError = null;
      saveTree(next);
      // Prune expanded keys that no longer exist in the new tree so
      // a stale UI state doesn't ghost-expand removed rows.
      const validEarthIds = new Set(next.earths.map((e) => e.earthId));
      expandedEarths = new Set([...expandedEarths].filter((id) => validEarthIds.has(id)));
      expandedSeeds = new Set([...expandedSeeds].filter((k) => validEarthIds.has(k.split(":")[0])));
      expandedGrowthVectors = new Set([...expandedGrowthVectors].filter((k) => validEarthIds.has(k.split(":")[0])));
    } catch (err) {
      // Silent fallback: keep the previous cached tree on screen, but
      // surface the tiny retry affordance so the founder can force a
      // recompute. No "couldn't refresh" string — that would be an
      // AI/developer-authored visible string inside the tree.
      lastError = err;
    } finally {
      isRefreshing = false;
      render();
    }
  }

  function buildClusterPayload() {
    // Pull drafts + essays, drop any whose Earth is in the hidden set.
    const hidden = (window.tinkerEarths && typeof window.tinkerEarths.hidden === "function")
      ? window.tinkerEarths.hidden()
      : new Set();
    const normalize = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

    const writings = [];
    try {
      const drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]");
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          if (!d || !d.id || !d.earth) continue;
          if (hidden.has(normalize(d.earth))) continue;
          const title = (d.stitched && d.stitched.title) || (d.title && d.title !== "Untitled draft" ? d.title : null);
          const body = (d.stitched && d.stitched.body) || extractDraftBody(d);
          if (!body) continue;
          writings.push({
            id: d.id,
            kind: "draft",
            earth: String(d.earth).trim(),
            title: title || null,
            body: String(body),
            createdAt: d.createdAt || 0,
            updatedAt: d.updatedAt || d.createdAt || 0,
          });
        }
      }
    } catch { /* ignore */ }
    try {
      const essays = JSON.parse(localStorage.getItem(STORAGE_ESSAYS) || "[]");
      if (Array.isArray(essays)) {
        for (const e of essays) {
          if (!e || !e.id || !e.earth) continue;
          if (hidden.has(normalize(e.earth))) continue;
          if (!e.body) continue;
          writings.push({
            id: e.id,
            kind: e.kind === "status" ? "status" : "essay",
            earth: String(e.earth).trim(),
            title: e.title || null,
            body: String(e.body),
            createdAt: e.createdAt || 0,
            updatedAt: e.createdAt || 0,
          });
        }
      }
    } catch { /* ignore */ }
    return { writings };
  }

  function extractDraftBody(draft) {
    if (!draft) return "";
    const parts = [];
    if (Array.isArray(draft.transcript)) {
      for (const t of draft.transcript) {
        if (t && t.a) parts.push(String(t.a));
      }
    }
    return parts.join("\n\n").slice(0, 8000);
  }

  // ── Helpers ──────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // ── Public API ───────────────────────────────────────────────────
  window.tinkerTree = {
    render,
    refresh,
  };

  // First paint: load from cache and render. The empty-state branch
  // inside render() handles "no tree yet" by hiding the <nav>.
  lastTree = loadTree();
  render();

  // Hydration arrived from the server — re-read cache and re-render.
  // Reset the expand state so the MRU-Earth default re-applies on
  // the freshly-hydrated tree. If the cache is still missing or
  // stale (and the user has actual writings), kick a refresh so the
  // tree populates instead of staying empty. This is the critical
  // path for a returning user whose drafts/essays just landed via
  // hydrate but whose tree was never cached server-side.
  window.addEventListener("tinker:hydrated", () => {
    expandedEarths = new Set();
    expandedSeeds = new Set();
    expandedGrowthVectors = new Set();
    lastTree = loadTree();
    render();

    if (shouldRefreshOnHydrate()) {
      refresh().catch(() => { /* ignore */ });
    }
  });

  function shouldRefreshOnHydrate() {
    const cached = loadTree();
    if (cached && cached.updatedAt && (Date.now() - cached.updatedAt) <= STALE_MS) {
      return false;
    }
    // Only spend a cluster call if the user actually has writings.
    // Otherwise the API returns { earths: [] } and we burn a request.
    return hasAnyEarthAssignedWritings();
  }

  function hasAnyEarthAssignedWritings() {
    try {
      const drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]");
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          if (d && d.earth && (d.stitched || (Array.isArray(d.transcript) && d.transcript.length))) {
            return true;
          }
        }
      }
    } catch { /* ignore */ }
    try {
      const essays = JSON.parse(localStorage.getItem(STORAGE_ESSAYS) || "[]");
      if (Array.isArray(essays)) {
        for (const e of essays) {
          if (e && e.earth && e.body) return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  // Auth landed → kick a refresh so a fresh sign-in pulls the latest
  // tree even if the cached one is empty (or stale from another
  // device's clustering). Best-effort; swallow errors.
  window.addEventListener("tinker:auth-changed", () => {
    refresh().catch(() => { /* ignore */ });
  });

  // The tinker:hydrated path above is the primary refresh trigger for
  // the typical web user (auth gate → hydrate fires → tree populates).
  // This boot timer is the fallback for environments where hydrate
  // never fires (Electron desktop without a Stytch token, or a stale
  // cached tree that hydration didn't touch).
  setTimeout(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (!t) return;
      const cached = loadTree();
      if (cached && cached.updatedAt && (Date.now() - cached.updatedAt) <= STALE_MS) return;
      if (!hasAnyEarthAssignedWritings()) return;
      refresh().catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }, 1500);
})();
