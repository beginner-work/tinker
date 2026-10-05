/* Rendered essay read view: Markdown → sanitized HTML, plus an optional
 * "Show questions" toggle for session prompts stored inline in the body.
 *
 * Questions come from the writing session itself:
 *   - `> …` blockquotes (repo pad Keep crafting)
 *   - `### …` ATX headings (interview draftBody re-embed)
 * Positions are the markers in the markdown. If only a detached questions
 * list is provided, fall back to a list above the essay.
 *
 * Browser: expects window.markdownit + window.DOMPurify (vendor scripts).
 * Node tests: require("markdown-it") + require("isomorphic-dompurify").
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("markdown-it"),
      require("isomorphic-dompurify")
    );
  } else {
    root.tinkerEssayRead = factory(root.markdownit, root.DOMPurify);
  }
})(typeof self !== "undefined" ? self : this, function (MarkdownIt, DOMPurify) {
  "use strict";

  var md = null;

  function getMd() {
    if (md) return md;
    var Ctor = MarkdownIt;
    if (typeof Ctor !== "function") {
      throw new Error("markdown-it is required for essay read view");
    }
    md = Ctor({
      html: false,
      linkify: true,
      typographer: false,
      breaks: false,
    });
    md.validateLink = function (url) {
      var u = String(url || "").trim().toLowerCase();
      if (!u) return false;
      if (u.indexOf("javascript:") === 0) return false;
      if (u.indexOf("vbscript:") === 0) return false;
      if (u.indexOf("data:") === 0) return false;
      return true;
    };
    return md;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return (
        {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c] || c
      );
    });
  }

  function sanitize(html) {
    var raw = String(html == null ? "" : html);
    if (!DOMPurify || typeof DOMPurify.sanitize !== "function") {
      // Renderer already runs with html:false; still refuse raw script tags.
      return raw.replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
    }
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button"],
      FORBID_ATTR: [/^on/i, "srcdoc"],
    });
  }

  /** Render a Markdown prose fragment to sanitized HTML. */
  function renderMarkdown(text) {
    var src = String(text == null ? "" : text);
    if (!src.trim()) return "";
    return sanitize(getMd().render(src));
  }

  /**
   * Split markdown into text / question segments.
   * Question lines: `> …` (pad) or `### …` (interview draft embed).
   */
  function parseSegments(markdown) {
    var src = String(markdown == null ? "" : markdown).replace(/\r\n/g, "\n");
    var lines = src.split("\n");
    var segments = [];
    var buf = [];

    function flushText() {
      if (!buf.length) return;
      segments.push({ type: "text", text: buf.join("\n") });
      buf = [];
    }

    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var bq = String(line || "").match(/^>\s+(.+?)\s*$/);
      var h3 = String(line || "").match(/^###\s+(.+?)\s*$/);
      if (bq) {
        flushText();
        segments.push({
          type: "question",
          text: String(bq[1] || "").replace(/\s+/g, " ").trim(),
          source: "blockquote",
        });
        continue;
      }
      if (h3) {
        flushText();
        segments.push({
          type: "question",
          text: String(h3[1] || "").replace(/\s+/g, " ").trim(),
          source: "heading",
        });
        continue;
      }
      buf.push(line);
    }
    flushText();
    if (!segments.length) segments.push({ type: "text", text: "" });
    return segments;
  }

  /** Unique question strings in document order. */
  function extractQuestions(markdown, extra) {
    var seen = Object.create(null);
    var out = [];
    function add(q) {
      var text = String(q || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      var key = text.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(text);
    }
    parseSegments(markdown).forEach(function (seg) {
      if (seg && seg.type === "question") add(seg.text);
    });
    (Array.isArray(extra) ? extra : []).forEach(add);
    return out;
  }

  function questionBlockHtml(question) {
    return (
      '<div class="repo-pad__q essay-read__q" data-essay-q="1">' +
      '<span class="repo-pad__q-text">' +
      escapeHtml(question) +
      "</span></div>"
    );
  }

  function questionsListHtml(questions) {
    var list = Array.isArray(questions) ? questions : [];
    if (!list.length) return "";
    var items = list
      .map(function (q) {
        return "<li>" + escapeHtml(q) + "</li>";
      })
      .join("");
    return '<ul class="essay-read__q-list" aria-label="Session questions">' + items + "</ul>";
  }

  function proseFromSegments(segments) {
    var parts = [];
    (segments || []).forEach(function (seg) {
      if (!seg || seg.type !== "text") return;
      parts.push(String(seg.text == null ? "" : seg.text));
    });
    return parts.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  /**
   * Build essay body HTML.
   * opts: { markdown, showQuestions, questions }
   * `questions` is an optional detached list used only when the body has
   * no inline markers (fallback: list above the essay).
   */
  function renderEssayHtml(opts) {
    opts = opts || {};
    var markdown = opts.markdown == null ? "" : String(opts.markdown);
    var showQuestions = !!opts.showQuestions;
    var segments = parseSegments(markdown);
    var inlineQuestions = segments.filter(function (s) {
      return s && s.type === "question" && s.text;
    });
    var fallback = Array.isArray(opts.questions)
      ? opts.questions
          .map(function (q) {
            return String(q || "").replace(/\s+/g, " ").trim();
          })
          .filter(Boolean)
      : [];

    if (!showQuestions) {
      return '<div class="essay-read__prose">' + renderMarkdown(proseFromSegments(segments)) + "</div>";
    }

    if (inlineQuestions.length) {
      var html = "";
      segments.forEach(function (seg) {
        if (!seg) return;
        if (seg.type === "question") {
          if (seg.text) html += questionBlockHtml(seg.text);
          return;
        }
        var piece = String(seg.text || "");
        if (!piece.trim()) return;
        html += renderMarkdown(piece);
      });
      return '<div class="essay-read__prose">' + html + "</div>";
    }

    // Positions not stored: list questions above the rendered full body.
    var top = fallback.length ? questionsListHtml(fallback) : "";
    return (
      top +
      '<div class="essay-read__prose">' +
      renderMarkdown(markdown) +
      "</div>"
    );
  }

  function hasQuestions(markdown, extra) {
    return extractQuestions(markdown, extra).length > 0;
  }

  /** Toolbar + body shell. Toggle is omitted when there are no questions. */
  function renderShellHtml(opts) {
    opts = opts || {};
    var markdown = opts.markdown == null ? "" : String(opts.markdown);
    var showQuestions = !!opts.showQuestions;
    var questions = extractQuestions(markdown, opts.questions);
    var toggle = "";
    if (questions.length) {
      toggle =
        '<div class="essay-read__toolbar">' +
        '<button type="button" class="essay-read__questions-toggle" ' +
        'aria-pressed="' +
        (showQuestions ? "true" : "false") +
        '">' +
        (showQuestions ? "Hide questions" : "Show questions") +
        "</button></div>";
    }
    return (
      '<div class="essay-read" data-show-questions="' +
      (showQuestions ? "1" : "0") +
      '">' +
      toggle +
      '<div class="essay-read__body">' +
      renderEssayHtml({
        markdown: markdown,
        showQuestions: showQuestions,
        questions: opts.questions,
      }) +
      "</div></div>"
    );
  }

  /**
   * Mount into a DOM node. Returns controls.
   * onToggle(nextBool) is optional.
   */
  function mount(container, opts) {
    if (!container) return null;
    opts = opts || {};
    var state = {
      markdown: opts.markdown == null ? "" : String(opts.markdown),
      showQuestions: !!opts.showQuestions,
      questions: Array.isArray(opts.questions) ? opts.questions.slice() : [],
    };

    function paint() {
      container.innerHTML = renderShellHtml(state);
      var btn = container.querySelector(".essay-read__questions-toggle");
      if (btn) {
        btn.addEventListener("click", function () {
          state.showQuestions = !state.showQuestions;
          paint();
          if (typeof opts.onToggle === "function") opts.onToggle(state.showQuestions);
        });
      }
    }

    paint();
    return {
      setMarkdown: function (mdText, extraQuestions) {
        state.markdown = mdText == null ? "" : String(mdText);
        if (arguments.length > 1) {
          state.questions = Array.isArray(extraQuestions) ? extraQuestions.slice() : [];
        }
        // Fresh essay: toggle always starts off.
        state.showQuestions = false;
        paint();
      },
      setShowQuestions: function (on) {
        state.showQuestions = !!on;
        paint();
      },
      getShowQuestions: function () {
        return !!state.showQuestions;
      },
      hasQuestions: function () {
        return hasQuestions(state.markdown, state.questions);
      },
      destroy: function () {
        container.innerHTML = "";
      },
    };
  }

  return {
    renderMarkdown: renderMarkdown,
    sanitize: sanitize,
    parseSegments: parseSegments,
    extractQuestions: extractQuestions,
    hasQuestions: hasQuestions,
    renderEssayHtml: renderEssayHtml,
    renderShellHtml: renderShellHtml,
    questionBlockHtml: questionBlockHtml,
    mount: mount,
    escapeHtml: escapeHtml,
  };
});
