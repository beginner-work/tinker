/* boot-css.js: CSP-safe activation for non-blocking stylesheets.
 *
 * Fonts and secondary chrome CSS are fetched with preload / media=print so
 * they do not block first paint. script-src disallows inline onload handlers,
 * so this tiny deferred module (first in the critical list) flips them on.
 */
(function () {
  "use strict";
  function activate(link) {
    if (!link) return;
    if (link.getAttribute("rel") === "preload" && link.getAttribute("as") === "style") {
      link.setAttribute("rel", "stylesheet");
      link.removeAttribute("as");
    }
    if (link.media === "print") link.media = "all";
  }
  var nodes = document.querySelectorAll("link[data-tinker-async]");
  for (var i = 0; i < nodes.length; i++) activate(nodes[i]);
})();
