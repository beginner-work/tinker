/* made-by-lindow-labs.js — quiet credit + Learning Lab external links.
 *
 * Wires [data-learning-lab] and [data-made-by-lindow-labs] anchors so the
 * Mac app uses window.tinker.openExternal (shell.openExternal). On the web,
 * normal target=_blank navigation is left alone.
 */
(function () {
  "use strict";

  /** Stytch login for the Lindow Labs Learning dashboard. Hostname is easy to swap. */
  var LEARNING_LAB_URL = "https://lindowlabs.dev/learning";

  var MADE_BY_URL =
    "https://lindowlabs.dev/?utm_source=tinker&utm_campaign=made-by";

  function openExternal(u) {
    if (window.tinker && typeof window.tinker.openExternal === "function") {
      window.tinker.openExternal(u);
      return true;
    }
    return false;
  }

  function urlFor(anchor) {
    if (!anchor) return MADE_BY_URL;
    if (anchor.hasAttribute("data-learning-lab")) return LEARNING_LAB_URL;
    return MADE_BY_URL;
  }

  function onClick(event) {
    var a = event.target && event.target.closest
      ? event.target.closest("[data-learning-lab], [data-made-by-lindow-labs]")
      : null;
    if (!a) return;
    if (openExternal(urlFor(a))) {
      event.preventDefault();
    }
  }

  function bind() {
    document.addEventListener("click", onClick, false);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bind);
    } else {
      bind();
    }
  }

  window.tinkerMadeByLindowLabs = {
    url: MADE_BY_URL,
    learningLabUrl: LEARNING_LAB_URL,
    openExternal: openExternal,
  };
})();
