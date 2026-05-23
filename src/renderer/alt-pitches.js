/* tinker — alternate pitches (v0.104)
 *
 * Companion to sidebar-tree.js. The tree mirrors the founder's starter
 * pitch — eleven slide titles + verbatim phrases. Any writing whose
 * classify call returned `deckHeading: null` is "off-pitch" — invisible
 * in the tree, counted only on the secondary bar. This module owns the
 * rest of that life: it groups off-pitch writings into 1–4 alternate
 * pitches (each titled with a single capitalized word) and tracks
 * which pitch the founder is currently looking at, so the sidebar can
 * render that view.
 *
 * Storage:
 *   - tinker.altPitches.v1
 *       { pitches: [{ id, title, writingIds }], generatedFor: <hash>,
 *         updatedAt: <ts> }
 *     Per-device cache of the most recent clustering. `generatedFor` is
 *     a stable hash of the sorted off-pitch writingIds so we know when
 *     to ask the API for a fresh run.
 *
 *   - tinker.activePitch.v1
 *       "starter" | "<altPitchId>"
 *     Per-device pick. The sidebar tree renders the starter deck when
 *     this is "starter" (the default), and the alt-pitch's essay list
 *     otherwise.
 *
 * Events:
 *   - "tinker:alt-pitches-changed"  pitches blob updated; sidebar re-renders.
 *   - "tinker:active-pitch-changed" active pick changed; sidebar re-renders.
 *
 * Wired into the existing tinker:writing-saved flow: when a fresh
 * classify lands and the writing wasn't placed in the tree, this module
 * triggers a regenerate (debounced). Also runs once on boot and again
 * after the sync layer's hydrate finishes.
 */

(() => {
  "use strict";

  const ALT_KEY = "tinker.altPitches.v1";
  const ACTIVE_KEY = "tinker.activePitch.v1";
  const TREE_KEY = "tinker.tree.v1";
  const DRAFTS_KEY = "tinker.drafts.v1";
  const ESSAYS_KEY = "tinker.essays.v1";
  const TOKEN_KEY = "tinker_jwt";

  const STARTER_ID = "starter";
  const REGEN_DEBOUNCE_MS = 1500;

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

  function loadDrafts() {
    const arr = loadJson(DRAFTS_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function loadEssays() {
    const arr = loadJson(ESSAYS_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function loadTree() {
    const obj = loadJson(TREE_KEY, null);
    return obj && typeof obj === "object" ? obj : {};
  }

  // Mirror sidebar-tree.js's view of a draft body — used when the tree
  // is checking whether a draft is represented (and when we hand the
  // alt-pitch clusterer a snippet to read).
  function bodyForDraft(draft) {
    if (draft && draft.stitched && draft.stitched.body) return String(draft.stitched.body);
    const turns = (draft && Array.isArray(draft.transcript)) ? draft.transcript : [];
    return turns.map((t) => String(t && t.a || "").trim()).filter(Boolean).join("\n\n");
  }

  function writingIdsInTree(tree) {
    const ids = new Set();
    if (!tree || typeof tree !== "object") return ids;
    for (const k of Object.keys(tree)) {
      if (k === "_meta") continue;
      const list = tree[k];
      if (!Array.isArray(list)) continue;
      for (const rec of list) {
        if (rec && typeof rec.writingId === "string") ids.add(rec.writingId);
      }
    }
    return ids;
  }

  // Off-pitch = a published essay or a draft with body text whose id
  // does NOT appear anywhere in the deck tree. We only consider
  // writings with a meaningful body — pre-content drafts shouldn't
  // count as a fully-formed alternate beat.
  function listOffPitchWritings() {
    const tree = loadTree();
    const known = writingIdsInTree(tree);
    const out = [];
    for (const e of loadEssays()) {
      if (!e || typeof e.id !== "string") continue;
      const body = String(e.body || "").trim();
      if (!body) continue;
      if (known.has(e.id)) continue;
      out.push({ id: e.id, body, kind: "essay", record: e });
    }
    for (const d of loadDrafts()) {
      if (!d || typeof d.id !== "string") continue;
      const body = bodyForDraft(d).trim();
      if (!body) continue;
      if (known.has(d.id)) continue;
      out.push({ id: d.id, body, kind: "draft", record: d });
    }
    return out;
  }

  // Cheap stable hash of the off-pitch id set, used to dedupe API
  // calls. Same ids in any order → same hash. New id or removed id →
  // different hash and we regenerate.
  function hashIds(ids) {
    const sorted = ids.slice().sort();
    let h = 5381;
    for (const id of sorted) {
      for (let i = 0; i < id.length; i++) {
        h = ((h << 5) + h + id.charCodeAt(i)) | 0;
      }
      h = ((h << 5) + h + 124) | 0; // separator
    }
    return `h${(h >>> 0).toString(36)}_${sorted.length}`;
  }

  function loadCache() {
    const blob = loadJson(ALT_KEY, null);
    if (!blob || typeof blob !== "object") return { pitches: [], generatedFor: null, updatedAt: 0 };
    const pitches = Array.isArray(blob.pitches) ? blob.pitches.filter(isValidPitch) : [];
    return {
      pitches,
      generatedFor: typeof blob.generatedFor === "string" ? blob.generatedFor : null,
      updatedAt: Number(blob.updatedAt) || 0,
    };
  }

  function isValidPitch(p) {
    return p && typeof p === "object"
      && typeof p.id === "string"
      && typeof p.title === "string"
      && Array.isArray(p.writingIds)
      && p.writingIds.every((id) => typeof id === "string");
  }

  function saveCache(blob) {
    saveJson(ALT_KEY, blob);
  }

  // The sidebar tree's audit forbids non-verbatim strings outside its
  // chrome allowlist. Alt-pitch titles are model-generated so we
  // double-check the same shape the API enforces before letting them
  // into the DOM.
  function isValidTitle(s) {
    return typeof s === "string" && /^[A-Z][a-z]{2,13}$/.test(s);
  }

  function loadActive() {
    let raw = "";
    try { raw = localStorage.getItem(ACTIVE_KEY) || ""; }
    catch { /* ignore */ }
    return raw || STARTER_ID;
  }

  function saveActive(id) {
    try { localStorage.setItem(ACTIVE_KEY, String(id || STARTER_ID)); }
    catch { /* ignore */ }
  }

  // ── State ──────────────────────────────────────────────────────────

  let cache = loadCache();
  let activeId = loadActive();
  let regenTimer = null;
  let regenInflight = false;
  let lastHashAttempted = null;

  // ── Public API ─────────────────────────────────────────────────────

  // [{ id, title, kind: "starter"|"alt", writingIds? }] — always
  // includes "starter" first. Alt pitches preserve API order so the
  // founder's chips don't shuffle on every render.
  function getPitches() {
    const out = [{ id: STARTER_ID, title: "Starter", kind: "starter" }];
    for (const p of cache.pitches) {
      if (!p.writingIds.length) continue;
      out.push({ id: p.id, title: p.title, kind: "alt", writingIds: p.writingIds.slice() });
    }
    return out;
  }

  function getActivePitchId() { return activeId; }

  function getPitch(id) {
    if (id === STARTER_ID || !id) return { id: STARTER_ID, title: "Starter", kind: "starter" };
    const p = cache.pitches.find((x) => x.id === id);
    if (!p) return null;
    return { id: p.id, title: p.title, kind: "alt", writingIds: p.writingIds.slice() };
  }

  function setActivePitch(id) {
    const target = id === STARTER_ID || cache.pitches.some((p) => p.id === id) ? id : STARTER_ID;
    if (target === activeId) return;
    activeId = target;
    saveActive(activeId);
    fire("tinker:active-pitch-changed");
  }

  function fire(name) {
    try { window.dispatchEvent(new CustomEvent(name)); }
    catch { /* ignore */ }
  }

  // For each alt-pitch entry, hand back the essay/draft records so the
  // sidebar can render a clickable list. Records are looked up fresh
  // from localStorage so edits flow through immediately.
  function getPitchWritings(id) {
    const p = getPitch(id);
    if (!p || p.kind !== "alt") return [];
    const essays = loadEssays();
    const drafts = loadDrafts();
    const out = [];
    for (const writingId of p.writingIds) {
      const essay = essays.find((e) => e && e.id === writingId);
      if (essay) { out.push({ kind: "essay", record: essay }); continue; }
      const draft = drafts.find((d) => d && d.id === writingId);
      if (draft) out.push({ kind: "draft", record: draft });
    }
    return out;
  }

  // ── Regeneration ───────────────────────────────────────────────────

  function scheduleRegenerate() {
    if (regenTimer) clearTimeout(regenTimer);
    regenTimer = setTimeout(() => {
      regenTimer = null;
      regenerate().catch(() => { /* surfaced via console below */ });
    }, REGEN_DEBOUNCE_MS);
  }

  async function regenerate() {
    if (regenInflight) return;
    const off = listOffPitchWritings();
    const ids = off.map((w) => w.id);
    const nextHash = hashIds(ids);

    // No off-pitch writings — drop any cached buckets and snap the
    // active pick back to starter so the switcher hides itself.
    if (ids.length === 0) {
      if (cache.pitches.length > 0 || cache.generatedFor !== nextHash) {
        cache = { pitches: [], generatedFor: nextHash, updatedAt: Date.now() };
        saveCache(cache);
        fire("tinker:alt-pitches-changed");
      }
      if (activeId !== STARTER_ID) {
        activeId = STARTER_ID;
        saveActive(activeId);
        fire("tinker:active-pitch-changed");
      }
      return;
    }

    // Already up-to-date with the current set of off-pitch ids.
    if (cache.generatedFor === nextHash && cache.pitches.length > 0) return;
    if (lastHashAttempted === nextHash) return; // avoid loops on persistent failure

    let token = "";
    try { token = localStorage.getItem(TOKEN_KEY) || ""; }
    catch { /* ignore */ }
    if (!token) return; // try again after auth

    regenInflight = true;
    lastHashAttempted = nextHash;

    try {
      const res = await fetch("/api/alt-pitches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          writings: off.map((w) => ({ id: w.id, snippet: w.body })),
        }),
      });
      if (!res.ok) {
        try { console.warn(`[tinker.altPitches] ${res.status}`); }
        catch { /* ignore */ }
        return;
      }
      const json = await res.json().catch(() => null);
      if (!json || !Array.isArray(json.pitches)) return;

      // Validate titles on the client too — defense in depth against a
      // malformed reply slipping past the API's validator.
      const valid = [];
      for (const p of json.pitches) {
        if (!p || typeof p !== "object") continue;
        if (!isValidTitle(p.title)) continue;
        const writingIds = Array.isArray(p.writingIds)
          ? p.writingIds.filter((id) => typeof id === "string" && ids.includes(id))
          : [];
        if (writingIds.length === 0) continue;
        valid.push({
          id: `alt_${p.title.toLowerCase()}_${writingIds.length}_${valid.length}`,
          title: p.title,
          writingIds,
        });
      }

      cache = {
        pitches: valid,
        generatedFor: nextHash,
        updatedAt: Date.now(),
      };
      saveCache(cache);

      // If the active pick is an alt pitch that no longer exists (e.g.
      // its only writing was edited into the deck), fall back to starter.
      if (activeId !== STARTER_ID && !valid.some((p) => p.id === activeId)) {
        activeId = STARTER_ID;
        saveActive(activeId);
        fire("tinker:active-pitch-changed");
      }
      fire("tinker:alt-pitches-changed");
    } catch (err) {
      try { console.warn(`[tinker.altPitches] network error`, err); }
      catch { /* ignore */ }
    } finally {
      regenInflight = false;
    }
  }

  const api = {
    STARTER_ID,
    getPitches,
    getActivePitchId,
    getPitch,
    setActivePitch,
    getPitchWritings,
    regenerate,
    scheduleRegenerate,
    listOffPitchWritings,
    isValidTitle,
  };
  window.tinkerAltPitches = api;

  // ── Event hooks ────────────────────────────────────────────────────

  // sidebar-tree.js dispatches tinker:writing-saved on every classify
  // landing. We piggyback so a fresh "doesn't fit" reshuffles the
  // alt-pitch buckets without a separate event.
  window.addEventListener("tinker:writing-saved", () => {
    scheduleRegenerate();
  });

  // After hydrate replaces localStorage from the server, the set of
  // off-pitch writings may be totally different. Reload our cached
  // pick + buckets from the new storage and re-evaluate.
  window.addEventListener("tinker:hydrated", () => {
    cache = loadCache();
    activeId = loadActive();
    fire("tinker:alt-pitches-changed");
    scheduleRegenerate();
  });

  window.addEventListener("tinker:auth-changed", () => {
    scheduleRegenerate();
  });

  // First run after DOM is ready — sidebar tree is already mounted by
  // then and the welcome screen is painted.
  function boot() {
    fire("tinker:alt-pitches-changed");
    scheduleRegenerate();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
