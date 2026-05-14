/* preview-reset.js — wipe localStorage on every page load when the
 * app is running on a Vercel preview deployment or on localhost.
 *
 * Keeps QA sessions completely fresh: dismissed coach-marks, drafts,
 * and any other persisted state are gone on each load so testing
 * starts from a clean slate. Inert on production hostnames so real
 * users keep their auth token and preferences across reloads.
 *
 * Loaded as the first deferred script in index.html — defer scripts
 * run in document order before DOMContentLoaded, so by the time
 * auth.js, the platform shim, or pwa-install-hint.js read from
 * localStorage, the wipe has already happened.
 */

(function () {
  try {
    const h = location.hostname;
    // Vercel preview URLs always contain "-git-"; production URLs
    // (e.g. tinker.vercel.app or a custom domain) do not.
    const isPreview =
      h.includes("-git-") ||
      h === "localhost" ||
      h === "127.0.0.1";
    if (!isPreview) return;
    localStorage.clear();
    sessionStorage.clear();
    // eslint-disable-next-line no-console
    console.info("[tinker] preview/dev — localStorage cleared");
  } catch {
    /* private mode or storage disabled — nothing to clear */
  }
})();
