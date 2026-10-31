/* Embed snippet for host pages (e.g. lindowlabs.dev).
 *
 *   <script
 *     src="https://tinker.beginner.work/reading-widget/embed.js"
 *     data-url="https://lindowlabs.dev/essays/your-essay"
 *     data-mode="iframe"
 *     async></script>
 *
 * Modes:
 *   iframe (default) - injects an iframe served from Tinker (same-origin API)
 *   proxy            - requires data-proxy-url; loads widget.js against host proxy
 *
 * Do NOT put TINKER_SERVICE_TOKEN in this page. Prefer iframe mode, or a
 * same-origin proxy on the host that holds the token server-side.
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var nodes = document.getElementsByTagName("script");
      return nodes[nodes.length - 1];
    })();

  function attr(name, fallback) {
    if (!script) return fallback;
    var v = script.getAttribute(name);
    return v == null || v === "" ? fallback : v;
  }

  var src = (script && script.src) || "https://tinker.beginner.work/reading-widget/embed.js";
  var origin;
  try {
    origin = new URL(src).origin;
  } catch {
    origin = "https://tinker.beginner.work";
  }

  var mode = String(attr("data-mode", "iframe")).toLowerCase();
  var articleUrl = attr("data-url", "");
  var height = attr("data-height", "520");
  var proxyUrl = attr("data-proxy-url", "");
  var target = attr("data-target", "");
  var autoplay = attr("data-autoplay", "false") === "true";

  function mountNode() {
    if (target) {
      var el = document.querySelector(target);
      if (el) return el;
    }
    var host = document.createElement("div");
    host.className = "tinker-reading-embed";
    if (script && script.parentNode) {
      script.parentNode.insertBefore(host, script.nextSibling);
    } else {
      document.body.appendChild(host);
    }
    return host;
  }

  function injectIframe(host) {
    var iframe = document.createElement("iframe");
    var q = new URLSearchParams();
    if (articleUrl) q.set("url", articleUrl);
    if (autoplay) q.set("autoplay", "1");
    q.set("embed", "1");
    // Parent hostname for resume SDK-embed metrics (iframe origin is Tinker).
    try {
      if (window.location && window.location.hostname) {
        q.set("embedHost", String(window.location.hostname).toLowerCase());
      }
    } catch (e) { /* ignore */ }
    if (attr("data-owner", "") === "1") q.set("owner", "1");
    iframe.src = origin + "/reading-widget/?" + q.toString();
    iframe.title = "Tinker reading agent";
    iframe.loading = "lazy";
    iframe.allow = "autoplay; microphone";
    iframe.style.cssText =
      "width:100%;max-width:440px;height:" +
      height +
      "px;border:0;border-radius:18px;background:transparent;overflow:hidden;";
    host.appendChild(iframe);
  }

  function injectProxy(host) {
    if (!proxyUrl) {
      host.textContent =
        "Tinker reading embed: data-proxy-url is required for proxy mode.";
      return;
    }
    host.dataset.tinkerReading = "1";
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = origin + "/reading-widget/widget.css";
    document.head.appendChild(css);

    var fonts = document.createElement("link");
    fonts.rel = "stylesheet";
    fonts.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,650&family=Instrument+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(fonts);

    var s = document.createElement("script");
    s.src = origin + "/reading-widget/widget.js";
    s.onload = function () {
      if (!window.TinkerReadingWidget) return;
      var parentHost = "";
      try {
        parentHost = String(window.location.hostname || "").toLowerCase();
      } catch (e) { /* ignore */ }
      window.TinkerReadingWidget.mount(host, {
        url: articleUrl,
        apiBase: proxyUrl.replace(/\/$/, ""),
        autoplay: autoplay,
        embedHost: parentHost,
      });
    };
    document.body.appendChild(s);
  }

  var host = mountNode();
  if (mode === "proxy") injectProxy(host);
  else injectIframe(host);
})();
