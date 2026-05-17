/* tinker — sidebar tree
 *
 * The three-tier mirror of the founder's writing life:
 *   Earth → Seed (cluster) → Growth vector → (optional inline list)
 *
 * Earths are the places the founder writes from. Seeds are AI-derived
 * clusters of growth vectors inside one Earth; their labels are
 * verbatim phrases lifted from one of the writings in the cluster.
 * Growth vectors are topic-level rows, also verbatim. A Growth vector
 * with more than one underlying writing carries an (N) count badge;
 * tapping it expands a third level of inline rows so the founder can
 * pick which writing to open.
 *
 * The tree replaces #home-list in the sidebar. It renders into the
 * <nav id="sidebar-tree"> slot in index.html, kept hidden until
 * clustering surfaces at least one Earth with at least one Seed.
 *
 * Cache + refresh:
 *   - On boot, render from localStorage["tinker.tree.v1"]. Instant.
 *   - On every writing-session close (and on first hydrate after sign-
 *     in), call /api/cluster, swap in the new response, persist via
 *     sync.js so the same tree shows up on the founder's other device.
 *   - On API failure, keep the last cached tree on screen and reveal
 *     a quiet ↻ retry affordance next to the topmost Earth.
 *
 * Labels are verbatim. The visible-string allowlist is enforced inside
 * the render path: every label rendered traces to either a writing
 * substring (Seeds, Growth vectors, writing titles) or an Earth name
 * the founder has typed. The two fixed chrome strings are the (N)
 * count-badge format and the ↻ retry glyph.
 */

(() => {
  "use strict";

  const TREE_STORAGE_KEY = "tinker.tree.v1";
  const LS_DRAFTS = "tinker.drafts.v1";
  const LS_ESSAYS = "tinker.essays.v1";

  const RETRY_GLYPH = "↻";

  let mount = null;
  let cached = loadCache();
  let expandedEarths = new Set();
  let expandedSeeds = new Set();
  let expandedGrowthVectors = new Set();
  let activeWritingId = null;
  let activeRowKey = null;
  let inFlight = false;
  let lastFailed = false;
  // First-paint default: most-recently-used Earth expanded. We only
  // do this once per session — re-renders preserve whatever the
  // founder has expanded since.
  let didFirstPaintExpand = false;

  function loadCache() {
    try {
      const raw = localStorage.getItem(TREE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.earths)) return parsed;
      return null;
    } catch { return null; }
  }
  function saveCache(tree) {
    try { localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(tree)); } catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushTree === "function") {
      window.tinkerSync.pushTree();
    }
  }

  function token() {
    try { return localStorage.getItem("tinker_jwt") || ""; } catch { return ""; }
  }

  function loadWritings() {
    let drafts = [];
    let essays = [];
    try {
      const raw = localStorage.getItem(LS_DRAFTS);
      drafts = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(drafts)) drafts = [];
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(LS_ESSAYS);
      essays = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(essays)) essays = [];
    } catch { /* ignore */ }
    return { drafts, essays };
  }

  // Build the writings payload for /api/cluster. Pulls drafts + essays
  // out of localStorage, sorts most-recent first, and excludes any
  // writing anchored to a hidden Earth (the founder explicitly opted
  // them out via tinkerEarths.remove). Hidden things stay hidden.
  function buildWritingsForCluster() {
    const { drafts, essays } = loadWritings();
    const isHidden = (earth) => {
      if (!earth) return false;
      if (window.tinkerEarths && typeof window.tinkerEarths.isHidden === "function") {
        return window.tinkerEarths.isHidden(earth);
      }
      return false;
    };

    const collected = [];
    for (const e of essays) {
      if (!e || !e.earth || isHidden(e.earth)) continue;
      const body = String(e.body || "").trim();
      if (!body) continue;
      collected.push({
        id: e.id,
        earth: e.earth,
        title: e.title || "",
        body,
        time: e.createdAt || 0,
      });
    }
    for (const d of drafts) {
      if (!d || !d.earth || isHidden(d.earth)) continue;
      // Drafts haven't been stitched yet; concatenate the transcript
      // answers so clustering has something to read.
      const parts = [];
      if (Array.isArray(d.transcript)) {
        for (const turn of d.transcript) {
          if (turn && turn.a) parts.push(String(turn.a));
        }
      }
      if (d.stitched && d.stitched.body) parts.push(String(d.stitched.body));
      const body = parts.join("\n\n").trim();
      if (!body) continue;
      const title = (d.stitched && d.stitched.title) || (d.title && d.title !== "Untitled draft" ? d.title : "");
      collected.push({
        id: d.id,
        earth: d.earth,
        title,
        body,
        time: d.updatedAt || d.createdAt || 0,
      });
    }
    collected.sort((a, b) => (b.time || 0) - (a.time || 0));
    // Strip the time field — clustering reads id/earth/title/body only.
    return collected.map(({ id, earth, title, body }) => ({ id, earth, title, body }));
  }

  function writingById(id) {
    if (!id) return null;
    const { drafts, essays } = loadWritings();
    for (const e of essays) if (e && e.id === id) return { kind: "essay", record: e };
    for (const d of drafts) if (d && d.id === id) return { kind: "draft", record: d };
    return null;
  }

  function writingTitleFor(id) {
    const hit = writingById(id);
    if (!hit) return "";
    const r = hit.record;
    if (hit.kind === "essay") return r.title || titleFallback(r.body);
    return (r.stitched && r.stitched.title) || (r.title && r.title !== "Untitled draft" ? r.title : titleFallback(extractDraftBody(r)));
  }

  function extractDraftBody(draft) {
    const parts = [];
    if (Array.isArray(draft.transcript)) {
      for (const turn of draft.transcript) {
        if (turn && turn.a) parts.push(String(turn.a));
      }
    }
    if (draft.stitched && draft.stitched.body) parts.push(String(draft.stitched.body));
    return parts.join(" ");
  }

  // Founder-only title fallback: the first sentence (or first short
  // run of characters) of the body. Stays verbatim — we're slicing
  // their own text, not generating a label. Used only when a writing
  // has no explicit title.
  function titleFallback(body) {
    const s = String(body || "").trim();
    if (!s) return "";
    const m = s.match(/^[^.!?\n]{1,80}[.!?]?/);
    return (m ? m[0] : s.slice(0, 60)).trim();
  }

  function ordinal(i) {
    return (i + 1).toString().padStart(2, "0");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // A Growth vector is renderable only when at least one of its
  // underlying writings still exists on this device. Drops everything
  // pointing at a since-deleted writing — the renderer never shows a
  // row that taps to nowhere.
  function renderableWritingIds(gv) {
    if (!gv || !Array.isArray(gv.writingIds)) return [];
    return gv.writingIds.filter((id) => !!writingById(id));
  }
  function isGrowthVectorRenderable(gv) {
    return renderableWritingIds(gv).length > 0;
  }
  function renderableSeedsFor(earth) {
    if (!earth || !Array.isArray(earth.seeds)) return [];
    return earth.seeds
      .map((s) => {
        if (!s || !Array.isArray(s.growthVectors)) return null;
        const gvs = s.growthVectors.filter(isGrowthVectorRenderable);
        if (gvs.length === 0) return null;
        return { ...s, growthVectors: gvs };
      })
      .filter(Boolean);
  }
  function renderableEarths(tree) {
    if (!tree || !Array.isArray(tree.earths)) return [];
    return tree.earths
      .map((e) => {
        if (!e) return null;
        const seeds = renderableSeedsFor(e);
        if (seeds.length === 0) return null;
        return { ...e, seeds };
      })
      .filter(Boolean);
  }
  function isEmpty(tree) {
    return renderableEarths(tree).length === 0;
  }

  function render() {
    mount = mount || document.getElementById("sidebar-tree");
    if (!mount) return;

    const earths = renderableEarths(cached);
    if (earths.length === 0) {
      mount.hidden = true;
      mount.innerHTML = "";
      return;
    }

    // First paint after boot: expand the most-recently-used Earth so
    // the founder lands inside a meaningful row. Subsequent renders
    // preserve whatever they've toggled.
    if (!didFirstPaintExpand) {
      expandedEarths.add(earths[0].earthId);
      didFirstPaintExpand = true;
    }

    mount.hidden = false;
    mount.innerHTML = "";
    if (inFlight) mount.dataset.refreshing = "true";
    else delete mount.dataset.refreshing;

    earths.forEach((earth, i) => {
      mount.appendChild(renderEarth(earth, earth.seeds, i));
    });
  }

  function renderEarth(earth, renderableSeeds, earthIndex) {
    const wrapper = document.createElement("div");
    wrapper.className = "sidebar__tree-earth";
    wrapper.dataset.earthId = earth.earthId;

    const isExpanded = expandedEarths.has(earth.earthId);
    if (isExpanded) wrapper.dataset.expanded = "true";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--earth";
    row.setAttribute("aria-expanded", isExpanded ? "true" : "false");

    // Quiet ordinal — Earth rows carry a leading 01/02/03 marker in
    // a fixed-width slot. Seeds and Growth vectors are unnumbered
    // (per the founder's answer to the open question).
    const ord = document.createElement("span");
    ord.className = "sidebar__tree-ord";
    ord.textContent = ordinal(earthIndex);
    ord.setAttribute("aria-hidden", "true");
    row.appendChild(ord);

    const label = document.createElement("span");
    label.className = "sidebar__account-label sidebar__tree-label";
    label.textContent = earth.earthName;
    row.appendChild(label);

    // The retry affordance lives next to the topmost Earth when the
    // last refresh failed. Quiet glyph, sibling of the label.
    if (lastFailed && earthIndex === 0) {
      const retry = document.createElement("span");
      retry.className = "sidebar__tree-retry";
      retry.textContent = RETRY_GLYPH;
      retry.title = "Retry";
      retry.addEventListener("click", (e) => {
        e.stopPropagation();
        refresh();
      });
      row.appendChild(retry);
    }

    row.addEventListener("click", () => {
      if (expandedEarths.has(earth.earthId)) expandedEarths.delete(earth.earthId);
      else expandedEarths.add(earth.earthId);
      render();
    });
    wrapper.appendChild(row);

    if (isExpanded) {
      const children = document.createElement("div");
      children.className = "sidebar__tree-children sidebar__tree-children--seeds";
      for (const seed of renderableSeeds) {
        children.appendChild(renderSeed(earth, seed));
      }
      wrapper.appendChild(children);
    }
    return wrapper;
  }

  function renderSeed(earth, seed) {
    const seedKey = `${earth.earthId}::${seed.label}::${seed.sourceWritingId}::${seed.sourceOffset}`;
    const isExpanded = expandedSeeds.has(seedKey);

    const wrapper = document.createElement("div");
    wrapper.className = "sidebar__tree-seed";
    if (isExpanded) wrapper.dataset.expanded = "true";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--seed";
    row.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    if (activeRowKey === seedKey) row.dataset.active = "true";

    const label = document.createElement("span");
    label.className = "sidebar__account-label sidebar__tree-label";
    label.textContent = seed.label;
    row.appendChild(label);

    row.addEventListener("click", () => {
      if (expandedSeeds.has(seedKey)) expandedSeeds.delete(seedKey);
      else expandedSeeds.add(seedKey);
      render();
    });
    wrapper.appendChild(row);

    if (isExpanded) {
      const children = document.createElement("div");
      children.className = "sidebar__tree-children sidebar__tree-children--gvs";
      for (const gv of seed.growthVectors) {
        if (!gv || !Array.isArray(gv.writingIds) || gv.writingIds.length === 0) continue;
        children.appendChild(renderGrowthVector(earth, seed, seedKey, gv));
      }
      wrapper.appendChild(children);
    }
    return wrapper;
  }

  function renderGrowthVector(earth, seed, seedKey, gv) {
    const gvKey = `${seedKey}::${gv.label}::${gv.sourceWritingId}::${gv.sourceOffset}`;
    const writingIds = gv.writingIds.filter((id) => !!writingById(id));
    const count = writingIds.length;
    const hasBadge = count >= 2;
    const isExpanded = hasBadge && expandedGrowthVectors.has(gvKey);

    const wrapper = document.createElement("div");
    wrapper.className = "sidebar__tree-gv";
    if (isExpanded) wrapper.dataset.expanded = "true";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--gv";
    if (hasBadge) row.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    if (activeRowKey === gvKey || (count === 1 && activeWritingId === writingIds[0])) {
      row.dataset.active = "true";
    }

    const label = document.createElement("span");
    label.className = "sidebar__account-label sidebar__tree-label";
    label.textContent = gv.label;
    row.appendChild(label);

    if (hasBadge) {
      const badge = document.createElement("span");
      badge.className = "sidebar__tree-badge";
      badge.textContent = `(${count})`;
      row.appendChild(badge);
    }

    row.addEventListener("click", () => {
      if (hasBadge) {
        if (expandedGrowthVectors.has(gvKey)) expandedGrowthVectors.delete(gvKey);
        else expandedGrowthVectors.add(gvKey);
        activeRowKey = gvKey;
        render();
        return;
      }
      const onlyId = writingIds[0];
      if (onlyId) {
        activeWritingId = onlyId;
        activeRowKey = gvKey;
        openWriting(onlyId);
        render();
      }
    });
    wrapper.appendChild(row);

    if (isExpanded) {
      const children = document.createElement("div");
      children.className = "sidebar__tree-children sidebar__tree-children--writings";
      for (const id of writingIds) {
        const title = writingTitleFor(id);
        if (!title) continue;
        children.appendChild(renderWritingPicker(id, title, gvKey));
      }
      wrapper.appendChild(children);
    }
    return wrapper;
  }

  function renderWritingPicker(id, title, gvKey) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sidebar__account-item sidebar__tree-row sidebar__tree-row--writing";
    if (activeWritingId === id) row.dataset.active = "true";
    const label = document.createElement("span");
    label.className = "sidebar__account-label sidebar__tree-label";
    label.textContent = title;
    row.appendChild(label);
    row.addEventListener("click", () => {
      activeWritingId = id;
      activeRowKey = `${gvKey}::${id}`;
      openWriting(id);
      render();
    });
    return row;
  }

  function openWriting(id) {
    const hit = writingById(id);
    if (!hit) return;
    if (hit.kind === "essay" && typeof window.tinkerOpenEssay === "function") {
      window.tinkerOpenEssay(id);
    } else if (hit.kind === "draft" && typeof window.tinkerResumeDraft === "function") {
      window.tinkerResumeDraft(id);
    }
  }

  // Pull fresh data from /api/cluster and swap in the response. The
  // existing cached tree stays rendered while the call is in flight;
  // a faint shimmer is applied to the rows (CSS reads
  // [data-refreshing]). Silent-fallback on failure: keep the last
  // cached tree, reveal the ↻ retry affordance.
  async function refresh() {
    if (inFlight) return;
    if (!token()) return;
    const writings = buildWritingsForCluster();
    if (writings.length === 0) {
      // Truly nothing to cluster (no writings or all hidden). This is
      // cold-start territory — empty is the right state, no soft-
      // fallback. Hide the nav.
      cached = { earths: [] };
      saveCache(cached);
      render();
      return;
    }

    inFlight = true;
    render();
    try {
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({ writings }),
      });
      if (!res.ok) throw new Error(`cluster ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.earths)) throw new Error("malformed");

      // Soft-fallback: if clustering returned an empty tree but the
      // existing cache had renderable content, treat it as a partial
      // failure rather than wiping a working tree off the screen.
      // The founder sees the ↻ retry next to the topmost Earth and
      // can re-trigger manually. This is the "if clustering fails,
      // fall back to last cached" rule from the spec, extended to
      // cover the case where the model couldn't produce ≥2 Seeds
      // for any Earth this round (a real possibility on small
      // single-writing Earths given the 1-writing floor).
      const respHasContent = renderableEarths(data).length > 0;
      const cacheHasContent = renderableEarths(cached).length > 0;
      try {
        // Lightweight DevTools breadcrumb so the founder (and we, on
        // the next pass) can see what came back without enabling
        // verbose logging.
        console.info("[tinker] /api/cluster ←", {
          earths: data.earths.length,
          renderable: respHasContent,
          keptCache: !respHasContent && cacheHasContent,
        });
      } catch { /* ignore */ }

      if (!respHasContent && cacheHasContent) {
        lastFailed = true;
      } else {
        cached = data;
        saveCache(cached);
        lastFailed = false;
      }
    } catch (err) {
      try { console.warn("[tinker] /api/cluster failed:", err && err.message); } catch { /* ignore */ }
      lastFailed = true;
    } finally {
      inFlight = false;
      render();
    }
  }

  window.tinkerTree = { render, refresh };

  // Boot: render whatever's cached, then trigger a background refresh
  // so the tree updates if the underlying writings have changed since
  // the last refresh.
  function boot() {
    mount = document.getElementById("sidebar-tree");
    render();
    if (token()) {
      // Don't block boot — defer one frame so the rest of the UI
      // paints first.
      setTimeout(() => { refresh(); }, 50);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // Server hydration may overwrite the tree storage key after boot.
  // Re-read and re-render. Then kick a refresh so the merged view
  // reflects the freshest underlying writings.
  window.addEventListener("tinker:hydrated", () => {
    cached = loadCache();
    render();
    if (token()) refresh();
  });

  window.addEventListener("tinker:auth-changed", () => {
    if (token()) refresh();
  });
})();
