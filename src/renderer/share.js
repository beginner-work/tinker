/* share.js — Share via Settings → Pages deep link only.
 *
 * There is no standalone Share control in the main inbox chrome. Settings
 * links to /?open=share, which triggers the native share sheet (or a
 * clipboard fallback). #nav-share stays in the DOM as a hidden hook for
 * that deep link and for flash text; it is never shown in the rail.
 */

(function () {
  function shareUrl() {
    // Prefer the origin root so a shared link opens the landing screen.
    const origin = window.location.origin;
    if (origin && /^https?:/.test(origin)) return origin + "/";
    return window.location.href;
  }

  function flash(node, text) {
    if (!node) return;
    node.textContent = text;
    node.classList.add("is-visible");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => {
      node.classList.remove("is-visible");
      node.textContent = "";
    }, 1800);
  }

  async function doShare(btn) {
    const flashEl = btn.querySelector("[data-share-flash]");
    const url = shareUrl();
    const payload = {
      title: "tinker",
      text: "A quiet place to be on the web.",
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        // AbortError = user dismissed the share sheet; stay quiet.
        if (err && err.name === "AbortError") return;
        // Fall through to clipboard on any other failure.
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        flash(flashEl, "Copied");
        return;
      }
    } catch { /* ignore */ }
    flash(flashEl, "Couldn't share");
  }

  function init() {
    const btn = document.getElementById("nav-share");
    if (!btn) return;
    // Never show a Share control in the main UI; Settings owns the entry.
    btn.hidden = true;
    let openShare = false;
    try {
      const params = new URLSearchParams(window.location.search || "");
      openShare = params.get("open") === "share";
      if (openShare && window.history && window.history.replaceState) {
        params.delete("open");
        const next = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + (window.location.hash || "");
        window.history.replaceState({}, "", next);
      }
    } catch { /* ignore */ }
    if (openShare) setTimeout(() => { doShare(btn); }, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
