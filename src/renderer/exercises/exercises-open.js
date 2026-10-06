/* Shared open helpers for /exercises (desktop IDE vs GitHub / external). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(typeof require === "function" ? require : null);
  } else {
    root.tinkerExercisesOpen = factory(null);
  }
})(typeof self !== "undefined" ? self : this, function (nodeRequire) {
  "use strict";

  var GITHUB_BLOB = "https://github.com/beginner-work/tinker/blob/main";
  var GITHUB_TREE_ROOT = "https://github.com/beginner-work/tinker/tree/main";
  var GITHUB_TREE =
    "https://github.com/beginner-work/tinker/tree/main/exercises";

  function githubPathUrl(relPath) {
    var clean = String(relPath || "").replace(/^\/+/, "");
    if (!clean) return GITHUB_TREE;
    var parts = clean.split("/").filter(Boolean);
    var leaf = parts[parts.length - 1] || "";
    var isFile = /\.[a-z0-9]+$/i.test(leaf);
    var base = isFile ? GITHUB_BLOB : GITHUB_TREE_ROOT;
    return (
      base +
      "/" +
      parts
        .map(function (part) {
          return encodeURIComponent(part);
        })
        .join("/")
    );
  }

  function getManifest() {
    if (typeof window !== "undefined" && window.tinkerExercisesManifest) {
      return window.tinkerExercisesManifest;
    }
    if (nodeRequire) {
      try {
        return nodeRequire("./manifest.js");
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function findModule(moduleId) {
    var id = String(moduleId || "").trim();
    var manifest = getManifest();
    var modules = manifest && Array.isArray(manifest.modules) ? manifest.modules : [];
    for (var i = 0; i < modules.length; i += 1) {
      if (modules[i] && String(modules[i].id || "").trim() === id) return modules[i];
    }
    return null;
  }

  function githubModuleUrl(moduleId) {
    var id = String(moduleId || "").trim();
    var mod = findModule(id);
    if (mod && mod.externalUrl) return String(mod.externalUrl);
    if (mod && mod.path) return githubPathUrl(mod.path);
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
   * External-only modules open their URL. Web and phone fall back to GitHub.
   */
  function openModule(moduleId, api, opts) {
    var tinker = api || (typeof window !== "undefined" ? window.tinker : null);
    var options = opts || {};
    var mod = findModule(moduleId);
    var url = githubModuleUrl(moduleId);

    if (mod && mod.externalUrl) {
      openExternalUrl(String(mod.externalUrl), tinker);
      return Promise.resolve({
        ok: true,
        via: "external",
        url: String(mod.externalUrl),
      });
    }

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
   * cursor:// deep link). Phone and web always use GitHub or external URL.
   */
  function openInCursor(moduleId, api) {
    var tinker = api || (typeof window !== "undefined" ? window.tinker : null);
    var mod = findModule(moduleId);
    if (mod && mod.externalUrl) {
      openExternalUrl(String(mod.externalUrl), tinker);
      return Promise.resolve({
        ok: true,
        via: "external",
        url: String(mod.externalUrl),
      });
    }
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
    GITHUB_BLOB: GITHUB_BLOB,
    GITHUB_TREE: GITHUB_TREE,
    findModule: findModule,
    githubModuleUrl: githubModuleUrl,
    cursorDeepLink: cursorDeepLink,
    isDesktopShell: isDesktopShell,
    openModule: openModule,
    openInCursor: openInCursor,
  };
});
