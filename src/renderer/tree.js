/* tinker — sidebar tree (Earth → Seed → Growth vector)
 *
 * Owns the slot between .sidebar__top and .sidebar__account. Reads
 * the cached cluster blob at localStorage["tinker.tree.v1"], renders
 * a three-tier tree from it, and hides the <nav> entirely when the
 * cluster is empty (cold-start). The cluster recompute itself lives
 * in refresh() — fired from the writing-session close handler and
 * from the publish flow.
 *
 * Shape persisted at tinker.tree.v1 (and round-tripped through
 * /api/user-data/tree via sync.js):
 *
 *   {
 *     earths: [
 *       {
 *         earthId:   string,   // normalised Earth key
 *         earthName: string,   // verbatim place name as typed by founder
 *         seeds: [
 *           {
 *             label: string,           // verbatim substring of a writing
 *             sourceWritingId: string, // id of that writing
 *             sourceOffset: number,
 *             sourceLength: number,
 *             growthVectors: [
 *               {
 *                 label: string,
 *                 sourceWritingId: string,
 *                 sourceOffset: number,
 *                 sourceLength: number,
 *                 writingIds: string[],   // 1+ writings under this vector
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
 * Public API:
 *   window.tinkerTree.render(mountEl)  — paint from cache
 *   window.tinkerTree.refresh()         — recompute via /api/cluster
 *   window.tinkerTree.lastError()       — last refresh error, if any
 */

(() => {
  "use strict";

  const LS_TREE = "tinker.tree.v1";
  const LS_DRAFTS = "tinker.drafts.v1";
  const LS_ESSAYS = "tinker.essays.v1";

  // Track open/collapsed state per Earth and per Seed (path-keyed) so
  // toggling survives re-renders. Defaults: most-recent Earth open,
  // all Seeds collapsed. Cleared on hydrate so a second device opens
  // to its own default.
  const expanded = {
    earths: new Set(),   // earthId
    seeds: new Set(),    // earthId + "::" + seedIndex
    vectors: new Set(),  // earthId + "::" + seedIndex + "::" + vectorIndex
  };
  let defaulted = false;

  let lastError = null;
  let refreshing = false;
  let mockMode = false;
  let mountRef = null;
  // One-shot guard: existing users who arrive at the new deploy with
  // writings already in localStorage have a null `tinker.tree.v1` cache
  // (clustering has never run for them). Without this kick, the sidebar
  // reads as empty until their next writing-session close — which is
  // exactly the "empty sidebar on load" symptom. The flag is reset on
  // hydrate so a fresh sign-in re-checks the new state.
  let kickedInitialRefresh = false;

  function loadCachedTree() {
    if (mockMode) return MOCK_TREE;
    try {
      const raw = localStorage.getItem(LS_TREE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.earths)) return null;
      return parsed;
    } catch { return null; }
  }

  function hasAnyWritings() {
    try {
      const drafts = JSON.parse(localStorage.getItem(LS_DRAFTS) || "[]");
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          if (d && d.earth && (d.stitched?.body || (Array.isArray(d.transcript) && d.transcript.some((t) => t && t.a)))) {
            return true;
          }
        }
      }
    } catch { /* ignore */ }
    try {
      const essays = JSON.parse(localStorage.getItem(LS_ESSAYS) || "[]");
      if (Array.isArray(essays)) {
        for (const e of essays) {
          if (e && e.earth && e.body) return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  function hasToken() {
    try { return !!localStorage.getItem("tinker_jwt"); }
    catch { return false; }
  }

  // Fire a one-shot refresh on first render if the cache is empty but
  // we have writings (and a session) to cluster. Without this, an
  // existing user landing on the new deploy sees a blank sidebar until
  // they close their next writing session.
  function maybeKickInitialRefresh() {
    if (kickedInitialRefresh) return;
    if (mockMode) return;
    if (refreshing) return;
    if (loadCachedTree()) return; // already have cached data
    if (!hasToken()) return;       // not signed in yet — wait for hydrate
    if (!hasAnyWritings()) return; // genuinely cold-start
    kickedInitialRefresh = true;
    // Defer past the current paint so the empty-state render lands
    // first; the skeleton shimmer takes over once refresh() flips
    // `refreshing` true and re-renders.
    setTimeout(() => { refresh(); }, 0);
  }

  function saveCachedTree(tree) {
    try { localStorage.setItem(LS_TREE, JSON.stringify(tree)); } catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushTree === "function") {
      window.tinkerSync.pushTree();
    }
  }

  function loadWritings() {
    const out = { drafts: [], essays: [] };
    try {
      const d = JSON.parse(localStorage.getItem(LS_DRAFTS) || "[]");
      if (Array.isArray(d)) out.drafts = d;
    } catch { /* ignore */ }
    try {
      const e = JSON.parse(localStorage.getItem(LS_ESSAYS) || "[]");
      if (Array.isArray(e)) out.essays = e;
    } catch { /* ignore */ }
    return out;
  }

  // Build a quick lookup so render() can resolve writing titles for
  // multi-vector inline lists without re-scanning every render.
  //
  // Visible-string discipline: every title that lands in this map must
  // be verbatim founder-authored text — either a stitched title (which
  // the writing engine picks as a contiguous phrase the founder typed)
  // or the first sentence of their first answer / body. A writing with
  // no recoverable founder text is omitted; the inline picker filters
  // to valid index entries, so the row simply doesn't render.
  function indexWritings({ drafts, essays }) {
    const map = new Map();
    for (const d of drafts) {
      if (!d || !d.id) continue;
      const stitched = (d.stitched && d.stitched.title && String(d.stitched.title).trim()) || "";
      // d.title is "Untitled draft" by default — that string is dev-
      // authored and must not be rendered; treat any non-default title
      // as a founder-typed value (the writing engine sets it to the
      // first-sentence of their first answer).
      const typed = (d.title && d.title !== "Untitled draft") ? String(d.title).trim() : "";
      let fallback = "";
      if (!stitched && !typed && Array.isArray(d.transcript) && d.transcript.length) {
        const a = String(d.transcript[0].a || "").trim();
        fallback = a.split(/[.!?\n]/)[0].slice(0, 60).trim();
      }
      const title = stitched || typed || fallback;
      if (!title) continue;
      map.set(d.id, { id: d.id, type: "draft", title });
    }
    for (const e of essays) {
      if (!e || !e.id) continue;
      const explicit = e.title && String(e.title).trim();
      let fallback = "";
      if (!explicit && e.body) {
        fallback = String(e.body).trim().split("\n")[0].slice(0, 60).trim();
      }
      const title = explicit || fallback;
      if (!title) continue;
      map.set(e.id, { id: e.id, type: "essay", title });
    }
    return map;
  }

  function setDefaultExpansion(tree) {
    if (defaulted) return;
    if (!tree || !Array.isArray(tree.earths) || !tree.earths.length) return;
    // Default: most-recently-used Earth open (clustering returns
    // Earths in most-recent-first order). Others collapsed.
    expanded.earths.add(tree.earths[0].earthId);
    defaulted = true;
  }

  // ── Render ──────────────────────────────────────────────────────────
  function render(mountEl) {
    mountRef = mountEl || mountRef;
    const target = mountRef;
    if (!target) return;

    const tree = loadCachedTree();
    const earths = (tree && Array.isArray(tree.earths)) ? tree.earths : [];
    // Empty branches don't render: filter Earths with zero Seeds, and
    // for each kept Earth, filter Seeds with zero Growth vectors.
    const visible = earths
      .map((e) => ({
        ...e,
        seeds: (Array.isArray(e.seeds) ? e.seeds : [])
          .map((s) => ({
            ...s,
            growthVectors: (Array.isArray(s.growthVectors) ? s.growthVectors : [])
              .filter((v) => v && typeof v.label === "string" && v.label.length),
          }))
          .filter((s) => s.growthVectors.length > 0 && typeof s.label === "string" && s.label.length),
      }))
      .filter((e) => e.seeds.length > 0);

    // Cold-start: hide the <nav> entirely so the brand block sits
    // directly above the Account block. If we're hiding because the
    // cache is empty but the founder DOES have writings, kick a
    // one-shot refresh in the background — the shimmer will take over
    // the moment refresh() flips refreshing true.
    if (visible.length === 0) {
      target.innerHTML = "";
      target.hidden = true;
      maybeKickInitialRefresh();
      return;
    }

    setDefaultExpansion({ earths: visible });
    target.hidden = false;
    target.innerHTML = "";

    const writingIndex = indexWritings(loadWritings());

    const list = document.createElement("ol");
    list.className = "sidebar__tree-list";

    visible.forEach((earth, earthIdx) => {
      list.appendChild(renderEarthRow(earth, earthIdx, writingIndex));
    });

    target.appendChild(list);

    if (refreshing) target.classList.add("sidebar__tree--refreshing");
    else target.classList.remove("sidebar__tree--refreshing");

    if (lastError) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "sidebar__tree-retry";
      retry.setAttribute("aria-label", "Retry");
      retry.textContent = "↻";
      retry.addEventListener("click", () => { lastError = null; refresh(); });
      target.appendChild(retry);
    }
  }

  function ord(n) {
    const s = String(n);
    return s.length < 2 ? "0" + s : s;
  }

  function renderEarthRow(earth, idx, writingIndex) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-earth";
    if (refreshing) li.classList.add("sidebar__tree-earth--refreshing");

    const isOpen = expanded.earths.has(earth.earthId);
    if (isOpen) li.dataset.open = "";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--earth";
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    btn.innerHTML =
      `<span class="sidebar__tree-ord" aria-hidden="true">${ord(idx + 1)}</span>` +
      `<span class="sidebar__tree-label">${escapeHtml(earth.earthName)}</span>`;
    btn.addEventListener("click", () => {
      if (expanded.earths.has(earth.earthId)) expanded.earths.delete(earth.earthId);
      else expanded.earths.add(earth.earthId);
      render(mountRef);
    });
    li.appendChild(btn);

    if (!isOpen) return li;

    const subList = document.createElement("ol");
    subList.className = "sidebar__tree-seed-list";
    earth.seeds.forEach((seed, seedIdx) => {
      subList.appendChild(renderSeedRow(seed, seedIdx, earth.earthId, writingIndex));
    });
    li.appendChild(subList);
    return li;
  }

  function renderSeedRow(seed, idx, earthId, writingIndex) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-seed";

    const seedKey = `${earthId}::${idx}`;
    const isOpen = expanded.seeds.has(seedKey);
    if (isOpen) li.dataset.open = "";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--seed";
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    btn.innerHTML =
      `<span class="sidebar__tree-ord" aria-hidden="true">${ord(idx + 1)}</span>` +
      `<span class="sidebar__tree-label">${escapeHtml(seed.label)}</span>`;
    btn.addEventListener("click", () => {
      if (expanded.seeds.has(seedKey)) expanded.seeds.delete(seedKey);
      else expanded.seeds.add(seedKey);
      render(mountRef);
    });
    li.appendChild(btn);

    if (!isOpen) return li;

    const vList = document.createElement("ol");
    vList.className = "sidebar__tree-vector-list";
    seed.growthVectors.forEach((v, vIdx) => {
      vList.appendChild(renderVectorRow(v, vIdx, earthId, idx, writingIndex));
    });
    li.appendChild(vList);
    return li;
  }

  function renderVectorRow(vector, idx, earthId, seedIdx, writingIndex) {
    const li = document.createElement("li");
    li.className = "sidebar__tree-vector";

    const writingIds = Array.isArray(vector.writingIds) ? vector.writingIds : [];
    const validIds = writingIds.filter((id) => writingIndex.has(id));
    const count = validIds.length;
    const multi = count >= 2;
    const vectorKey = `${earthId}::${seedIdx}::${idx}`;
    const isOpen = multi && expanded.vectors.has(vectorKey);
    if (isOpen) li.dataset.open = "";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--vector";
    if (multi) btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    btn.innerHTML =
      `<span class="sidebar__tree-label">${escapeHtml(vector.label)}</span>` +
      (multi ? `<span class="sidebar__tree-count" aria-label="${count} writings">(${count})</span>` : "");
    btn.addEventListener("click", () => {
      if (multi) {
        if (expanded.vectors.has(vectorKey)) expanded.vectors.delete(vectorKey);
        else expanded.vectors.add(vectorKey);
        render(mountRef);
        return;
      }
      // Single-writing vector: open the underlying writing.
      const id = validIds[0] || vector.sourceWritingId;
      if (id) openWriting(id, writingIndex);
    });
    li.appendChild(btn);

    if (!multi || !isOpen) return li;

    const writingList = document.createElement("ol");
    writingList.className = "sidebar__tree-writing-list";
    for (const id of validIds) {
      const w = writingIndex.get(id);
      if (!w) continue;
      const wLi = document.createElement("li");
      const wBtn = document.createElement("button");
      wBtn.type = "button";
      wBtn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--writing";
      wBtn.innerHTML = `<span class="sidebar__tree-label">${escapeHtml(w.title)}</span>`;
      wBtn.addEventListener("click", () => openWriting(id, writingIndex));
      wLi.appendChild(wBtn);
      writingList.appendChild(wLi);
    }
    li.appendChild(writingList);
    return li;
  }

  function openWriting(id, writingIndex) {
    const w = writingIndex.get(id);
    if (!w) return;
    if (w.type === "essay" && typeof window.tinkerOpenEssay === "function") {
      window.tinkerOpenEssay(id);
    } else if (w.type === "draft" && typeof window.tinkerResumeDraft === "function") {
      window.tinkerResumeDraft(id);
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // ── Refresh ────────────────────────────────────────────────────────
  // Build the request body for /api/cluster from the founder's local
  // drafts + essays, excluding any writing whose Earth is hidden. The
  // server trusts the input — filtering at this layer is the place to
  // honour the hidden set so the model never sees those writings.
  function buildClusterRequest() {
    const drafts = loadWritings().drafts;
    const essays = loadWritings().essays;
    const hidden = (window.tinkerEarths && typeof window.tinkerEarths.hidden === "function")
      ? new Set(window.tinkerEarths.hidden())
      : new Set();

    const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

    const writings = [];
    for (const d of drafts) {
      if (!d || !d.earth) continue;
      if (hidden.has(norm(d.earth))) continue;
      const body = buildDraftBody(d);
      if (!body) continue;
      writings.push({
        id: d.id,
        type: "draft",
        earth: d.earth,
        title: (d.stitched && d.stitched.title) || d.title || "",
        body,
      });
    }
    for (const e of essays) {
      if (!e || !e.earth) continue;
      if (hidden.has(norm(e.earth))) continue;
      const body = String(e.body || "").trim();
      if (!body) continue;
      writings.push({
        id: e.id,
        type: "essay",
        earth: e.earth,
        title: e.title || "",
        body,
      });
    }
    return { writings };
  }

  function buildDraftBody(draft) {
    if (draft.stitched && draft.stitched.body) return String(draft.stitched.body);
    const parts = [];
    if (Array.isArray(draft.transcript)) {
      for (const turn of draft.transcript) {
        if (turn && turn.a) parts.push(String(turn.a));
      }
    }
    return parts.filter(Boolean).join("\n\n").trim();
  }

  let pendingRefresh = null;
  async function refresh() {
    if (refreshing) {
      // Coalesce: kick a second one once the current call settles.
      pendingRefresh = true;
      return;
    }
    const req = buildClusterRequest();
    if (!req.writings.length) {
      // No writings → empty tree. Cache an empty shape and re-render.
      saveCachedTree({ earths: [] });
      render(mountRef);
      return;
    }
    refreshing = true;
    lastError = null;
    render(mountRef); // shows the refresh shimmer over current rows
    try {
      const token = (() => {
        try { return localStorage.getItem("tinker_jwt") || ""; } catch { return ""; }
      })();
      if (!token) {
        // No session: leave the cache alone, no error surface — the
        // sign-in gate is the right cue for the founder.
        return;
      }
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error(`Cluster ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.earths)) throw new Error("Bad cluster shape");
      saveCachedTree(json);
    } catch (err) {
      // Silent fallback to last cached tree + tiny retry affordance.
      lastError = err && err.message ? err.message : "Refresh failed";
      try { console.warn("[tinker] cluster refresh failed:", err); } catch { /* ignore */ }
    } finally {
      refreshing = false;
      render(mountRef);
      if (pendingRefresh) {
        pendingRefresh = null;
        refresh();
      }
    }
  }

  // ── Mocked tree (Step 3 verification) ─────────────────────────────
  // Enabled via `localStorage.setItem("tinker.tree.mock", "1")`. Lets
  // the founder eyeball the tree before any real cluster data exists.
  // Phrases here read like they could be a person's writing — the audit
  // step verifies real labels trace to real writings; the mock just
  // checks that the row visuals + numbering match the spec.
  const MOCK_TREE = {
    earths: [
      {
        earthId: "home",
        earthName: "home",
        seeds: [
          {
            label: "the barber shop",
            sourceWritingId: "mock_w1",
            sourceOffset: 0,
            sourceLength: 15,
            growthVectors: [
              { label: "his hands", sourceWritingId: "mock_w1", sourceOffset: 0, sourceLength: 9, writingIds: ["mock_w1", "mock_w2", "mock_w3"] },
              { label: "the chair", sourceWritingId: "mock_w2", sourceOffset: 0, sourceLength: 9, writingIds: ["mock_w2"] },
            ],
          },
          {
            label: "hop tinctures at 7am",
            sourceWritingId: "mock_w4",
            sourceOffset: 0,
            sourceLength: 20,
            growthVectors: [
              { label: "what I taste first", sourceWritingId: "mock_w4", sourceOffset: 0, sourceLength: 18, writingIds: ["mock_w4"] },
            ],
          },
        ],
      },
      {
        earthId: "cafe",
        earthName: "cafe",
        seeds: [
          {
            label: "career stuff",
            sourceWritingId: "mock_w5",
            sourceOffset: 0,
            sourceLength: 12,
            growthVectors: [
              { label: "the thing I'm avoiding", sourceWritingId: "mock_w5", sourceOffset: 0, sourceLength: 22, writingIds: ["mock_w5", "mock_w6"] },
            ],
          },
        ],
      },
    ],
  };

  try {
    mockMode = localStorage.getItem("tinker.tree.mock") === "1";
  } catch { mockMode = false; }

  // ── Public API ────────────────────────────────────────────────────
  window.tinkerTree = {
    render,
    refresh,
    lastError: () => lastError,
    // Test helper: flip mock mode at runtime from the devtools console.
    _setMockMode(on) {
      mockMode = !!on;
      try {
        if (on) localStorage.setItem("tinker.tree.mock", "1");
        else localStorage.removeItem("tinker.tree.mock");
      } catch { /* ignore */ }
      render(mountRef);
    },
  };

  // Re-render after sync hydrate so the founder sees their tree the
  // moment server data lands. Reset the initial-refresh guard so
  // post-hydrate state (which may have brought in writings the
  // pre-hydrate boot didn't see) gets a fresh kick if still empty.
  window.addEventListener("tinker:hydrated", () => {
    defaulted = false;
    kickedInitialRefresh = false;
    expanded.earths.clear();
    expanded.seeds.clear();
    expanded.vectors.clear();
    render(mountRef);
  });
})();
