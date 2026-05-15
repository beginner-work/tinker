/* preview-reset.js — wipe non-session localStorage on every page load
 * when the app is running on a Vercel preview deployment or localhost.
 *
 * Keeps QA sessions fresh while preserving the user's auth: drafts,
 * seeds, taxonomy, transactions, and coach-mark dismissals are
 * gone on each load so testing starts from a clean slate, but the
 * phone-verification JWT (and its associated phone identifiers) stay
 * put — re-verifying via SMS on every preview reload would defeat
 * the point. Inert on production hostnames.
 *
 * Loaded as the first deferred script in index.html — defer scripts
 * run in document order before DOMContentLoaded, so by the time
 * auth.js, the platform shim, or pwa-install-hint.js read from
 * localStorage, the wipe has already happened.
 */

(function () {
  // Keys belonging to the user's session, kept across preview reloads.
  // Mirror auth.js: TOKEN_KEY="tinker_jwt", PHONE_KEY="tinker_phone",
  // PHONE_ID_KEY="tinker_phone_id".
  const SESSION_KEYS = ["tinker_jwt", "tinker_phone", "tinker_phone_id"];

  try {
    const h = location.hostname;
    // Vercel preview URLs always contain "-git-"; production URLs
    // (e.g. tinker.vercel.app or a custom domain) do not.
    const isPreview =
      h.includes("-git-") ||
      h === "localhost" ||
      h === "127.0.0.1";
    if (!isPreview) return;

    const preserved = {};
    for (const k of SESSION_KEYS) {
      const v = localStorage.getItem(k);
      if (v !== null) preserved[k] = v;
    }
    localStorage.clear();
    sessionStorage.clear();
    for (const k in preserved) localStorage.setItem(k, preserved[k]);

    // eslint-disable-next-line no-console
    console.info("[tinker] preview/dev — localStorage cleared (session keys preserved)");
  } catch {
    /* private mode or storage disabled — nothing to clear */
  }
})();
