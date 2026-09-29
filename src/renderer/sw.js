/* sw.js — tinker's offline app shell.
 *
 * Without this worker the app is "PWA-shaped" (manifest, installable)
 * but has no offline capability: a refresh with no connection dies at
 * the first request for index.html. This worker precaches the static
 * shell and serves it when the network is unreachable, so a refresh —
 * or a cold launch of the installed app on a plane — brings the UI
 * back. Combined with the writing already in localStorage (see
 * sync.js), the signed-in app reconstitutes itself with no signal.
 *
 * Strategy:
 *   - Navigations  → network-first, falling back to the cached shell.
 *     Online always gets the freshest index.html; offline gets the last
 *     one seen. This keeps update-banner.js's version/reload flow intact.
 *   - CSS and JS → network-first (not stale-while-revalidate). Installed
 *     PWAs were painting old styles.css against new HTML after deploys
 *     because iOS often deferred the SWR revalidate; the first paint
 *     looked unstyled (raw blue links, half-open drawer). Cache is only
 *     the offline fallback.
 *   - Other same-origin assets (icons, fonts under same origin, tokens)
 *     → stale-while-revalidate for instant paint.
 *   - /api/* → never touched. Those stay on the network, where the
 *     page's free write mode gate (freewrite.js) and the JWT auth live.
 *     Caching user data here would defeat both.
 *   - Cross-origin (Google Fonts, vercel.live) → passed straight
 *     through. The CSP only allows fonts via <link>/@font-face, and the
 *     font stack falls back to system faces offline, so there's nothing
 *     to gain from caching them here.
 *
 * Freshness: bump CACHE_VERSION when the precache list or this file's
 * logic changes so activate evicts the old cache on every client.
 */

const CACHE_VERSION = "tinker-shell-v10";

// The shell, mirroring the <link>/<script> tags in index.html plus the
// icons/tokens the first paint needs. Keep in sync when assets are added
// or removed, and bump CACHE_VERSION when you do.
const PRECACHE = [
  "/",
  "/index.html",
  // styles
  "/styles.css",
  "/design-tokens.css",
  "/mobile-drawer.css",
  "/pwa-install-hint.css",
  "/profile.css",
  // scripts (document order)
  "/pwa-session.js",
  "/freewrite.js",
  "/sync.js",
  "/transactions.js",
  "/seeds.js",
  "/heatmap.js",
  "/lead-drafts.js",
  "/lead-funnel.js",
  "/platform-mobile.js",
  "/auth.js",
  "/lib/rainbow-web.js",
  "/icon-init.js",
  "/interview-prompt.js",
  "/writing.js",
  "/renderer.js",
  "/messages-shell.js",
  "/messages-thread.js",
  "/messages-composer.js",
  "/messages-you.js",
  "/mobile-drawer.js",
  "/pwa-install-hint.js",
  "/share.js",
  "/update-banner.js",
  "/notifications.js",
  "/profile.js",
  "/back-me.js",
  "/open-beginner.js",
  "/wallet.js",
  "/email.js",
  "/linkedin-draft.js",
  "/voice-model.js",
  "/membership.js",
  "/pwa-offline.js",
  // shell chrome assets
  "/manifest.json",
  "/favicon.svg",
  "/icons/tinker-icon.svg",
  "/icons/tinker-icon-192.png",
  "/icons/tinker-icon-512.png",
  "/icons/tinker-icon-180.png",
  "/icons/tinker-mark.svg",
  "/icons/lindow-labs.svg",
  "/tokens/rainbow-web.json",
];

self.addEventListener("message", (event) => {
  if (event && event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Resilient precache: one missing/renamed asset shouldn't sink the
    // whole offline cache, so add entries independently rather than with
    // addAll's all-or-nothing semantics. `cache: "reload"` bypasses the
    // HTTP cache so the worker captures fresh bytes at install time.
    await Promise.allSettled(
      PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" }))),
    );
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache writes (api PUT/POST)

  let url;
  try { url = new URL(req.url); } catch { return; }

  const sameOrigin = url.origin === self.location.origin;
  // Leave the API on the network — freewrite.js gates it page-side, and
  // it's per-user/authenticated, so it must never be cached.
  if (sameOrigin && url.pathname.startsWith("/api/")) return;
  // /autonomy, /career, and /leads are their own pages. Leave them on the network
  // so a visit does not get stored as the offline shell for "/".
  if (sameOrigin && (url.pathname === "/autonomy" || url.pathname.startsWith("/autonomy/"))) return;
  if (sameOrigin && (url.pathname === "/career" || url.pathname.startsWith("/career/"))) return;
  if (sameOrigin && (url.pathname === "/leads" || url.pathname.startsWith("/leads/"))) return;
  // Cross-origin (fonts, vercel.live preview comments): pass through.
  if (!sameOrigin) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirstDoc(req));
    return;
  }
  // CSS/JS must track deploys. SWR first-paint was stranding installed
  // PWAs on pre-inbox styles for hours on iOS.
  if (isFreshShellPath(url.pathname)) {
    event.respondWith(networkFirstAsset(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});

function isFreshShellPath(pathname) {
  return pathname.endsWith(".css") || pathname.endsWith(".js") || pathname.endsWith(".html");
}

async function networkFirstDoc(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(req);
    // Refresh *both* canonical shell keys so the next offline navigation
    // gets the latest welcome screen, regardless of any ?_v= cache-buster
    // update-banner.js may have appended. A navigation to the root requests
    // "/", and the offline fallback matches that entry first — so updating
    // only "/index.html" left the "/" entry frozen at install-time bytes.
    // That stranded installed PWAs on whatever shell was live when the
    // current CACHE_VERSION was precached (an old "Everyone is a founder"
    // welcome lingering offline across deploys). Keep the two in lockstep.
    if (fresh && fresh.ok) {
      cache.put("/", fresh.clone());
      cache.put("/index.html", fresh.clone());
    }
    return fresh;
  } catch {
    return (
      (await cache.match(req)) ||
      (await cache.match("/index.html")) ||
      (await cache.match("/")) ||
      offlineFallback()
    );
  }
}

async function networkFirstAsset(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(req, { cache: "no-cache" });
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(req)) || offlineFallback();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || offlineFallback();
}

function offlineFallback() {
  return new Response("", { status: 504, statusText: "Offline" });
}
