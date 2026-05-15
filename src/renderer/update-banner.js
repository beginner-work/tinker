/* update-banner.js — surfaces the install banner (#pwa-hint) in
 * "update" mode whenever /api/version reports a newer deploy than
 * the one this tab loaded with.
 *
 * Reuses the install hint's DOM and CSS; only the subtitle copy and
 * the action button get rewritten ("Install" → "Update", install-
 * sheet click handler → page reload). The data-pwa-action values
 * are renamed at the same time so pwa-install-hint.js's delegated
 * click handler doesn't double-fire on update-mode clicks.
 *
 * Capacitor (mobile shell) and Electron desktop are skipped — their
 * updates ship through their own channels (App Store / auto-updater),
 * not via a web reload.
 *
 * Per-version dismiss: clicking × in update mode hides the banner and
 * remembers the version that was dismissed. A subsequent deploy bumps
 * the SHA past the dismissed value and the banner returns.
 */

(function () {
  const VERSION_URL = "/api/version";
  const POLL_MS = 60_000;

  function isWrappedRuntime() {
    if (window.Capacitor) return true;
    if (window.tinker && window.tinker.supportsWebview === true) return true;
    return false;
  }

  async function fetchVersion() {
    try {
      const res = await fetch(VERSION_URL, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data.version !== "string") return null;
      return {
        version: data.version,
        summary: typeof data.summary === "string" && data.summary ? data.summary : "Bug fixes",
      };
    } catch {
      return null;
    }
  }

  function start() {
    if (isWrappedRuntime()) return;

    const banner = document.getElementById("pwa-hint");
    if (!banner) return;
    const subtitle = banner.querySelector(".pwa-hint__subtitle");
    const actionBtn = banner.querySelector(".pwa-hint__action");
    const dismissBtn = banner.querySelector(".pwa-hint__dismiss");
    if (!subtitle || !actionBtn || !dismissBtn) return;

    let baselineVersion = null;
    let dismissedVersion = null;
    let inUpdateMode = false;

    function enterUpdateMode(version, summary) {
      inUpdateMode = true;
      banner.dataset.mode = "update";
      subtitle.textContent = summary || "Bug fixes";
      actionBtn.textContent = "Update";
      // Re-key the action attributes so pwa-install-hint.js's
      // delegated handler (looking for "install" / "dismiss") stops
      // matching, and our handler below takes over.
      actionBtn.dataset.pwaAction = "update";
      dismissBtn.dataset.pwaAction = "update-dismiss";
      banner.setAttribute("aria-label", "App update available");
      banner.dataset.updateVersion = version;
      banner.hidden = false;
      document.documentElement.classList.add("pwa-hint-visible");
    }

    function reload() {
      const url = new URL(window.location.href);
      url.searchParams.set("_v", Date.now().toString(36));
      window.location.replace(url.toString());
    }

    function dismiss() {
      dismissedVersion = banner.dataset.updateVersion || dismissedVersion;
      banner.hidden = true;
      document.documentElement.classList.remove("pwa-hint-visible");
    }

    banner.addEventListener("click", (e) => {
      const action = e.target.closest("[data-pwa-action]");
      if (!action) return;
      const kind = action.dataset.pwaAction;
      if (kind === "update") reload();
      else if (kind === "update-dismiss") dismiss();
    });

    async function check() {
      const current = await fetchVersion();
      if (!current) return;
      if (!baselineVersion) {
        baselineVersion = current.version;
        return;
      }
      if (current.version === baselineVersion) return;
      if (current.version === dismissedVersion) return;
      if (inUpdateMode && banner.dataset.updateVersion === current.version) return;
      enterUpdateMode(current.version, current.summary);
    }

    check();
    setInterval(check, POLL_MS);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.addEventListener("focus", check);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
