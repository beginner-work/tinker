/* CodeMirror 6 editor for /repo exercise files.
 *
 * Exposes window.tinkerCodeMirror via esbuild IIFE (globalName).
 * Light IDE theme (VS Code Light+ hues) + markdown live-preview
 * decorations (marks stay visible but muted; content renders as preview).
 */
import { EditorState, Compartment, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decoration,
  ViewPlugin,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";

const langOf = new Compartment();
const editableOf = new Compartment();

/**
 * VS Code Light+ / GitHub Light multi-hue tokens.
 * Strings are vivid red (#a31515) — never near-navy / dark gray.
 * Keys/properties blue; numbers/bools green; keywords true blue;
 * types teal; functions brown; comments green italic; punctuation muted.
 */
const tinkerLightHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#008000", fontStyle: "italic" },
  { tag: t.lineComment, color: "#008000", fontStyle: "italic" },
  { tag: t.blockComment, color: "#008000", fontStyle: "italic" },
  { tag: t.docComment, color: "#008000", fontStyle: "italic" },

  { tag: t.keyword, color: "#0000ff" },
  { tag: t.controlKeyword, color: "#af00db" },
  { tag: t.moduleKeyword, color: "#0000ff" },
  { tag: t.operatorKeyword, color: "#0000ff" },
  { tag: t.definitionKeyword, color: "#0000ff" },
  { tag: t.modifier, color: "#0000ff" },
  { tag: t.self, color: "#0000ff" },

  { tag: t.bool, color: "#098658" },
  { tag: t.null, color: "#098658" },
  { tag: t.number, color: "#098658" },
  { tag: t.integer, color: "#098658" },
  { tag: t.float, color: "#098658" },
  { tag: t.atom, color: "#098658" },
  { tag: t.unit, color: "#098658" },

  /* Strings — VS Code Light+ red; must stay distinct from body text. */
  { tag: t.string, color: "#a31515" },
  { tag: t.special(t.string), color: "#a31515" },
  { tag: t.character, color: "#a31515" },
  { tag: t.regexp, color: "#811f3f" },
  { tag: t.escape, color: "#ee0000" },

  /* Keys / properties (YAML, JSON, object keys). */
  { tag: t.propertyName, color: "#0451a5" },
  { tag: t.definition(t.propertyName), color: "#0451a5" },
  { tag: t.attributeName, color: "#0451a5" },
  { tag: t.labelName, color: "#0451a5" },
  { tag: t.meta, color: "#0451a5" },
  { tag: t.processingInstruction, color: "#0451a5" },

  { tag: t.variableName, color: "#001080" },
  { tag: t.definition(t.variableName), color: "#001080" },
  { tag: t.local(t.variableName), color: "#001080" },
  { tag: t.special(t.variableName), color: "#0070c1" },

  { tag: t.function(t.variableName), color: "#795e26" },
  { tag: t.function(t.propertyName), color: "#795e26" },
  { tag: t.definition(t.function(t.variableName)), color: "#795e26" },

  { tag: t.className, color: "#267f99" },
  { tag: t.typeName, color: "#267f99" },
  { tag: t.namespace, color: "#267f99" },
  { tag: t.typeOperator, color: "#0000ff" },

  { tag: t.tagName, color: "#800000" },
  { tag: t.angleBracket, color: "#6a737d" },
  { tag: t.operator, color: "#000000" },
  { tag: t.punctuation, color: "#6a737d" },
  { tag: t.bracket, color: "#6a737d" },
  { tag: t.separator, color: "#6a737d" },
  { tag: t.squareBracket, color: "#6a737d" },
  { tag: t.paren, color: "#6a737d" },
  { tag: t.brace, color: "#6a737d" },

  { tag: t.heading, color: "#000000", fontWeight: "700" },
  { tag: t.heading1, color: "#000000", fontWeight: "700" },
  { tag: t.heading2, color: "#000000", fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.link, color: "#0000ff", textDecoration: "underline" },
  { tag: t.url, color: "#0000ff" },
  { tag: t.monospace, color: "#a31515" },
  { tag: t.contentSeparator, color: "#6a737d" },
  { tag: t.literal, color: "#a31515" },
]);

const tinkerEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "#24292e",
      height: "100%",
      fontSize: "14px",
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "inherit",
      lineHeight: "1.55",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "#24292e",
      padding: "4px 16px 48px 8px",
      minHeight: "100%",
      fontFamily: "inherit",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "#b1aaa2",
      minWidth: "2.4em",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "#6a737d",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(45, 90, 61, 0.05)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(165, 180, 252, 0.35)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#24292e",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(34, 134, 58, 0.15)",
    },

    /* Markdown live-preview: muted syntax marks, styled content. */
    ".cm-md-mark": {
      color: "#b1aaa2 !important",
      fontWeight: "400",
      fontStyle: "normal",
      opacity: "0.7",
      textDecoration: "none",
    },
    ".cm-line.cm-md-heading": {
      fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
      fontWeight: "650",
      color: "#1f2328",
      letterSpacing: "-0.015em",
    },
    /* H1 ~1.6em, H2 ~1.35em, H3 ~1.15em of the prose body. */
    ".cm-line.cm-md-h1": { fontSize: "1.6em", lineHeight: "1.3", fontWeight: "700" },
    ".cm-line.cm-md-h2": { fontSize: "1.35em", lineHeight: "1.35", fontWeight: "650" },
    ".cm-line.cm-md-h3": { fontSize: "1.15em", lineHeight: "1.4", fontWeight: "650" },
    ".cm-line.cm-md-h4": { fontSize: "1.05em", lineHeight: "1.45", fontWeight: "600" },
    ".cm-line.cm-md-h5, .cm-line.cm-md-h6": { fontSize: "1em", lineHeight: "1.5", fontWeight: "600" },
    ".cm-md-strong": { fontWeight: "700" },
    ".cm-md-em": { fontStyle: "italic" },
    ".cm-md-strikethrough": { textDecoration: "line-through", color: "#6a737d" },
    ".cm-md-link": { color: "#0000ff", textDecoration: "underline" },
    ".cm-md-url": { color: "#6a737d", textDecoration: "none", opacity: "0.85" },
    ".cm-md-inline-code": {
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
      backgroundColor: "rgba(175, 184, 193, 0.28)",
      borderRadius: "4px",
      padding: "0.08em 0.35em",
      color: "#a31515",
    },
    ".cm-line.cm-md-quote": {
      color: "#57606a",
      fontStyle: "italic",
      borderLeft: "3px solid rgba(45, 90, 61, 0.4)",
      paddingLeft: "12px",
      marginLeft: "2px",
    },
    ".cm-line.cm-md-list": {
      paddingLeft: "1.35em",
    },
    ".cm-line.cm-md-hr": {
      color: "#b1aaa2",
    },
    ".cm-line.cm-md-codeblock": {
      backgroundColor: "rgba(175, 184, 193, 0.18)",
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace !important',
      fontSize: "0.92em",
      lineHeight: "1.5",
    },
    ".cm-line.cm-md-codeblock-fence": {
      backgroundColor: "rgba(175, 184, 193, 0.22)",
      borderRadius: "0",
    },
    ".cm-line.cm-md-codeblock-open": {
      borderTopLeftRadius: "6px",
      borderTopRightRadius: "6px",
    },
    ".cm-line.cm-md-codeblock-close": {
      borderBottomLeftRadius: "6px",
      borderBottomRightRadius: "6px",
    },

    /* Prose (markdown) uses a softer body font for non-code lines. */
    "&.cm-md-mode .cm-content": {
      fontFamily: "var(--font-sans, 'Instrument Sans', system-ui, sans-serif)",
      fontSize: "17px",
      lineHeight: "1.65",
    },
    "&.cm-md-mode .cm-md-inline-code, &.cm-md-mode .cm-line.cm-md-codeblock": {
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
    },
    "&.cm-md-mode .cm-gutters": {
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: "13px",
    },
  },
  { dark: false },
);

function languageExtension(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  if (ext === "json") return json();
  if (ext === "yaml" || ext === "yml") return yaml();
  if (ext === "ts" || ext === "tsx") return javascript({ typescript: true, jsx: ext === "tsx" });
  if (ext === "js" || ext === "mjs" || ext === "cjs" || ext === "jsx") {
    return javascript({ jsx: ext === "jsx" });
  }
  if (ext === "html" || ext === "htm" || ext === "svg" || ext === "xml") return html();
  if (ext === "md" || ext === "markdown") {
    return [
      markdown({
        base: markdownLanguage,
        codeLanguages: (info) => {
          const id = String(info || "").toLowerCase();
          if (id === "json") return json().language;
          if (id === "yaml" || id === "yml") return yaml().language;
          if (id === "ts" || id === "typescript") return javascript({ typescript: true }).language;
          if (id === "js" || id === "javascript" || id === "mjs" || id === "cjs") {
            return javascript().language;
          }
          if (id === "html" || id === "xml" || id === "svg") return html().language;
          return null;
        },
        addKeymap: true,
      }),
      EditorView.editorAttributes.of({ class: "cm-md-mode" }),
      markdownLivePreview(),
    ];
  }
  return [];
}

/**
 * Hybrid live-preview for markdown: keep mark characters visible (muted)
 * and style the content as a rendered preview would.
 *
 * Uses RangeSetBuilder so decorations stay ordered; overlapping inline
 * marks are skipped instead of wiping the whole set.
 */
function markdownLivePreview() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = this.build(view);
      }
      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }
      build(view) {
        const builder = new RangeSetBuilder();
        const doc = view.state.doc;
        let inFence = false;
        let fenceMark = "";

        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          const text = line.text;
          const fence = /^(```|~~~)(.*)$/.exec(text);

          if (fence) {
            const opening = !inFence;
            if (opening) {
              inFence = true;
              fenceMark = fence[1];
            } else if (fence[1][0] === fenceMark[0]) {
              inFence = false;
              fenceMark = "";
            }
            const lineClass =
              "cm-md-codeblock cm-md-codeblock-fence" +
              (opening ? " cm-md-codeblock-open" : " cm-md-codeblock-close");
            builder.add(line.from, line.from, Decoration.line({ class: lineClass }));
            if (line.to > line.from) {
              builder.add(line.from, line.to, Decoration.mark({ class: "cm-md-mark" }));
            }
            continue;
          }

          if (inFence) {
            builder.add(
              line.from,
              line.from,
              Decoration.line({ class: "cm-md-codeblock" }),
            );
            continue;
          }

          const heading = /^(#{1,6})(\s+)(.*)$/.exec(text);
          if (heading) {
            const level = heading[1].length;
            const markEnd = line.from + heading[1].length + heading[2].length;
            builder.add(
              line.from,
              line.from,
              Decoration.line({ class: `cm-md-heading cm-md-h${level}` }),
            );
            builder.add(line.from, markEnd, Decoration.mark({ class: "cm-md-mark" }));
            addInlineDecorations(builder, markEnd, text.slice(heading[1].length + heading[2].length));
            continue;
          }

          if (/^>\s?/.test(text)) {
            const m = /^(>\s?)/.exec(text);
            builder.add(line.from, line.from, Decoration.line({ class: "cm-md-quote" }));
            builder.add(
              line.from,
              line.from + m[1].length,
              Decoration.mark({ class: "cm-md-mark" }),
            );
            addInlineDecorations(builder, line.from + m[1].length, text.slice(m[1].length));
            continue;
          }

          const list = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/.exec(text);
          if (list) {
            const markLen = list[1].length + list[2].length + list[3].length;
            builder.add(line.from, line.from, Decoration.line({ class: "cm-md-list" }));
            builder.add(
              line.from,
              line.from + markLen,
              Decoration.mark({ class: "cm-md-mark" }),
            );
            addInlineDecorations(builder, line.from + markLen, list[4]);
            continue;
          }

          if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
            builder.add(line.from, line.from, Decoration.line({ class: "cm-md-hr" }));
            if (line.to > line.from) {
              builder.add(line.from, line.to, Decoration.mark({ class: "cm-md-mark" }));
            }
            continue;
          }

          addInlineDecorations(builder, line.from, text);
        }

        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/**
 * Collect non-overlapping inline decorations in document order and add
 * them to the RangeSetBuilder. Later overlapping matches are skipped.
 */
function addInlineDecorations(builder, fromBase, text) {
  if (!text) return;
  const spans = [];

  function pushMark(from, to, cls) {
    if (to <= from) return;
    spans.push({ from, to, cls });
  }

  let m;
  const codeRe = /`([^`\n]+)`/g;
  while ((m = codeRe.exec(text))) {
    const a = fromBase + m.index;
    const b = a + m[0].length;
    pushMark(a, a + 1, "cm-md-mark");
    pushMark(a + 1, b - 1, "cm-md-inline-code");
    pushMark(b - 1, b, "cm-md-mark");
  }

  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((m = linkRe.exec(text))) {
    const a = fromBase + m.index;
    const textStart = a + 1;
    const textEnd = textStart + m[1].length;
    const urlStart = textEnd + 2;
    const urlEnd = urlStart + m[2].length;
    const b = a + m[0].length;
    pushMark(a, textStart, "cm-md-mark");
    pushMark(textStart, textEnd, "cm-md-link");
    pushMark(textEnd, urlStart, "cm-md-mark");
    pushMark(urlStart, urlEnd, "cm-md-url cm-md-mark");
    pushMark(urlEnd, b, "cm-md-mark");
  }

  const boldRe = /(\*\*|__)(?!\s)(.+?)(?!\s)\1/g;
  while ((m = boldRe.exec(text))) {
    const a = fromBase + m.index;
    const markLen = m[1].length;
    const b = a + m[0].length;
    pushMark(a, a + markLen, "cm-md-mark");
    pushMark(a + markLen, b - markLen, "cm-md-strong");
    pushMark(b - markLen, b, "cm-md-mark");
  }

  const emRe = /(^|[^*_])(\*|_)(?!\s|\1)([^*_\n]+?)(?!\s)\2(?!\2)/g;
  while ((m = emRe.exec(text))) {
    const offset = m[1].length;
    const a = fromBase + m.index + offset;
    const b = a + (m[0].length - offset);
    pushMark(a, a + 1, "cm-md-mark");
    pushMark(a + 1, b - 1, "cm-md-em");
    pushMark(b - 1, b, "cm-md-mark");
  }

  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  let cursor = fromBase;
  for (const span of spans) {
    if (span.from < cursor) continue;
    builder.add(span.from, span.to, Decoration.mark({ class: span.cls }));
    cursor = span.to;
  }
}

function baseExtensions(onChange) {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    /* Single theme only — a second default style washes the Light+ hues. */
    syntaxHighlighting(tinkerLightHighlight),
    tinkerEditorTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && typeof onChange === "function") {
        onChange(update.state.doc.toString());
      }
    }),
    EditorView.lineWrapping,
  ];
}

/**
 * Mount a CodeMirror editor into `parent`.
 * @returns {{ setValue, getValue, setFileName, focus, destroy, view }}
 */
function create(parent, opts = {}) {
  if (!parent) throw new Error("repo CM editor: parent required");
  const onChange = opts.onChange || null;
  let fileName = opts.fileName || "file.txt";
  const startDoc = opts.doc == null ? "" : String(opts.doc);

  const state = EditorState.create({
    doc: startDoc,
    extensions: [
      ...baseExtensions(onChange),
      langOf.of(languageExtension(fileName)),
      editableOf.of(EditorView.editable.of(opts.editable !== false)),
    ],
  });

  const view = new EditorView({
    state,
    parent,
  });

  return {
    view,
    getValue() {
      return view.state.doc.toString();
    },
    setValue(text, keepHistory) {
      const next = text == null ? "" : String(text);
      if (next === view.state.doc.toString()) return;
      if (keepHistory) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
        });
      } else {
        view.setState(
          EditorState.create({
            doc: next,
            extensions: [
              ...baseExtensions(onChange),
              langOf.of(languageExtension(fileName)),
              editableOf.of(EditorView.editable.of(true)),
            ],
          }),
        );
      }
    },
    setFileName(name) {
      fileName = name || "file.txt";
      view.dispatch({
        effects: langOf.reconfigure(languageExtension(fileName)),
      });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}

function isMarkdownFile(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  return ext === "md" || ext === "markdown";
}

function languageFor(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "json") return "json";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "mjs" || ext === "cjs" || ext === "jsx") return "javascript";
  if (ext === "html" || ext === "htm" || ext === "xml" || ext === "svg") return "html";
  if (ext === "md" || ext === "markdown") return "markdown";
  return null;
}

export { create, isMarkdownFile, languageFor, languageExtension };
