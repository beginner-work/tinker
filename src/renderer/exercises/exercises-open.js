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

  function isDesktopShell(api) {
    var tinker = api || (typeof window !== "undefined" ? window.tinker : null);
    if (!tinker || typeof tinker !== "object") return false;
    if (typeof tinker.openExerciseModule === "function") return true;
    return !!(tinker.isDesktopApp || tinker.supportsWebview);
  }

  /**
   * Open a module. Desktop uses the Electron bridge (clone/pull + IDE).
   * Web and phone fall back to the GitHub tree URL.
   */
  function openModule(moduleId, api) {
    var tinker = api || (typeof window !== "undefined" ? window.tinker : null);
    var url = githubModuleUrl(moduleId);

    if (tinker && typeof tinker.openExerciseModule === "function") {
      return Promise.resolve(tinker.openExerciseModule(moduleId)).then(
        function (result) {
          return result && typeof result === "object"
            ? result
            : { ok: true, via: "desktop" };
        }
      );
    }

    if (tinker && typeof tinker.openExternal === "function") {
      tinker.openExternal(url);
      return Promise.resolve({ ok: true, via: "github", url: url });
    }

    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return Promise.resolve({ ok: true, via: "github", url: url });
  }

  return {
    GITHUB_TREE: GITHUB_TREE,
    githubModuleUrl: githubModuleUrl,
    isDesktopShell: isDesktopShell,
    openModule: openModule,
  };
});
