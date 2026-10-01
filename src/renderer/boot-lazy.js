/* boot-lazy.js — load non-critical first-page modules after the inbox shell
 * can paint. Those scripts used to sit in <script defer> tags and block
 * DOMContentLoaded (and therefore messages-shell boot) until every one of
 * them downloaded and ran. Keeping them out of the critical defer list cuts
 * first meaningful paint on slow networks without removing features.
 *
 * Sources live in <template id="tinker-lazy-scripts"> so tests can still
 * assert the modules are shipped, and so the parser never executes them
 * during the critical path.
 */
(function () {
  "use strict";

  function mark(name) {
    try { performance.mark(name); } catch (e) { /* ignore */ }
  }

  function loadScripts(nodes) {
    var chain = Promise.resolve();
    Array.prototype.forEach.call(nodes, function (node) {
      if (!node || node.tagName !== "SCRIPT") return;
      var src = node.getAttribute("src");
      if (!src) return;
      chain = chain.then(function () {
        return new Promise(function (resolve) {
          var s = document.createElement("script");
          s.src = src;
          s.async = false;
          s.onload = function () { resolve(); };
          s.onerror = function () { resolve(); };
          document.head.appendChild(s);
        });
      });
    });
    return chain;
  }

  function kick() {
    mark("tinker-lazy-start");
    var tpl = document.getElementById("tinker-lazy-scripts");
    if (!tpl) return;
    var nodes = tpl.content ? tpl.content.querySelectorAll("script[src]") : [];
    loadScripts(nodes).then(function () {
      mark("tinker-lazy-done");
      try {
        window.dispatchEvent(new CustomEvent("tinker:lazy-loaded"));
      } catch (e) { /* ignore */ }
    });
  }

  function afterPaint(fn) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        requestAnimationFrame(fn);
      });
      return;
    }
    setTimeout(fn, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { afterPaint(kick); }, { once: true });
  } else {
    afterPaint(kick);
  }
})();
