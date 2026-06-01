/* pwa-session.js — carry the user's sign-in across the iOS PWA install.
 *
 * iOS Safari partitions storage between the browser context and the
 * standalone PWA. A user who signs in on tinker.app in Safari, then
 * taps Share → Add to Home Screen, lands in a fresh PWA with an empty
 * localStorage and is forced to re-verify by SMS. This file fixes that
 * by smuggling the JWT through the one channel iOS preserves across
 * that boundary: the URL the PWA launches at (the manifest start_url).
 *
 * Two halves:
 *
 *  1. importTokenFromHash() — runs on every page load. If the launch
 *     URL has a `ts=<jwt>` parameter in its fragment, write that JWT
 *     to localStorage as `tinker_jwt` and replaceState() to a clean
 *     URL so the rest of the app sees `/`.
 *
 *  2. injectSessionIntoManifest() — runs once the user is signed in.
 *     Fetches the static manifest, rewrites start_url to
 *     `/#ts=<jwt>`, and points the document's <link rel="manifest">
 *     at a `data:` URL holding the personalised copy. When iOS Safari
 *     reads the manifest at "Add to Home Screen" time, it captures
 *     that start_url; on launch the PWA arrives at `/#ts=<jwt>` and
 *     importTokenFromHash() rescues the token.
 *
 *     The data: URL matters: iOS's AHTS handler runs out-of-process
 *     from the renderer, and cannot resolve a `blob:` URL created by
 *     the page (the blob store is renderer-scoped). A data: URL is
 *     self-contained — the URL itself encodes the manifest bytes, so
 *     any process that parses the URL can read the manifest. Manifest
 *     URLs (icons, scope, start_url) are absolutised first because a
 *     data: URL has no base URL of its own to resolve relatives.
 *
 * The token rides in the URL fragment (not the query) because fragments
 * are never sent to a server — they're stripped from the Referer header
 * and never appear in HTTP request lines. The JWT therefore stays on
 * the device throughout the install flow.
 *
 * No-op on Capacitor / Electron (those have their own session model)
 * and a graceful no-op when localStorage is unavailable or when the
 * manifest fetch fails. The worst-case fallback in any failure mode
 * is today's behaviour: re-sign-in after install.
 */

(function () {
  "use strict";

  const TOKEN_KEY = "tinker_jwt";
  const HASH_PARAM = "ts";
  const CLAIM_KEY = "tinker_claim";
  const CLAIM_PARAM = "claim";

  function isWrappedRuntime() {
    if (window.Capacitor) return true;
    if (window.tinker && window.tinker.supportsWebview === true) return true;
    return false;
  }

  // ── 1. Import token from the launch URL ──────────────────────────────

  function importTokenFromHash() {
    let hash;
    try { hash = location.hash || ""; } catch { return; }
    if (hash.length < 2) return;

    let params;
    try { params = new URLSearchParams(hash.slice(1)); } catch { return; }

    // `ts` carries an existing session (PWA install handoff); `claim`
    // carries a one-time landing-form profile token. Either, both, or
    // neither may be present — the landing form sends only `claim`.
    const token = params.get(HASH_PARAM);
    const claim = params.get(CLAIM_PARAM);
    if (!token && !claim) return;

    if (token) {
      try { localStorage.setItem(TOKEN_KEY, token); }
      catch { /* private mode — nothing we can do */ }
    }
    if (claim) {
      try { localStorage.setItem(CLAIM_KEY, claim); }
      catch { /* private mode — profile.js just won't find a claim */ }
    }

    // Strip both in one history rewrite so the app sees a clean URL.
    params.delete(HASH_PARAM);
    params.delete(CLAIM_PARAM);
    const rest = params.toString();
    const cleanHash = rest ? "#" + rest : "";
    try {
      history.replaceState(null, "", location.pathname + location.search + cleanHash);
    } catch { /* ignore */ }
  }

  // ── 2. Rewrite the manifest with the current session ─────────────────

  async function injectSessionIntoManifest() {
    if (isWrappedRuntime()) return;

    let token;
    try { token = localStorage.getItem(TOKEN_KEY) || ""; }
    catch { return; }
    if (!token) return;

    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;

    // Resolve against the original static manifest, not whatever
    // data: URL we may have already swapped in (which can't be
    // re-fetched as JSON).
    const sourceHref = link.dataset.originalHref || link.href;
    if (!link.dataset.originalHref) link.dataset.originalHref = sourceHref;

    let manifest;
    try {
      const res = await fetch(sourceHref, { cache: "no-store" });
      if (!res.ok) return;
      manifest = await res.json();
    } catch {
      return;
    }
    if (!manifest || typeof manifest !== "object") return;

    // Absolutise URLs in the manifest. A data: URL has no base, so
    // relative paths like "/icons/x.png" or "/" wouldn't resolve when
    // iOS reads them out of the personalised manifest.
    const origin = window.location.origin;
    const absolutise = (url) => {
      try { return new URL(url, origin + "/").href; }
      catch { return url; }
    };
    manifest.start_url =
      origin + "/#" + HASH_PARAM + "=" + encodeURIComponent(token);
    if (manifest.scope) manifest.scope = absolutise(manifest.scope);
    if (Array.isArray(manifest.icons)) {
      manifest.icons = manifest.icons.map((icon) =>
        icon && typeof icon.src === "string"
          ? Object.assign({}, icon, { src: absolutise(icon.src) })
          : icon
      );
    }

    let dataUrl;
    try {
      const json = JSON.stringify(manifest);
      dataUrl =
        "data:application/manifest+json;charset=utf-8," +
        encodeURIComponent(json);
    } catch {
      return;
    }

    link.href = dataUrl;
  }

  // ── Wiring ───────────────────────────────────────────────────────────

  // Import first — must run before auth.js reads `tinker_jwt`.
  importTokenFromHash();

  function scheduleManifestInjection() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectSessionIntoManifest, { once: true });
    } else {
      injectSessionIntoManifest();
    }
  }

  scheduleManifestInjection();

  // Sign-in happens after page load; refresh the manifest then so a
  // user who installs immediately after verifying still gets a
  // personalised start_url.
  window.addEventListener("tinker:auth-changed", () => {
    injectSessionIntoManifest();
  });
})();
