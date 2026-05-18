/* tinker — sidebar tree (Earth → Seed → Growth vector)
 *
 * The three-tier sidebar revamp lives here. The flat seed-card list
 * (heatmap.js → #home-list) is gone. In its place: a <nav> mounted at
 * #sidebar-tree that renders the founder's writing life as a quiet
 * curriculum-shaped tree.
 *
 *   01  Earth: home
 *       01  Seed: "the barber shop"
 *             Growth vector: "his hands"        (3)
 *             Growth vector: "the chair"
 *       02  Seed: "hop tinctures at 7am"
 *             Growth vector: "what I taste first"
 *   02  Earth: cafe
 *       ...
 *
 * Where the data comes from:
 *
 *  - On boot, the cached tree at localStorage["tinker.tree.v1"]
 *    (populated by sync.js's hydrate) renders instantly. While the
 *    user reads it, refresh() fires a background /api/cluster call.
 *  - After every writing-session close, renderer.js's publish path
 *    calls window.tinkerTree.refresh().
 *  - The clustering response replaces the cached tree, persists via
 *    sync.js (pushTree), and re-renders the sidebar.
 *  - If clustering fails or times out, the last cached tree stays on
 *    screen and a quiet "↻" affordance appears on the topmost Earth
 *    so the founder can retry by hand.
 *
 * Labels at every tier are verbatim phrases lifted from the founder's
 * own writings (or, at the Earth tier, the place names they've typed
 * into the welcome grid). No AI-authored chrome text inside the tree.
 *
 * Visual canon: reuses .sidebar__account-item's sizing / hover /
 * spacing for rows at every depth. Indentation encodes depth; the
 * quiet "01..NN" ordinals encode order on Earth and Seed rows only.
 * Growth vectors do not carry ordinals.
 */

(() => {
  "use strict";

  const STORAGE_TREE = "tinker.tree.v1";
  const STORAGE_DRAFTS = "tinker.drafts.v1";
  const STORAGE_ESSAYS = "tinker.essays.v1";
  const TREE_KEY = STORAGE_TREE;

  // [NEEDS INPUT] Open question Q1 from build-prompt: per-Earth min
  // writings threshold. Defaulting to 3 (the prompt's default) so the
  // clustering function knows what to filter on; the renderer doesn't
  // gate on this directly but exposes it for the API caller.
  const MIN_WRITINGS_PER_EARTH = 3;

  // ── State ──────────────────────────────────────────────────────────
  let tree = loadCachedTree();        // { earths: [...] } | null
  let inFlight = false;
  let lastError = null;
  let expandedEarths = new Set();      // ids
  let expandedSeeds = new Set();        // ids
  let expandedVectors = new Set();      // ids (growth vector ids whose multi-essay list is open)
  let activeRow = null;                 // { kind, id }
  let firstPaintDone = false;
  let mock = null;                      // optional mock blob, see installMock()

  function loadCachedTree() {
    try {
      const raw = localStorage.getItem(STORAGE_TREE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.earths)) return parsed;
      return null;
    } catch { return null; }
  }
  function saveCachedTree(blob) {
    try { localStorage.setItem(STORAGE_TREE, JSON.stringify(blob)); }
    catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushTree === "function") {
      window.tinkerSync.pushTree();
    }
  }

  // ── Public API ─────────────────────────────────────────────────────
  window.tinkerTree = {
    // Re-render from current state. Called after hydrate, refresh, and
    // any expand/collapse interaction.
    render() { render(); },
    // Kick a /api/cluster call. Idempotent — coalesces concurrent
    // requests via the inFlight flag.
    refresh() { return refresh(); },
    // Replace the rendered tree with a hard-coded mock blob. Used by
    // step 3 of the build sequence to verify the visual treatment
    // before the real clustering step lands. installMock(null) clears
    // the mock and falls back to the cached / API tree.
    installMock(blob) {
      mock = blob || null;
      render();
    },
    // Returns the tree currently on screen — cached blob, mock blob,
    // or null if neither is available.
    current() { return mock || tree; },
    // Visible-string audit (build step #6). Walks every text node
    // inside #sidebar-tree and verifies each is either:
    //   (a) a verbatim substring of one of the founder's writings;
    //   (b) one of the founder's existing Earth names; or
    //   (c) a chrome-allowlist string: \d{2} ordinal, "(N)" badge
    //       format, or the "↻" retry glyph.
    // Returns { ok, violations }. Intended for the console.
    audit() { return audit(); },
  };

  // ── Boot ───────────────────────────────────────────────────────────
  function boot() {
    render();
    // On hydrate, re-read from storage (sync.js may have overwritten
    // tinker.tree.v1) and re-render.
    window.addEventListener("tinker:hydrated", () => {
      tree = loadCachedTree();
      render();
      // After cache render on first paint, kick a background refresh
      // so the tree reflects whatever the founder has written since
      // the cache was last saved. Only on signed-in surfaces.
      if (!firstPaintDone) {
        firstPaintDone = true;
        refresh().catch(() => { /* surface via tiny retry affordance */ });
      }
    });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        firstPaintDone = true;
        refresh().catch(() => { /* surface via tiny retry affordance */ });
      }, { once: true });
    } else {
      firstPaintDone = true;
      refresh().catch(() => { /* surface via tiny retry affordance */ });
    }
  }

  // ── Refresh (live clustering) ─────────────────────────────────────
  async function refresh() {
    if (mock) return; // a mock is pinned; the live call would clobber it
    if (inFlight) return;
    if (!window.tinker || typeof window.tinker.callClaude !== "function") {
      // No callClaude shim available (likely no JWT yet); leave the
      // cached tree on screen. A later hydrate / auth-change will
      // re-kick us.
      return;
    }
    const writings = gatherWritings();
    if (writings.length === 0) {
      // No content at all: collapse to the empty state explicitly so a
      // returning user who deleted everything sees the empty sidebar
      // rather than a stale tree.
      tree = { earths: [] };
      saveCachedTree(tree);
      render();
      return;
    }
    inFlight = true;
    lastError = null;
    render(); // paint skeleton shimmer over current rows
    try {
      const token = (function () {
        try { return localStorage.getItem("tinker_jwt") || ""; } catch { return ""; }
      })();
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          writings,
          minWritingsPerEarth: MIN_WRITINGS_PER_EARTH,
        }),
      });
      if (!res.ok) {
        let detail = "";
        try { const j = await res.json(); detail = j.error || ""; } catch { /* ignore */ }
        throw new Error(detail || `Cluster ${res.status}`);
      }
      const json = await res.json();
      if (!json || !Array.isArray(json.earths)) {
        throw new Error("Invalid cluster response");
      }
      tree = { earths: json.earths };
      saveCachedTree(tree);
    } catch (err) {
      lastError = err;
      try { console.warn("[tinker] cluster failed:", err && err.message); }
      catch { /* ignore */ }
    } finally {
      inFlight = false;
      render();
    }
  }

  // Collect the founder's drafts + essays, stripping anything tagged
  // with a hidden earth. Hidden writings are not sent to the clustering
  // function (the function trusts its input per the build prompt).
  function gatherWritings() {
    let drafts = [];
    let essays = [];
    try {
      const raw = localStorage.getItem(STORAGE_DRAFTS);
      drafts = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(drafts)) drafts = [];
    } catch { drafts = []; }
    try {
      const raw = localStorage.getItem(STORAGE_ESSAYS);
      essays = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(essays)) essays = [];
    } catch { essays = []; }

    const isHidden = (name) =>
      window.tinkerEarths && typeof window.tinkerEarths.isHidden === "function"
        ? window.tinkerEarths.isHidden(name)
        : false;

    const out = [];
    for (const d of drafts) {
      if (!d || !d.earth) continue;
      if (isHidden(d.earth)) continue;
      const body = extractDraftBody(d);
      const title = (d.stitched && d.stitched.title) ||
        (d.title && d.title !== "Untitled draft" ? d.title : "");
      if (!body) continue;
      out.push({
        id: d.id,
        kind: "draft",
        earth: String(d.earth),
        title: String(title || ""),
        body,
        createdAt: d.updatedAt || d.createdAt || 0,
      });
    }
    for (const e of essays) {
      if (!e || !e.earth) continue;
      if (isHidden(e.earth)) continue;
      const body = String(e.body || "");
      if (!body) continue;
      out.push({
        id: e.id,
        kind: "essay",
        earth: String(e.earth),
        title: String(e.title || ""),
        body,
        createdAt: e.createdAt || 0,
      });
    }
    return out;
  }

  function extractDraftBody(draft) {
    const parts = [];
    if (Array.isArray(draft.transcript)) {
      for (const t of draft.transcript) {
        if (t && t.a) parts.push(String(t.a));
      }
    }
    if (draft.stitched && draft.stitched.body) parts.push(String(draft.stitched.body));
    return parts.join("\n\n");
  }

  // ── Render ─────────────────────────────────────────────────────────
  function render() {
    const mount = document.getElementById("sidebar-tree");
    if (!mount) return;

    const data = mock || tree;
    const earths = (data && Array.isArray(data.earths)) ? data.earths : [];

    // Cold-start empty: hide the nav entirely so the brand block sits
    // flush above the Account block. No placeholder, no CTA.
    if (earths.length === 0) {
      mount.hidden = true;
      mount.innerHTML = "";
      return;
    }
    mount.hidden = false;

    // Default expand state on the first paint with data: the most-
    // recently-used Earth (i.e. the first one, since the function
    // orders by most-recently-written-in) is open; the rest are
    // collapsed.
    if (expandedEarths.size === 0 && earths[0] && earths[0].earthId) {
      expandedEarths.add(earths[0].earthId);
    }

    mount.innerHTML = "";

    const list = document.createElement("ul");
    list.className = "sidebar__tree-list";

    earths.forEach((earth, idx) => {
      list.appendChild(renderEarth(earth, idx + 1, idx === 0));
    });

    mount.appendChild(list);
  }

  function renderEarth(earth, ordinal, isTopmost) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-node sidebar__tree-node--earth";

    const earthId = earth.earthId || earth.earthName || `e_${ordinal}`;
    const isExpanded = expandedEarths.has(earthId);
    const isActive = activeRow && activeRow.kind === "earth" && activeRow.id === earthId;

    const row = document.createElement("button");
    row.type = "button";
    row.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--earth";
    if (isActive) row.classList.add("is-active");
    row.setAttribute("aria-expanded", isExpanded ? "true" : "false");

    row.innerHTML =
      `<span class="sidebar__tree-ord" aria-hidden="true">${formatOrdinal(ordinal)}</span>` +
      `<span class="sidebar__tree-label">${escapeHtml(earth.earthName || "")}</span>`;

    // Tiny retry affordance on the topmost Earth row when clustering
    // last failed. Tap = re-fire refresh. The glyph itself ("↻") is
    // on the (c) chrome allowlist in the build prompt's visible-string
    // audit step.
    if (isTopmost && lastError) {
      const retry = document.createElement("span");
      retry.className = "sidebar__tree-retry";
      retry.setAttribute("role", "button");
      retry.setAttribute("tabindex", "0");
      retry.setAttribute("aria-label", "Retry");
      retry.textContent = "↻";
      retry.addEventListener("click", (e) => {
        e.stopPropagation();
        refresh();
      });
      retry.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); refresh(); }
      });
      row.appendChild(retry);
    }

    row.addEventListener("click", () => {
      if (expandedEarths.has(earthId)) expandedEarths.delete(earthId);
      else expandedEarths.add(earthId);
      activeRow = { kind: "earth", id: earthId };
      render();
    });
    li.appendChild(row);

    if (isExpanded && Array.isArray(earth.seeds) && earth.seeds.length) {
      const inner = document.createElement("ul");
      inner.className = "sidebar__tree-list sidebar__tree-list--seeds";
      earth.seeds.forEach((seed, sIdx) => {
        inner.appendChild(renderSeed(seed, sIdx + 1, earthId));
      });
      li.appendChild(inner);
    }
    return li;
  }

  function renderSeed(seed, ordinal, earthId) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-node sidebar__tree-node--seed";

    const seedId = seed.seedId || `${earthId}_s_${ordinal}`;
    const isExpanded = expandedSeeds.has(seedId);
    const isActive = activeRow && activeRow.kind === "seed" && activeRow.id === seedId;

    const row = document.createElement("button");
    row.type = "button";
    row.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--seed";
    if (isActive) row.classList.add("is-active");
    row.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    row.innerHTML =
      `<span class="sidebar__tree-ord" aria-hidden="true">${formatOrdinal(ordinal)}</span>` +
      `<span class="sidebar__tree-label">${escapeHtml(seed.label || "")}</span>`;

    row.addEventListener("click", () => {
      if (expandedSeeds.has(seedId)) expandedSeeds.delete(seedId);
      else expandedSeeds.add(seedId);
      activeRow = { kind: "seed", id: seedId };
      render();
    });
    li.appendChild(row);

    if (isExpanded && Array.isArray(seed.growthVectors) && seed.growthVectors.length) {
      const inner = document.createElement("ul");
      inner.className = "sidebar__tree-list sidebar__tree-list--vectors";
      seed.growthVectors.forEach((gv, gIdx) => {
        inner.appendChild(renderVector(gv, seedId, gIdx));
      });
      li.appendChild(inner);
    }
    return li;
  }

  function renderVector(vector, seedId, gIdx) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-node sidebar__tree-node--vector";

    const vectorId = vector.vectorId || `${seedId}_v_${gIdx}`;
    const writingIds = Array.isArray(vector.writingIds) ? vector.writingIds : [];
    const count = writingIds.length;
    const hasBadge = count >= 2;
    const isExpanded = hasBadge && expandedVectors.has(vectorId);
    const isActive = activeRow && activeRow.kind === "vector" && activeRow.id === vectorId;

    const row = document.createElement("button");
    row.type = "button";
    row.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--vector";
    if (isActive) row.classList.add("is-active");
    if (hasBadge) row.setAttribute("aria-expanded", isExpanded ? "true" : "false");

    const badge = hasBadge
      ? `<span class="sidebar__tree-badge" aria-hidden="true">(${count})</span>`
      : "";
    row.innerHTML =
      `<span class="sidebar__tree-label">${escapeHtml(vector.label || "")}</span>` +
      badge;

    row.addEventListener("click", () => {
      activeRow = { kind: "vector", id: vectorId };
      if (hasBadge) {
        if (expandedVectors.has(vectorId)) expandedVectors.delete(vectorId);
        else expandedVectors.add(vectorId);
        render();
        return;
      }
      // Single-writing vector → open straight away.
      const wid = writingIds[0];
      if (wid) openWriting(wid);
      render();
    });
    li.appendChild(row);

    if (isExpanded) {
      const inner = document.createElement("ul");
      inner.className = "sidebar__tree-list sidebar__tree-list--writings";
      const titles = resolveWritingTitles(writingIds);
      titles.forEach((entry) => {
        const childLi = document.createElement("li");
        childLi.className = "sidebar__tree-node sidebar__tree-node--writing";
        const childRow = document.createElement("button");
        childRow.type = "button";
        childRow.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--writing";
        const isActiveChild = activeRow && activeRow.kind === "writing" && activeRow.id === entry.id;
        if (isActiveChild) childRow.classList.add("is-active");
        childRow.innerHTML = `<span class="sidebar__tree-label">${escapeHtml(entry.title)}</span>`;
        childRow.addEventListener("click", () => {
          activeRow = { kind: "writing", id: entry.id };
          openWriting(entry.id);
          render();
        });
        childLi.appendChild(childRow);
        inner.appendChild(childLi);
      });
      li.appendChild(inner);
    }
    return li;
  }

  function resolveWritingTitles(writingIds) {
    const out = [];
    let drafts = [];
    let essays = [];
    try { drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]"); } catch { drafts = []; }
    try { essays = JSON.parse(localStorage.getItem(STORAGE_ESSAYS) || "[]"); } catch { essays = []; }
    const idx = new Map();
    if (Array.isArray(drafts)) for (const d of drafts) {
      if (!d || !d.id) continue;
      const title = (d.stitched && d.stitched.title) ||
        (d.title && d.title !== "Untitled draft" ? d.title : "");
      idx.set(d.id, title || "");
    }
    if (Array.isArray(essays)) for (const e of essays) {
      if (!e || !e.id) continue;
      idx.set(e.id, e.title || "");
    }
    for (const id of writingIds) {
      const title = idx.get(id);
      if (title) out.push({ id, title });
    }
    return out;
  }

  function openWriting(id) {
    // Heuristic on the id prefix matches renderer.js's uid generators.
    if (typeof id === "string" && id.startsWith("e_")) {
      if (typeof window.tinkerOpenEssay === "function") window.tinkerOpenEssay(id);
      return;
    }
    if (typeof id === "string" && id.startsWith("d_")) {
      if (typeof window.tinkerResumeDraft === "function") window.tinkerResumeDraft(id);
      return;
    }
    // Unknown shape — try both in order.
    if (typeof window.tinkerOpenEssay === "function") window.tinkerOpenEssay(id);
  }

  // Zero-padded two-digit. Three-digit ordinals are unexpected in
  // practice (Earths cap at 5, Seeds at 5 per Earth) — let them
  // render without padding adjustment if one slips through.
  function formatOrdinal(n) {
    if (n < 10) return "0" + n;
    return String(n);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // ── Audit (visible-string check) ──────────────────────────────────
  // The build prompt's step 6: every text node inside the tree must
  // trace to either (a) a verbatim substring of one of the founder's
  // own writings, (b) one of the founder's existing Earth names, or
  // (c) one of three chrome-allowlist strings: a \d{2} ordinal, the
  // "(N)" count-badge format, or the "↻" retry glyph.
  function audit() {
    const mount = document.getElementById("sidebar-tree");
    if (!mount) return { ok: true, violations: [] };

    // Load corpora.
    let drafts = [];
    let essays = [];
    try { drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]"); } catch { drafts = []; }
    try { essays = JSON.parse(localStorage.getItem(STORAGE_ESSAYS) || "[]"); } catch { essays = []; }
    const writingCorpus = [];
    for (const d of drafts) {
      if (!d) continue;
      if (Array.isArray(d.transcript)) {
        for (const t of d.transcript) if (t && t.a) writingCorpus.push(String(t.a));
      }
      if (d.stitched && d.stitched.body) writingCorpus.push(String(d.stitched.body));
      if (d.title) writingCorpus.push(String(d.title));
      if (d.stitched && d.stitched.title) writingCorpus.push(String(d.stitched.title));
    }
    for (const e of essays) {
      if (!e) continue;
      if (e.body) writingCorpus.push(String(e.body));
      if (e.title) writingCorpus.push(String(e.title));
    }
    const corpus = writingCorpus.join("\n");

    const earthNames = new Set();
    if (window.tinkerEarths && typeof window.tinkerEarths.list === "function") {
      for (const e of window.tinkerEarths.list()) {
        if (e && e.name) earthNames.add(String(e.name));
      }
    }

    // Chrome allowlist: two-digit ordinal, (N) badge format,
    // ↻ retry glyph. Whitespace-only nodes pass trivially.
    const ORD = /^\d{2,3}$/;
    const BADGE = /^\(\d+\)$/;
    const RETRY = "↻";

    const violations = [];
    const walker = document.createTreeWalker(mount, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const raw = (node.nodeValue || "");
      const text = raw.trim();
      if (!text) continue;
      if (ORD.test(text)) continue;
      if (BADGE.test(text)) continue;
      if (text === RETRY) continue;
      if (earthNames.has(text)) continue;
      if (corpus.includes(text)) continue;
      violations.push({ text, parentClass: node.parentElement && node.parentElement.className });
    }
    return { ok: violations.length === 0, violations };
  }

  boot();
})();
