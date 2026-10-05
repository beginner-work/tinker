/* Shared open helpers for /exercises (desktop IDE vs GitHub fallback). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerExercisesOpen = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var GITHUB_TREE =
    "https://github.com/tlindow/lindowlabs/tree/main/exercises";

  function githubModuleUrl(moduleId) {
    var id = String(moduleId || "").trim();
    return GITHUB_TREE + "/" + encodeURIComponent(id);
  }

  function cursorDeepLink(moduleId) {
    var gh = githubModuleUrl(moduleId);
    return "cursor://anysphere.cursor-deeplink/open?url=" + encodeURIComponent(gh);
  }

  function isDesktopShell(api) {
    var tinker = api || (typeof window !== "undefined" ? window.tinker : null);
    if (!tinker || typeof tinker !== "object") return false;
    if (typeof tinker.openExerciseModule === "function") return true;
    return !!(tinker.isDesktopApp || tinker.supportsWebview);
  }

  function openExternalUrl(url, tinker) {
    if (tinker && typeof tinker.openExternal === "function") {
      tinker.openExternal(url);
      return;
    }
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  /**
   * Open a module. Desktop uses the Electron bridge (clone/pull + IDE).
   * Web and phone fall back to the GitHub tree URL.
   */
  function openModule(moduleId, api, opts) {
    var tinker = api || (typeof window !== "undefined" ? window.tinker : null);
    var options = opts || {};
    var url = githubModuleUrl(moduleId);

    if (tinker && typeof tinker.openExerciseModule === "function") {
      return Promise.resolve(
        tinker.openExerciseModule(moduleId, {
          preferCommand: options.preferCommand || "",
        })
      ).then(function (result) {
        return result && typeof result === "object"
          ? result
          : { ok: true, via: "desktop" };
      });
    }

    openExternalUrl(url, tinker);
    return Promise.resolve({ ok: true, via: "github", url: url });
  }

  /**
   * Prefer Cursor on desktop (local open with preferCommand=cursor, then
   * cursor:// deep link). Phone and web always use GitHub.
   */
  function openInCursor(moduleId, api) {
    var tinker = api || (typeof window !== "undefined" ? window.tinker : null);
    if (isDesktopShell(tinker) && tinker && typeof tinker.openExerciseModule === "function") {
      return openModule(moduleId, tinker, { preferCommand: "cursor" }).then(function (result) {
        if (result && result.ok !== false) return result;
        var deep = cursorDeepLink(moduleId);
        openExternalUrl(deep, tinker);
        return { ok: true, via: "cursor-deeplink", url: deep };
      });
    }
    var url = githubModuleUrl(moduleId);
    openExternalUrl(url, tinker);
    return Promise.resolve({ ok: true, via: "github", url: url });
  }

  return {
    GITHUB_TREE: GITHUB_TREE,
    githubModuleUrl: githubModuleUrl,
    cursorDeepLink: cursorDeepLink,
    isDesktopShell: isDesktopShell,
    openModule: openModule,
    openInCursor: openInCursor,
  };
});
