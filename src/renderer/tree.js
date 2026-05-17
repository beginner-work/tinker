/* tinker — sidebar tree (Earth → Seed → Growth vector)
 *
 * Three-tier mirror of the founder's writing life:
 *   - Earths        the places they write from (top level)
 *   - Seeds         AI-derived clusters of writings inside each Earth
 *   - Growth vecs   topic-level rows inside each Seed
 *
 * All labels are verbatim phrases from the founder's own writings. The
 * server picks offsets; this module validates and renders.
 *
 * Storage:
 *   tinker.tree.v1   { earths: [...] }    (cached cluster response)
 *
 * Public API:
 *   window.tinkerTree.render(mountEl)     full re-render
 *   window.tinkerTree.refresh()           call /api/cluster + cache + render
 */

(() => {
  "use strict";

  const STORAGE_TREE = "tinker.tree.v1";
  const STORAGE_DRAFTS = "tinker.drafts.v1";
  const STORAGE_ESSAYS = "tinker.essays.v1";

  // Per-Earth minimum writings to produce Seeds. [NEEDS INPUT] —
  // founder spec asks 3 vs 5; default 3 since it lets a fresh-ish
  // writer see the tree sooner.
  const MIN_WRITINGS_PER_EARTH = 3;

  // ── State ──────────────────────────────────────────────────────────
  let mountEl = null;
  // Expansion state, keyed by `earthId` and `earthId|seedIdx`. Lives in
  // memory only — refreshing the tree picks the most-recent-earth
  // expansion default again on next render.
  const expanded = new Set();
  // When a growth vector with N≥2 underlying writings is tapped, its
  // multi-writing picker expands inline. Tracked here keyed by
  // `earthId|seedIdx|gvIdx`.
  const expandedPickers = new Set();
  // Currently-active row, set when a writing opens. Used for the
  // single-row highlight; ancestors stay inert.
  let activeRowId = null;
  let refreshing = false;
  let lastRefreshFailed = false;

  // One-time cleanup for the v0.102 poisoning where a transient
  // cluster failure persisted `{earths: []}` over a previously-good
  // tree. If localStorage holds a tree blob with no meaningful
  // content, drop it and push the clear so the server row gets
  // wiped on the next sync — otherwise hydrate would keep
  // reinstating the poison on every reload.
  (function evictPoisonedCache() {
    try {
      const raw = localStorage.getItem(STORAGE_TREE);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (!Array.isArray(parsed.earths)) return;
      const hasContent = parsed.earths.some(
        (e) => e && Array.isArray(e.seeds) && e.seeds.some(
          (s) => s && Array.isArray(s.growthVectors) && s.growthVectors.length > 0,
        ),
      );
      if (hasContent) return;
      try { console.warn("[tinker.tree] evicting empty-earths cache from v0.102 race"); } catch { /* ignore */ }
      localStorage.removeItem(STORAGE_TREE);
      if (window.tinkerSync && typeof window.tinkerSync.pushTree === "function") {
        window.tinkerSync.pushTree();
      }
    } catch { /* ignore */ }
  })();

  // ── Storage helpers ────────────────────────────────────────────────
  function treeHasContent(parsed) {
    if (!parsed || !Array.isArray(parsed.earths)) return false;
    return parsed.earths.some(
      (e) => e && Array.isArray(e.seeds) && e.seeds.some(
        (s) => s && Array.isArray(s.growthVectors) && s.growthVectors.length > 0,
      ),
    );
  }
  function loadTree() {
    try {
      const raw = localStorage.getItem(STORAGE_TREE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.earths)) return null;
      // Reject empty / no-content caches outright. They land in
      // localStorage from the v0.102 race where a transient cluster
      // failure persisted `{earths: []}` over a previously-good
      // tree; treating them as "no cache" lets the boot kicker
      // refresh and self-heal.
      if (!treeHasContent(parsed)) return null;
      return parsed;
    } catch { return null; }
  }
  function saveTree(tree) {
    try { localStorage.setItem(STORAGE_TREE, JSON.stringify(tree)); } catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushTree === "function") {
      window.tinkerSync.pushTree();
    }
  }

  function loadDrafts() {
    try { return JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]"); }
    catch { return []; }
  }
  function loadEssays() {
    try { return JSON.parse(localStorage.getItem(STORAGE_ESSAYS) || "[]"); }
    catch { return []; }
  }

  // Earth name → its rank in the most-recently-written-in order. Used
  // to expand the most-recent Earth by default on a cold render.
  function mostRecentEarthId(tree) {
    if (!tree || !Array.isArray(tree.earths) || !tree.earths.length) return null;
    // Server returns Earths in most-recent order, so take the first.
    return tree.earths[0].earthId || null;
  }

  // ── Rendering ──────────────────────────────────────────────────────
  function ord(n) {
    return String(n).padStart(2, "0");
  }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function rowId(...parts) {
    return parts.join("|");
  }

  function ensureDefaultExpansion(tree) {
    // Most-recently-used Earth is expanded by default. Other rows stay
    // collapsed. Skip if the user has already touched any row this
    // session (i.e. `expanded` is non-empty).
    if (expanded.size > 0) return;
    const id = mostRecentEarthId(tree);
    if (id) expanded.add(id);
  }

  function render(el) {
    mountEl = el || mountEl;
    if (!mountEl) return;

    const tree = loadTree();
    // An Earth with no Seeds (or a Seed with no Growth vectors) is
    // dropped per spec. If no earth survives that test, the whole
    // nav is hidden — brand sits flush above Account.
    const hasContent = tree && Array.isArray(tree.earths) && tree.earths.some(
      (e) => e && Array.isArray(e.seeds) && e.seeds.some(
        (s) => s && Array.isArray(s.growthVectors) && s.growthVectors.length > 0,
      ),
    );

    if (!hasContent) {
      // Empty content. If a clustering refresh just failed AND there
      // are writings to cluster, surface a quiet retry so the
      // founder isn't stranded — the spec calls for `↻` on the
      // topmost Earth on failure, but with no Earths to anchor to
      // we render the same glyph in the empty-state nav.
      if (lastRefreshFailed && hasWritings()) {
        mountEl.hidden = false;
        mountEl.innerHTML =
          `<button type="button" class="sidebar__account-item sidebar__tree-retry-standalone" data-retry>` +
          `<span class="sidebar__tree-label">&#x21bb;</span>` +
          `</button>`;
        const btn = mountEl.querySelector("[data-retry]");
        if (btn) btn.addEventListener("click", () => refresh());
        return;
      }
      mountEl.innerHTML = "";
      mountEl.hidden = true;
      return;
    }

    mountEl.hidden = false;
    ensureDefaultExpansion(tree);

    const frag = document.createDocumentFragment();

    if (refreshing) {
      mountEl.classList.add("sidebar__tree--refreshing");
    } else {
      mountEl.classList.remove("sidebar__tree--refreshing");
    }

    const earthList = document.createElement("ul");
    earthList.className = "sidebar__tree-list sidebar__tree-list--earths";

    tree.earths.forEach((earth, ei) => {
      if (!earth || !Array.isArray(earth.seeds) || earth.seeds.length === 0) return;
      const earthLi = document.createElement("li");
      earthLi.className = "sidebar__tree-item";

      const earthBtn = document.createElement("button");
      earthBtn.type = "button";
      earthBtn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--earth";
      const isExpanded = expanded.has(earth.earthId);
      earthBtn.setAttribute("aria-expanded", String(isExpanded));
      earthBtn.dataset.earthId = earth.earthId;
      earthBtn.innerHTML =
        `<span class="sidebar__tree-ord" aria-hidden="true">${escapeHtml(ord(ei + 1))}</span>` +
        `<span class="sidebar__tree-label">${escapeHtml(earth.earthName)}</span>` +
        (ei === 0 && lastRefreshFailed
          ? `<button type="button" class="sidebar__tree-retry" aria-label="Refresh sidebar" data-retry>&#x21bb;</button>`
          : "");
      earthBtn.addEventListener("click", (e) => {
        // Retry button click bubbles up; handle and don't expand/collapse.
        if (e.target && e.target.hasAttribute("data-retry")) {
          e.stopPropagation();
          refresh();
          return;
        }
        if (expanded.has(earth.earthId)) expanded.delete(earth.earthId);
        else expanded.add(earth.earthId);
        render(mountEl);
      });
      earthLi.appendChild(earthBtn);

      if (isExpanded) {
        const seedList = document.createElement("ul");
        seedList.className = "sidebar__tree-list sidebar__tree-list--seeds";

        earth.seeds.forEach((seed, si) => {
          if (!seed || !Array.isArray(seed.growthVectors) || seed.growthVectors.length === 0) return;
          const seedLi = document.createElement("li");
          seedLi.className = "sidebar__tree-item";

          const seedRowId = rowId(earth.earthId, "s", si);
          const seedExpanded = expanded.has(seedRowId);

          const seedBtn = document.createElement("button");
          seedBtn.type = "button";
          seedBtn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--seed";
          seedBtn.setAttribute("aria-expanded", String(seedExpanded));
          // [NEEDS INPUT] Open question 5 — Seed numbering format:
          // re-counted (01, 02 inside each Earth) vs path-style
          // (01·01, 01·02). Default re-counted (per spec) — quieter,
          // and indentation already encodes Earth context.
          seedBtn.innerHTML =
            `<span class="sidebar__tree-ord" aria-hidden="true">${escapeHtml(ord(si + 1))}</span>` +
            `<span class="sidebar__tree-label">${escapeHtml(seed.label)}</span>`;
          seedBtn.addEventListener("click", () => {
            if (expanded.has(seedRowId)) expanded.delete(seedRowId);
            else expanded.add(seedRowId);
            render(mountEl);
          });
          seedLi.appendChild(seedBtn);

          if (seedExpanded) {
            const gvList = document.createElement("ul");
            gvList.className = "sidebar__tree-list sidebar__tree-list--gvs";

            seed.growthVectors.forEach((gv, gi) => {
              if (!gv) return;
              const writingIds = Array.isArray(gv.writingIds) ? gv.writingIds : [];
              if (writingIds.length === 0) return;
              const gvLi = document.createElement("li");
              gvLi.className = "sidebar__tree-item";

              const gvRowId = rowId(earth.earthId, "s", si, "g", gi);
              const hasBadge = writingIds.length >= 2;
              const pickerOpen = expandedPickers.has(gvRowId);

              const gvBtn = document.createElement("button");
              gvBtn.type = "button";
              gvBtn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--gv";
              // Mark navigating rows so the mobile drawer can close
              // after a leaf tap (and stay open after an expand tap).
              if (!hasBadge) gvBtn.dataset.action = "open";
              if (activeRowId === gvRowId) gvBtn.dataset.active = "";
              gvBtn.innerHTML =
                `<span class="sidebar__tree-label">${escapeHtml(gv.label)}</span>` +
                (hasBadge ? `<span class="sidebar__tree-badge" aria-hidden="true">(${writingIds.length})</span>` : "");
              gvBtn.addEventListener("click", () => {
                if (hasBadge) {
                  if (expandedPickers.has(gvRowId)) expandedPickers.delete(gvRowId);
                  else expandedPickers.add(gvRowId);
                  render(mountEl);
                  return;
                }
                openWriting(writingIds[0], gvRowId);
              });
              gvLi.appendChild(gvBtn);

              if (hasBadge && pickerOpen) {
                const pickList = document.createElement("ul");
                pickList.className = "sidebar__tree-list sidebar__tree-list--picker";
                writingIds.forEach((wid, wi) => {
                  const writing = lookupWriting(wid);
                  if (!writing) return;
                  const label = writing.title || writing.bodyExcerpt || "";
                  // Skip writings with neither a title nor a body —
                  // an empty leaf is a "render-an-empty-branch" violation.
                  if (!label) return;
                  const pickLi = document.createElement("li");
                  pickLi.className = "sidebar__tree-item";
                  const pickRowId = rowId(gvRowId, "w", wi);
                  const pickBtn = document.createElement("button");
                  pickBtn.type = "button";
                  pickBtn.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--writing";
                  pickBtn.dataset.action = "open";
                  if (activeRowId === pickRowId) pickBtn.dataset.active = "";
                  pickBtn.innerHTML =
                    `<span class="sidebar__tree-label">${escapeHtml(label)}</span>`;
                  pickBtn.addEventListener("click", () => {
                    openWriting(wid, pickRowId);
                  });
                  pickLi.appendChild(pickBtn);
                  pickList.appendChild(pickLi);
                });
                gvLi.appendChild(pickList);
              }
              gvList.appendChild(gvLi);
            });
            seedLi.appendChild(gvList);
          }
          seedList.appendChild(seedLi);
        });
        earthLi.appendChild(seedList);
      }
      earthList.appendChild(earthLi);
    });

    frag.appendChild(earthList);
    mountEl.innerHTML = "";
    mountEl.appendChild(frag);
  }

  function lookupWriting(id) {
    if (!id) return null;
    const drafts = loadDrafts();
    const essays = loadEssays();
    const draft = drafts.find((d) => d && d.id === id);
    if (draft) {
      const title = (draft.stitched && draft.stitched.title)
        || (draft.title && draft.title !== "Untitled draft" ? draft.title : null)
        || excerpt(extractDraftText(draft));
      return { kind: "draft", id, title };
    }
    const essay = essays.find((e) => e && e.id === id);
    if (essay) {
      const title = essay.title || excerpt(essay.body || "");
      return { kind: "essay", id, title, bodyExcerpt: excerpt(essay.body || "") };
    }
    return null;
  }
  function excerpt(text) {
    // Verbatim founder-text only — no trailing ellipsis (the visible-
    // string audit forbids developer-authored chrome strings inside
    // the tree beyond the allowlist).
    const s = String(text || "").trim().replace(/\s+/g, " ");
    return s.slice(0, 60);
  }
  function extractDraftText(draft) {
    if (draft.stitched && draft.stitched.body) return draft.stitched.body;
    if (Array.isArray(draft.transcript)) {
      return draft.transcript.map((t) => t && t.a).filter(Boolean).join(" ");
    }
    return "";
  }

  function openWriting(id, rowIdent) {
    activeRowId = rowIdent || null;
    const drafts = loadDrafts();
    const essays = loadEssays();
    if (essays.some((e) => e && e.id === id)) {
      if (typeof window.tinkerOpenEssay === "function") window.tinkerOpenEssay(id);
    } else if (drafts.some((d) => d && d.id === id)) {
      if (typeof window.tinkerResumeDraft === "function") window.tinkerResumeDraft(id);
    }
    render(mountEl);
  }

  // ── Clustering call ────────────────────────────────────────────────
  function token() {
    try { return localStorage.getItem("tinker_jwt") || ""; }
    catch { return ""; }
  }

  // [NEEDS INPUT] Open question 3 — Hidden affordance placement:
  // existing tinker.earths.hidden.v1 tombstoning stays where it is
  // (no new UI introduced for hidden writings in this revamp).
  // Default per spec — out of scope to redesign.
  //
  // Gather the inputs the server needs: every visible writing
  // (drafts + essays), minus anything whose earth is hidden. Hidden
  // writings are excluded before they're sent.
  function gatherWritings() {
    const drafts = loadDrafts();
    const essays = loadEssays();
    const hidden = (window.tinkerEarths && typeof window.tinkerEarths.hiddenSet === "function")
      ? window.tinkerEarths.hiddenSet()
      : new Set();
    const normalize = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

    const list = [];
    for (const d of drafts) {
      if (!d || !d.earth) continue;
      if (hidden.has(normalize(d.earth))) continue;
      const body = extractDraftText(d);
      if (!body.trim()) continue;
      list.push({
        id: d.id,
        kind: "draft",
        earth: d.earth,
        title: (d.stitched && d.stitched.title) || (d.title && d.title !== "Untitled draft" ? d.title : null),
        body: String(body).slice(0, 4000),
        updatedAt: d.updatedAt || d.createdAt || 0,
      });
    }
    for (const e of essays) {
      if (!e || !e.earth) continue;
      if (hidden.has(normalize(e.earth))) continue;
      const body = String(e.body || "");
      if (!body.trim()) continue;
      list.push({
        id: e.id,
        kind: "essay",
        earth: e.earth,
        title: e.title || null,
        body: body.slice(0, 4000),
        updatedAt: e.createdAt || 0,
      });
    }
    return list;
  }

  let refreshTimer = null;
  async function refresh() {
    if (refreshing) return;
    const t = token();
    if (!t) {
      try { console.warn("[tinker.tree] refresh skipped — no auth token"); } catch { /* ignore */ }
      return;
    }
    const writings = gatherWritings();
    if (writings.length === 0) {
      try { console.warn("[tinker.tree] refresh skipped — no taggable writings (need at least one draft/essay with an `.earth` field)"); } catch { /* ignore */ }
      // Nothing to cluster — clear any stale cache and render empty.
      try { localStorage.removeItem(STORAGE_TREE); } catch { /* ignore */ }
      if (window.tinkerSync && typeof window.tinkerSync.pushTree === "function") {
        window.tinkerSync.pushTree();
      }
      lastRefreshFailed = false;
      render(mountEl);
      return;
    }
    refreshing = true;
    render(mountEl);
    try {
      try { console.log(`[tinker.tree] clustering ${writings.length} writing(s)`); } catch { /* ignore */ }
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({ writings, minWritingsPerEarth: MIN_WRITINGS_PER_EARTH }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Cluster API returned ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      if (data && Array.isArray(data.earths)) {
        try { console.log(`[tinker.tree] received ${data.earths.length} earth(s)`); } catch { /* ignore */ }
        if (data.earths.length > 0) {
          saveTree(data);
          lastRefreshFailed = false;
        } else {
          // Empty earths from a non-empty writing corpus almost
          // always means clustering had to drop every label as
          // non-verbatim (Claude's offset arithmetic is brittle).
          // Keep the last good cache and surface the retry —
          // never silently nuke a valid sidebar.
          try { console.warn("[tinker.tree] cluster returned empty earths despite a non-empty corpus — keeping last good cache"); } catch { /* ignore */ }
          lastRefreshFailed = true;
        }
      } else {
        try { console.warn("[tinker.tree] cluster response missing `earths` array:", data); } catch { /* ignore */ }
        lastRefreshFailed = true;
      }
    } catch (err) {
      lastRefreshFailed = true;
      try { console.error("[tinker.tree] refresh failed:", err); } catch { /* ignore */ }
    } finally {
      refreshing = false;
      render(mountEl);
    }
  }

  // Debounce repeated refresh requests — the renderer fires this on
  // writing close AND on publish; one burst should be one call.
  function debouncedRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 250);
  }

  // ── Boot wiring ────────────────────────────────────────────────────
  window.tinkerTree = {
    render(el) { render(el); },
    refresh: debouncedRefresh,
    // Test hook: replace the cached tree with a literal blob and
    // re-render. Used by the mocked-data verification in step 3 of
    // the build sequence; ignore in production paths.
    _setCached(blob) {
      if (blob && typeof blob === "object" && Array.isArray(blob.earths)) {
        try { localStorage.setItem(STORAGE_TREE, JSON.stringify(blob)); } catch { /* ignore */ }
      }
      render(mountEl);
    },
  };

  function hasWritings() {
    const drafts = loadDrafts();
    const essays = loadEssays();
    return drafts.some((d) => d && d.earth && extractDraftText(d).trim())
        || essays.some((e) => e && e.earth && String(e.body || "").trim());
  }

  // Re-render whenever server hydration overwrites the cached tree.
  // If hydration brought writings but no tree (the "first-time on
  // this device" case), kick a refresh so the tree catches up.
  window.addEventListener("tinker:hydrated", () => {
    render(mountEl);
    if (!loadTree() && hasWritings() && token()) debouncedRefresh();
  });

  // Kick a refresh on first boot if there's a token, writings exist,
  // and no cached tree. First-time users with no writings see the
  // calm empty state instantly — no spinner, no API call.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (token() && !loadTree() && hasWritings()) debouncedRefresh();
    }, { once: true });
  } else {
    if (token() && !loadTree() && hasWritings()) debouncedRefresh();
  }
})();
