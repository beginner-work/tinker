/* made-by-lindow-labs.js — quiet credit link to lindowlabs.dev.
 *
 * Wires [data-made-by-lindow-labs] anchors so the Mac app uses
 * window.tinker.openExternal (same bridge as open-beginner / wallet).
 * On the web, the normal target=_blank navigation is left alone.
 */
(function () {
  "use strict";

  var URL =
    "https://lindowlabs.dev/?utm_source=tinker&utm_campaign=made-by";

  function openExternal(u) {
    if (window.tinker && typeof window.tinker.openExternal === "function") {
      window.tinker.openExternal(u);
      return true;
    }
    return false;
  }

  function onClick(event) {
    var a = event.target && event.target.closest
      ? event.target.closest("[data-made-by-lindow-labs]")
      : null;
    if (!a) return;
    if (openExternal(URL)) {
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

  window.tinkerMadeByLindowLabs = { url: URL, openExternal: openExternal };
})();
