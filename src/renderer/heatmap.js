/* tinker — home location list, grouped by a Claude-managed taxonomy
 *
 * Each location is one card. Cards are grouped under a category Claude
 * picks from a *growing* taxonomy — the categories are not a fixed
 * list. Each time a new location (or a location with new writing)
 * needs placing, Claude either:
 *   1. Fits it under an existing category, OR
 *   2. Nests it under an existing top-level as a more specific
 *      sub-category, OR
 *   3. Creates a brand-new top-level category.
 *
 * Stored at localStorage["tinker.taxonomy.v1"] as:
 *   {
 *     taxonomy:  { [normKey]: { name, description, parent: normKey | null } },
 *     locations: { [locKey]: { path: [normKey, normKey?], fp: contentHash } }
 *   }
 *
 * Public API:
 *   window.tinkerHeatmap.render(mountEl)
 *
 * Module name is historical (heatmap → merchant cards → locations).
 */

(() => {
  "use strict";

  // Tinker rainbow palette — avatar colour is picked deterministically
  // from the location's normalised name so re-renders stay stable.
  const PALETTE = ["#F9A8D4", "#FDBA74", "#FDE68A", "#7BC47A", "#7DD3FC", "#C8B6E2", "#6EE7B7"];

  const TAXONOMY_KEY = "tinker.taxonomy.v1";
  const UNSORTED_KEY = "unsorted";

  function loadState() {
    try {
      const raw = localStorage.getItem(TAXONOMY_KEY);
      if (!raw) return { taxonomy: {}, locations: {} };
      const parsed = JSON.parse(raw);
      const taxonomy = (parsed && typeof parsed.taxonomy === "object" && parsed.taxonomy) || {};
      const rawLocations = (parsed && typeof parsed.locations === "object" && parsed.locations) || {};
      // Silent migration: older entries used { path: [...] } singular.
      // Wrap into { paths: [[...]] } so callers only need to handle
      // the new shape.
      const locations = {};
      for (const [k, v] of Object.entries(rawLocations)) {
        if (!v || typeof v !== "object") continue;
        if (Array.isArray(v.paths) && v.paths.length) {
          locations[k] = { paths: v.paths, fp: v.fp || null };
        } else if (Array.isArray(v.path) && v.path.length) {
          locations[k] = { paths: [v.path], fp: v.fp || null };
        }
      }
      return { taxonomy, locations };
    } catch { return { taxonomy: {}, locations: {} }; }
  }

  // Strip any path whose prefix is fully contained in a longer path
  // returned for the same location — Claude is told not to do this,
  // but we defend against it. Also dedupe exact duplicates.
  function dedupePaths(paths) {
    const sigs = paths.map((p) => p.join(""));
    const keep = [];
    for (let i = 0; i < paths.length; i++) {
      const sig = sigs[i];
      // Drop exact duplicates already kept.
      if (keep.some((k) => sigs[k] === sig)) continue;
      // Drop this path if a longer path that starts with it also exists.
      const shadowed = paths.some((other, j) => j !== i && other.length > paths[i].length &&
        paths[i].every((seg, idx) => other[idx] === seg));
      if (shadowed) continue;
      keep.push(i);
    }
    return keep.map((i) => paths[i]);
  }
  function saveState(s) {
    try { localStorage.setItem(TAXONOMY_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }

  function normCat(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  // Cheap stable hash over the joined content snippets — re-classify
  // only when the founder's writing at this location has actually
  // changed since we last asked Claude.
  function fingerprintContent(snippets) {
    if (!snippets || !snippets.length) return "_empty";
    const joined = snippets.join("|");
    let h = 0;
    for (let i = 0; i < joined.length; i++) h = (h * 31 + joined.charCodeAt(i)) | 0;
    return h.toString(36);
  }

  function relTimeLong(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function hashSlot(key, mod) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return ((h % mod) + mod) % mod;
  }

  function initialOf(name) {
    const s = String(name || "").trim();
    return s ? s[0].toUpperCase() : "?";
  }

  // ── Classifier ─────────────────────────────────────────────────────
  let classifying = false;

  async function classifyUncategorized(items, state) {
    if (classifying) return;
    if (!items.length) return;
    if (!window.tinker || typeof window.tinker.callClaude !== "function") return;

    classifying = true;
    try {
      // Render the existing taxonomy compactly for the prompt. Member
      // excerpts are NOT included here — they're already represented
      // by the description Claude wrote when the category was created.
      const taxList = Object.values(state.taxonomy);
      const taxonomyText = taxList.length
        ? taxList.map((c) => {
            const parentName = c.parent && state.taxonomy[c.parent]
              ? ` (sub-category of "${state.taxonomy[c.parent].name}")`
              : "";
            return `- "${c.name}"${parentName}: ${c.description || ""}`;
          }).join("\n")
        : "(none yet — the first location placed will need a brand-new top-level category)";

      const locationBlocks = items.map((loc) => {
        const snippets = (loc.contentSnippets || []).filter(Boolean).slice(-3);
        const body = snippets.length
          ? snippets.map((s) => "  - " + String(s).replace(/\s+/g, " ").trim().slice(0, 220)).join("\n")
          : "  (no writing yet — place using the name as the only hint)";
        return `# ${loc.name}\n${body}`;
      }).join("\n\n");

      const system = [
        "You manage a founder's growing taxonomy of learning categories. Each location they reflect from is placed into the taxonomy based on what they've written there.",
        "",
        "A single location may contain MULTIPLE distinct topics across sessions — return one path per topic. Don't collapse genuinely different topics into one path just to keep things tidy.",
        "",
        "For each path, decide:",
        "  A) It fits an existing top-level category → path: [Top].",
        "  B) It's a distinct, more specific angle of an existing top-level → path: [Top, NewChild]. Add the child to newCategories with parent set to Top.",
        "  C) It's distinctly different from everything existing → path: [NewTop]. Add NewTop to newCategories with parent: null.",
        "",
        "When a single location's topics RELATE to each other (different facets of a shared concern), nest them as siblings under a shared parent. This is how one location 'encompasses' multiple topics — both child paths share the same Top, so the parent names the larger thread the location is part of.",
        "",
        "Rules:",
        "- Strongly prefer A. Create new categories only when the writing genuinely doesn't fit.",
        "- Category names: 2-5 words, title case, identity-aware (e.g. 'Customer learning', 'Solo making', 'Operational chores'). Concrete, not generic.",
        "- Descriptions: EXACTLY 4 words. Tight noun phrase, observational, no advice tone. Examples: 'Specific layout and structure', 'Time near real customers', 'Money out the door'. Never more than 4 words.",
        "- Max nesting depth is 2 (top + one sub). Never propose a 3-level path.",
        "- Don't return both [Top] and [Top, Child] for the same location — keep the more specific one only.",
        "",
        "Output ONLY this JSON shape — no prose, no preamble, no code fences:",
        '{ "assignments": { "<location name>": [ ["Top"] or ["Top","Child"], ... ] },',
        '  "newCategories": [ { "name": "...", "description": "...", "parent": "<existing top> or null" } ] }',
      ].join("\n");

      const userMessage = `Existing taxonomy:\n${taxonomyText}\n\nLocations to place:\n\n${locationBlocks}`;

      const result = await window.tinker.callClaude({
        system,
        messages: [{ role: "user", content: userMessage }],
        model: "claude-haiku-4-5-20251001",
        maxTokens: 600,
      });

      const raw = (result.text || "").trim();
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : {};

      // 1. Register any brand-new categories Claude declared. Parents
      //    are recorded as proposed; we validate them in step 4 so a
      //    child declared before its parent in the array still wires up.
      if (Array.isArray(parsed.newCategories)) {
        for (const cat of parsed.newCategories) {
          if (!cat || typeof cat.name !== "string") continue;
          const key = normCat(cat.name);
          if (!key || state.taxonomy[key]) continue;
          state.taxonomy[key] = {
            name: cat.name.trim(),
            description: String(cat.description || "").trim(),
            parent: cat.parent ? normCat(cat.parent) : null,
          };
        }
      }

      const assignments = (parsed.assignments && typeof parsed.assignments === "object") ? parsed.assignments : {};

      // 2. Auto-create any path segment Claude referenced in an
      //    assignment but didn't declare in newCategories. Common
      //    failure mode: the model emits a new category name in a path
      //    and forgets the parallel entry in newCategories. Without
      //    this, every such path is filtered out and the location
      //    falls back to Unsorted — exactly the "generative sorting
      //    isn't working" symptom.
      for (const claim of Object.values(assignments)) {
        if (!Array.isArray(claim) || !claim.length) continue;
        const pathsToScan = Array.isArray(claim[0]) ? claim : [claim];
        for (const path of pathsToScan) {
          if (!Array.isArray(path)) continue;
          for (let i = 0; i < path.length; i++) {
            const seg = path[i];
            if (typeof seg !== "string" || !seg.trim()) continue;
            const key = normCat(seg);
            if (state.taxonomy[key]) continue;
            // For a 2-segment path the child's parent is index 0.
            const parent = i > 0 ? normCat(path[0]) : null;
            state.taxonomy[key] = { name: seg.trim(), description: "", parent };
          }
        }
      }

      // 3. Validate parents: null out any parent reference that doesn't
      //    actually exist in the taxonomy. Handles the child-declared-
      //    before-parent ordering case from step 1.
      for (const cat of Object.values(state.taxonomy)) {
        if (cat.parent && !state.taxonomy[cat.parent]) cat.parent = null;
      }

      // 4. Place each location into one or more paths.
      //    Multiple paths capture multi-topic locations — the same
      //    card will appear under each leaf section.
      for (const loc of items) {
        const claimed = assignments[loc.name];
        // Accept either the new shape ([["Top"],["Top","Child"]]) or
        // the older single-path shape (["Top"]) so we tolerate the
        // model occasionally collapsing back to a single path.
        let rawPaths = [];
        if (Array.isArray(claimed) && claimed.length) {
          if (Array.isArray(claimed[0])) rawPaths = claimed;
          else rawPaths = [claimed];
        }
        const paths = rawPaths
          .map((p) => (Array.isArray(p) ? p.map(normCat).filter((k) => state.taxonomy[k]) : []))
          .filter((p) => p.length > 0);
        const deduped = dedupePaths(paths);
        const fp = fingerprintContent(loc.contentSnippets || []);
        if (deduped.length === 0) {
          ensureUnsorted(state);
          state.locations[loc.key] = { paths: [[UNSORTED_KEY]], fp };
        } else {
          state.locations[loc.key] = { paths: deduped, fp };
        }
      }

      saveState(state);
    } catch {
      // Network / parse failure — assign everything to Unsorted so the
      // UI settles instead of spinning. Founder can prompt a retry by
      // adding more writing (changes the fingerprint).
      ensureUnsorted(state);
      for (const loc of items) {
        state.locations[loc.key] = {
          paths: [[UNSORTED_KEY]],
          fp: fingerprintContent(loc.contentSnippets || []),
        };
      }
      saveState(state);
    } finally {
      classifying = false;
      const mount = document.getElementById("home-list");
      if (mount) render(mount);
    }
  }

  function ensureUnsorted(state) {
    if (state.taxonomy[UNSORTED_KEY]) return;
    state.taxonomy[UNSORTED_KEY] = {
      name: "Unsorted",
      description: "Awaiting more writing here",
      parent: null,
    };
  }

  // Trim descriptions to four words at render time so legacy entries
  // already in localStorage (Claude used to be asked for 8-15 words)
  // line up with the new four-word format without a migration step.
  // If the cut lands on a dangling function word ("Lessons about sharing and"),
  // drop it so the subtitle reads as a complete phrase.
  const TRAILING_STOP_WORDS = new Set([
    "and", "or", "but", "nor", "yet", "so", "for",
    "a", "an", "the",
    "of", "in", "on", "at", "by", "to", "with", "from", "into", "onto", "about",
    "as", "if", "than", "that", "which",
    "my", "your", "our", "their", "his", "her", "its",
  ]);
  function shortDescription(s) {
    const words = String(s || "").trim().split(/\s+/).filter(Boolean);
    const truncated = words.slice(0, 4);
    while (truncated.length > 1) {
      const tail = truncated[truncated.length - 1].toLowerCase().replace(/[.,;:!?]+$/, "");
      if (!TRAILING_STOP_WORDS.has(tail)) break;
      truncated.pop();
    }
    return truncated.join(" ");
  }

  // ── Rendering ──────────────────────────────────────────────────────
  function render(mountEl) {
    if (!mountEl) return { all: 0 };
    const locations = (window.tinkerLocations && typeof window.tinkerLocations.list === "function")
      ? window.tinkerLocations.list()
      : [];

    mountEl.innerHTML = "";

    if (locations.length === 0) {
      mountEl.appendChild(renderEmpty());
      return { all: 0 };
    }

    const state = loadState();
    const PENDING = "__pending__";

    // Two buckets per location now (no more AWAITING):
    //   1. PENDING — no cached placement yet, OR content fingerprint
    //      shifted, OR cached path references a category that's
    //      since been removed. Eager classification handles these.
    //   2. Categorised — has a valid path. Grouped by leaf category.
    // Locations without any writing still classify eagerly from their
    // name alone (the classifier is happy with name-only input).
    const groups = new Map();
    for (const loc of locations) {
      const stored = state.locations[loc.key];
      const currentFp = fingerprintContent(loc.contentSnippets || []);
      const pathsValid = stored && Array.isArray(stored.paths) && stored.paths.length
        && stored.paths.every((p) => Array.isArray(p) && p.length && p.every((seg) => state.taxonomy[seg]));
      const fpMatches = stored && stored.fp === currentFp;

      if (!pathsValid || !fpMatches) {
        if (!groups.has(PENDING)) groups.set(PENDING, { items: [], path: null });
        groups.get(PENDING).items.push(loc);
        continue;
      }

      // A location can hold multiple topic paths — surface the card
      // under each leaf so a multi-topic place shows up in every
      // category it touches.
      for (const path of stored.paths) {
        const leaf = path[path.length - 1];
        if (!groups.has(leaf)) groups.set(leaf, { items: [], path });
        groups.get(leaf).items.push(loc);
      }
    }

    // Sort within each group by recency, most-recent first.
    for (const g of groups.values()) {
      g.items.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    }

    // Section order: PENDING (loading) → categorised, with sub-
    // categories sitting directly under their parents alphabetical.
    const sections = [];
    if (groups.has(PENDING)) sections.push([PENDING, groups.get(PENDING)]);

    const categorised = Array.from(groups.entries()).filter(([k]) => k !== PENDING);
    categorised.sort(([, a], [, b]) => sectionRank(a.path, state).localeCompare(sectionRank(b.path, state)));
    for (const entry of categorised) sections.push(entry);

    for (const [key, group] of sections) {
      const section = document.createElement("section");
      section.className = "home-list__section";

      const head = document.createElement("header");
      head.className = "home-list__group-head";

      if (key === PENDING) {
        head.innerHTML =
          `<h3 class="home-list__group home-list__group--loading">Sorting…</h3>`;
      } else {
        const leaf = state.taxonomy[key];
        const nested = group.path.length > 1;
        const names = group.path.map((p) => state.taxonomy[p]?.name || p);
        if (nested) section.classList.add("home-list__section--nested");
        const breadcrumb = names
          .map((n, i) => i === 0
            ? `<span class="home-list__crumb">${escapeHtml(n)}</span>`
            : `<span class="home-list__crumb-sep" aria-hidden="true">›</span><span class="home-list__crumb home-list__crumb--leaf">${escapeHtml(n)}</span>`)
          .join("");
        head.innerHTML =
          `<h3 class="home-list__group${nested ? " home-list__group--nested" : ""}">${breadcrumb}</h3>` +
          (leaf?.description ? `<p class="home-list__group-sub">${escapeHtml(shortDescription(leaf.description))}</p>` : "");
      }
      section.appendChild(head);

      for (const loc of group.items) section.appendChild(renderCard(loc));
      mountEl.appendChild(section);
    }

    // Defer to next tick so the DOM paints before we fire the call.
    if (groups.has(PENDING)) {
      const pendingItems = groups.get(PENDING).items;
      setTimeout(() => classifyUncategorized(pendingItems, state), 50);
    }

    return { all: locations.length };
  }

  // Build a sortable key so top-level categories come first alphabetically,
  // and a sub-category always sits directly under its parent. Format:
  // "<top-level-name><child-name>" — the low-byte separator ensures
  // parent rows ("Customer learning") precede their children ("Customer
  // learningFounder–customer alignment") in localeCompare.
  function sectionRank(path, state) {
    if (!path || !path.length) return "￿";
    const topName = state.taxonomy[path[0]]?.name || path[0];
    const leafName = path.length > 1 ? (state.taxonomy[path[path.length - 1]]?.name || path[path.length - 1]) : "";
    return leafName ? `${topName}${leafName}` : topName;
  }

  function renderEmpty() {
    const empty = document.createElement("div");
    empty.className = "home-list__empty";
    empty.innerHTML = `
      <p class="home-list__empty-title">No locations yet.</p>
      <p class="home-list__empty-sub">Tap the <strong>+</strong> above to add a place you reflect from. Claude will sort each one into a category once you've written there — and the categories will grow with you.</p>
    `;
    return empty;
  }

  // Layout the row as a Slack-style channel: avatar + name on top,
  // and (when one exists) the title of the most recent writing
  // produced at this location stacked below. The "last used" line is
  // gone — the writing title carries that signal more usefully.
  function renderCard(loc) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "home-card";

    const colour = PALETTE[hashSlot(loc.key, PALETTE.length)];
    const writing = loc.latestWriting && loc.latestWriting.title ? loc.latestWriting : null;
    if (writing) card.classList.add("home-card--has-writing");

    const subline = writing
      ? `<span class="home-card__sub home-card__sub--title">${escapeHtml(writing.title)}</span>`
      : "";

    card.innerHTML =
      `<span class="home-card__avatar" aria-hidden="true" style="background:${colour}">${escapeHtml(initialOf(loc.name))}</span>` +
      `<span class="home-card__body">` +
        `<span class="home-card__name">${escapeHtml(loc.name)}</span>` +
        subline +
      `</span>`;

    card.addEventListener("click", () => openLocation(loc));
    return card;
  }

  // Tap routing: if a writing piece already exists at this location,
  // open it (read view for essays, resume for drafts). Otherwise spin
  // up a fresh session anchored at the location.
  function openLocation(loc) {
    const w = loc.latestWriting;
    if (w && w.type === "essay" && typeof window.tinkerOpenEssay === "function") {
      window.tinkerOpenEssay(w.id);
      return;
    }
    if (w && w.type === "draft" && typeof window.tinkerResumeDraft === "function") {
      window.tinkerResumeDraft(w.id);
      return;
    }
    if (typeof window.tinkerNewSession === "function") {
      window.tinkerNewSession({ location: loc.name });
    }
  }

  window.tinkerHeatmap = { render };
})();
