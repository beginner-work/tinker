/* CodeMirror 6 editor for /repo exercise files.
 *
 * Exposes window.tinkerCodeMirror via esbuild IIFE (globalName).
 * Light IDE theme + markdown live-preview decorations (marks stay
 * visible but muted; content renders as preview).
 */
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decration,
  ViewPlugin,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
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

/** VS Code Light+ / GitHub-light inspired tokens on a transparent surface. */
const tinkerLightHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#6a737d", fontStyle: "italic" },
  { tag: t.lineComment, color: "#6a737d", fontStyle: "italic" },
  { tag: t.blockComment, color: "#6a737d", fontStyle: "italic" },
  { tag: t.docComment, color: "#6a737d", fontStyle: "italic" },
  { tag: t.keyword, color: "#d73a49" },
  { tag: t.controlKeyword, color: "#d73a49" },
  { tag: t.moduleKeyword, color: "#d73a49" },
  { tag: t.operatorKeyword, color: "#d73a49" },
  { tag: t.definitionKeyword, color: "#d73a49" },
  { tag: t.bool, color: "#005cc5" },
  { tag: t.null, color: "#005cc5" },
  { tag: t.number, color: "#005cc5" },
  { tag: t.string, color: "#032f62" },
  { tag: t.special(t.string), color: "#032f62" },
  { tag: t.character, color: "#032f62" },
  { tag: t.regexp, color: "#032f62" },
  { tag: t.escape, color: "#e36209" },
  { tag: t.propertyName, color: "#005cc5" },
  { tag: t.attributeName, color: "#005cc5" },
  { tag: t.variableName, color: "#e36209" },
  { tag: t.definition(t.variableName), color: "#6f42c1" },
  { tag: t.function(t.variableName), color: "#6f42c1" },
  { tag: t.function(t.propertyName), color: "#6f42c1" },
  { tag: t.className, color: "#6f42c1" },
  { tag: t.typeName, color: "#6f42c1" },
  { tag: t.namespace, color: "#6f42c1" },
  { tag: t.tagName, color: "#22863a" },
  { tag: t.angleBracket, color: "#24292e" },
  { tag: t.operator, color: "#d73a49" },
  { tag: t.punctuation, color: "#24292e" },
  { tag: t.bracket, color: "#24292e" },
  { tag: t.meta, color: "#005cc5" },
  { tag: t.heading, color: "#005cc5", fontWeight: "700" },
  { tag: t.heading1, color: "#005cc5", fontWeight: "700" },
  { tag: t.heading2, color: "#005cc5", fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.link, color: "#0366d6", textDecoration: "underline" },
  { tag: t.url, color: "#032f62" },
  { tag: t.monospace, color: "#24292e" },
  { tag: t.contentSeparator, color: "#d73a49" },
  { tag: t.labelName, color: "#005cc5" },
  { tag: t.atom, color: "#005cc5" },
  { tag: t.unit, color: "#005cc5" },
  { tag: t.processingInstruction, color: "#005cc5" },
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
      color: "#b1aaa2",
      fontWeight: "400",
      fontStyle: "normal",
      opacity: "0.72",
    },
    ".cm-md-heading": {
      fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
      fontWeight: "650",
      color: "#1f2328",
      letterSpacing: "-0.01em",
    },
    ".cm-md-h1": { fontSize: "1.85em", lineHeight: "1.3" },
    ".cm-md-h2": { fontSize: "1.5em", lineHeight: "1.35" },
    ".cm-md-h3": { fontSize: "1.28em", lineHeight: "1.4" },
    ".cm-md-h4": { fontSize: "1.12em", lineHeight: "1.45" },
    ".cm-md-h5, .cm-md-h6": { fontSize: "1.02em", lineHeight: "1.5" },
    ".cm-md-strong": { fontWeight: "700" },
    ".cm-md-em": { fontStyle: "italic" },
    ".cm-md-strikethrough": { textDecoration: "line-through", color: "#6a737d" },
    ".cm-md-link": { color: "#0366d6", textDecoration: "underline" },
    ".cm-md-url": { color: "#032f62", textDecoration: "none", opacity: "0.85" },
    ".cm-md-inline-code": {
      fontFamily: "inherit",
      backgroundColor: "rgba(175, 184, 193, 0.22)",
      borderRadius: "4px",
      padding: "0.1em 0.35em",
      color: "#24292e",
    },
    ".cm-md-quote": {
      color: "#57606a",
      fontStyle: "italic",
      borderLeft: "3px solid rgba(45, 90, 61, 0.35)",
      paddingLeft: "10px",
    },
    ".cm-md-list": {
      paddingLeft: "0.25em",
    },
    ".cm-md-hr": {
      color: "#b1aaa2",
    },
    ".cm-md-codeblock": {
      backgroundColor: "rgba(175, 184, 193, 0.14)",
      borderRadius: "6px",
    },
    /* Prose (markdown) uses a softer body font for non-code lines. */
    "&.cm-md-mode .cm-content": {
      fontFamily: "var(--font-sans, 'Instrument Sans', system-ui, sans-serif)",
      fontSize: "17px",
      lineHeight: "1.65",
    },
    "&.cm-md-mode .cm-md-inline-code, &.cm-md-mode .cm-md-codeblock, &.cm-md-mode .cm-monospace": {
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: "0.92em",
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
  // Unknown: plain text, still editable with light theme.
  return [];
}

/**
 * Hybrid live-preview for markdown: keep mark characters visible (muted)
 * and style the content as a rendered preview would.
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
        const widgets = [];
        const doc = view.state.doc;
        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          const text = line.text;
          // ATX headings: # … ######
          const heading = /^(#{1,6})(\s+)(.*)$/.exec(text);
          if (heading) {
            const level = heading[1].length;
            const markEnd = line.from + heading[1].length + heading[2].length;
            widgets.push(
              Decoration.mark({ class: "cm-md-mark" }).range(line.from, markEnd),
            );
            widgets.push(
              Decoration.line({
                class: `cm-md-heading cm-md-h${level}`,
              }).range(line.from),
            );
            continue;
          }
          // Blockquote
          if (/^>\s?/.test(text)) {
            const m = /^(>\s?)/.exec(text);
            widgets.push(
              Decoration.mark({ class: "cm-md-mark" }).range(line.from, line.from + m[1].length),
            );
            widgets.push(Decoration.line({ class: "cm-md-quote" }).range(line.from));
            // still decorate inline marks on the remainder
            decorateInline(widgets, line.from + m[1].length, text.slice(m[1].length), line.from);
            continue;
          }
          // Unordered / ordered list
          const list = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/.exec(text);
          if (list) {
            const markLen = list[1].length + list[2].length + list[3].length;
            widgets.push(
              Decctions.mark({ class: "cm-md-mark" }).range(line.from, line.from + markLen),
            );
            widgets.push(Decoration.line({ class: "cm-md-list" }).range(line.from));
            decorateInline(widgets, line.from + markLen, list[4], line.from);
            continue;
          }
          // Horizontal rule
          if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
            widgets.push(Decoration.line({ class: "cm-md-hr" }).range(line.from));
            widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(line.from, line.to));
            continue;
          }
          // Fenced code fence lines
          if (/^(`{3,}|~{3,})/.test(text)) {
            widgets.push(Decoration.line({ class: "cm-md-codeblock" }).range(line.from));
            widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(line.from, line.to));
            continue;
          }
          decorateInline(widgets, line.from, text, line.from);
        }
        try {
          return Decoration.set(widgets, true);
        } catch (err) {
          // Overlapping inline marks from mixed bold/italic/code are non-fatal.
          return Decoration.none;
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function decorateInline(widgets, fromBase, text, _lineFrom) {
  // Inline code `…`
  const codeRe = /`([^`\n]+)`/g;
  let m;
  while ((m = codeRe.exec(text))) {
    const a = fromBase + m.index;
    const b = a + m[0].length;
    widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(a, a + 1));
    widgets.push(Decoration.mark({ class: "cm-md-inline-code" }).range(a + 1, b - 1));
    widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(b - 1, b));
  }
  // Links [text](url)
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((m = linkRe.exec(text))) {
    const a = fromBase + m.index;
    const textStart = a + 1;
    const textEnd = textStart + m[1].length;
    const urlStart = textEnd + 2;
    const urlEnd = urlStart + m[2].length;
    const b = a + m[0].length;
    widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(a, textStart));
    widgets.push(Decoration.mark({ class: "cm-md-link" }).range(textStart, textEnd));
    widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(textEnd, urlStart));
    widgets.push(Decoration.mark({ class: "cm-md-url cm-md-mark" }).range(urlStart, urlEnd));
    widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(urlEnd, b));
  }
  // Bold **…** or __…__
  const boldRe = /(\*\*|__)(?!\s)([\s\S]+?)(?!\s)\1/g;
  while ((m = boldRe.exec(text))) {
    // skip if inside a code span roughly
    const a = fromBase + m.index;
    const markLen = m[1].length;
    const b = a + m[0].length;
    widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(a, a + markLen));
    widgets.push(Decoration.mark({ class: "cm-md-strong" }).range(a + markLen, b - markLen));
    widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(b - markLen, b));
  }
  // Italic *…* or _…_ (single)
  const emRe = /(^|[^*_])(\*|_)(?!\s)([^*_\n]+?)(?!\s)\2(?!\2)/g;
  while ((m = emRe.exec(text))) {
    const offset = m[1].length;
    const a = fromBase + m.index + offset;
    const b = a + m[0].length - offset;
    widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(a, a + 1));
    widgets.push(Decoration.mark({ class: "cm-md-em" }).range(a + 1, b - 1));
    widgets.push(Decoration.mark({ class: "cm-md-mark" }).range(b - 1, b));
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
    syntaxHighlighting(tinkerLightHighlight, { fallback: true }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
