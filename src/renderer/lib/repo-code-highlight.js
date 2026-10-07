/* Light syntax highlight helper for /repo exercise files.
 *
 * Uses vendored Prism (yaml / js / ts / json / markup). Markdown and unknown
 * prose-like names stay unhighlighted so they can match the essay pad.
 */
(function (root) {
  "use strict";

  var CODE_LANGS = {
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    html: "markup",
    htm: "markup",
    xml: "markup",
    svg: "markup",
  };

  var PROSE_EXTS = {
    md: true,
    markdown: true,
    txt: true,
  };

  function extOf(name) {
    var base = String(name || "").split("/").pop() || "";
    var dot = base.lastIndexOf(".");
    if (dot < 0) return "";
    return base.slice(dot + 1).toLowerCase();
  }

  function isProseFile(name) {
    return !!PROSE_EXTS[extOf(name)];
  }

  function languageFor(name) {
    return CODE_LANGS[extOf(name)] || null;
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function highlight(text, language) {
    var src = text == null ? "" : String(text);
    // Trailing newline keeps the overlay height matched while typing.
    var padded = src.endsWith("\n") ? src + " " : src;
    var Prism = root.Prism;
    if (!language || !Prism || !Prism.languages || !Prism.languages[language] || typeof Prism.highlight !== "function") {
      return escapeHtml(padded);
    }
    try {
      return Prism.highlight(padded, Prism.languages[language], language);
    } catch (err) {
      return escapeHtml(padded);
    }
  }

  function paint(codeEl, text, language) {
    if (!codeEl) return;
    codeEl.innerHTML = highlight(text, language);
    if (language) codeEl.className = "language-" + language;
    else codeEl.className = "";
  }

  root.tinkerRepoCodeHighlight = {
    isProseFile: isProseFile,
    languageFor: languageFor,
    highlight: highlight,
    paint: paint,
    escapeHtml: escapeHtml,
  };
})(typeof window !== "undefined" ? window : globalThis);
