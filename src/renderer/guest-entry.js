/* tinker — anonymous first-entry attribution
 *
 * On the plain web build the app now opens straight onto the welcome
 * screen (the location grid) instead of the phone/PIN gate, and a
 * signed-out founder can answer up to three interview questions before
 * being asked to sign in. This module is how that pre-login work gets
 * attributed: at first touch it mints an anonymous entry id, records
 * the location the founder picked and each answer they typed, and —
 * the moment a verify lands (tinker:auth-changed) — POSTs the whole
 * entry to /api/entry/attach so the server can tie it to the Stytch
 * user + session that just signed in.
 *
 * Storage: one JSON blob under "tinker.guest-entry.v1" —
 *   { id, createdAt, location, answers: [{ q, a, at }], attachedAt }
 *
 * The blob survives reloads, so a founder who answers two questions,
 * closes the tab, and comes back tomorrow still gets their entry
 * attributed when they eventually sign in. Attach is idempotent —
 * the server merges by entry id — so retrying is always safe.
 *
 * Electron desktop and Capacitor mobile never gate on Stytch, so
 * isGuest() is false there and every recorder no-ops.
 */

(function () {
  "use strict";

  const TOKEN_KEY = "tinker_jwt";
  const ENTRY_KEY = "tinker.guest-entry.v1";

  // How many interview questions a signed-out founder can answer before
  // the auth gate takes over. writing.js reads this via the public api.
  const QUESTION_LIMIT = 3;

  // ── Platform / auth state ────────────────────────────────────────────
  // Same detection auth.js uses: the platform-mobile shim adds .on-web
  // to <html> on plain web; Electron's preload exposes supportsWebview.

  function isWebPlatform() {
    if (window.tinker && window.tinker.supportsWebview === true) return false; // Electron
    return document.documentElement.classList.contains("on-web");
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  // ── Entry store ──────────────────────────────────────────────────────

  function read() {
    try {
      const raw = localStorage.getItem(ENTRY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch { return null; }
  }

  function write(entry) {
    try { localStorage.setItem(ENTRY_KEY, JSON.stringify(entry)); }
    catch { /* ignore */ }
  }

  function makeId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
    } catch { /* fall through */ }
    return `ge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function ensure() {
    let entry = read();
    if (!entry || typeof entry.id !== "string" || !entry.id) {
      entry = {
        id: makeId(),
        createdAt: Date.now(),
        location: null,
        answers: [],
        attachedAt: null,
      };
      write(entry);
    }
    if (!Array.isArray(entry.answers)) entry.answers = [];
    return entry;
  }

  // ── Public API ───────────────────────────────────────────────────────

  const api = {
    limit: QUESTION_LIMIT,

    /** True when the pre-login (guest) flow applies: plain web, no token. */
    isGuest() {
      return isWebPlatform() && !token();
    },

    /** The raw entry blob, or null if nothing has been recorded yet. */
    entry() {
      return read();
    },

    questionsUsed() {
      const entry = read();
      return entry && Array.isArray(entry.answers) ? entry.answers.length : 0;
    },

    questionsRemaining() {
      return Math.max(0, QUESTION_LIMIT - api.questionsUsed());
    },

    /** The founder tapped a location on the welcome grid while signed out. */
    recordLocation(name) {
      if (!api.isGuest()) return;
      const label = String(name || "").trim().slice(0, 120);
      if (!label) return;
      const entry = ensure();
      entry.location = label;
      write(entry);
    },

    /** The founder answered an interview question while signed out. */
    recordAnswer(question, answer) {
      if (!api.isGuest()) return;
      const q = String(question || "").trim().slice(0, 300);
      const a = String(answer || "").trim().slice(0, 4000);
      if (!q || !a) return;
      const entry = ensure();
      entry.answers.push({ q, a, at: Date.now() });
      write(entry);
    },

    /** Tie the recorded entry to the account that just signed in.
     *  Idempotent — the server merges by entry id, and a successful
     *  attach is remembered locally so it only fires once. */
    async attach() {
      const t = token();
      const entry = read();
      if (!t || !entry || entry.attachedAt) return false;
      // Nothing to attribute: the founder signed in without touching
      // the grid or the interview first.
      if (!entry.location && (!entry.answers || entry.answers.length === 0)) return false;
      let res;
      try {
        res = await fetch("/api/entry/attach", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${t}`,
          },
          body: JSON.stringify({
            entry: {
              id: entry.id,
              createdAt: entry.createdAt,
              location: entry.location,
              answers: entry.answers,
            },
          }),
        });
      } catch {
        return false; // offline / network — the boot kick retries next load
      }
      if (!res.ok) return false;
      entry.attachedAt = Date.now();
      write(entry);
      try {
        window.dispatchEvent(new CustomEvent("tinker:entry-attached", {
          detail: { entryId: entry.id },
        }));
      } catch { /* ignore */ }
      return true;
    },
  };

  window.tinkerGuestEntry = api;

  // Attach the moment a verify lands…
  window.addEventListener("tinker:auth-changed", () => {
    api.attach().catch(() => { /* ignore */ });
  });

  // …and catch a signed-in load whose attach never made it (the POST
  // failed, or the page reloaded between verify and attach).
  function kick() {
    if (token()) api.attach().catch(() => { /* ignore */ });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kick, { once: true });
  } else {
    kick();
  }
})();
