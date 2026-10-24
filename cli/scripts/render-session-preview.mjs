#!/usr/bin/env node
/**
 * Render a sample coach session as HTML (ANSI → spans) for before/after
 * screenshots. Not shipped in the npm package.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTheme } = require("../lib/theme.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SESSION = [
  { role: "shell", text: "$ tinker" },
  { role: "question", text: "What are you learning about how this work moves?" },
  {
    role: "answer",
    text: "It only moves when I ship the smallest cut and leave the rest alone.",
  },
  { role: "question", text: "What are you noticing that you did not expect?" },
  {
    role: "answer",
    text: "Silence after a ship is useful. I kept filling it with more scope.",
  },
  {
    role: "question",
    text: "What are you discovering in the part you keep returning to?",
  },
  { role: "answer", text: "this is everything" },
  { role: "success", text: "Saved to Notion." },
];

function ansiToHtml(text) {
  const ESC = "\u001b";
  let i = 0;
  let html = "";
  let open = false;
  const styles = { color: null, bold: false, dim: false };

  function flushOpen() {
    if (!open) return;
    html += "</span>";
    open = false;
  }

  function openSpan() {
    flushOpen();
    const parts = [];
    if (styles.color) parts.push(`color:${styles.color}`);
    if (styles.bold) parts.push("font-weight:700");
    if (styles.dim) parts.push("opacity:0.85");
    if (!parts.length) return;
    html += `<span style="${parts.join(";")}">`;
    open = true;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  while (i < text.length) {
    if (text[i] === ESC && text[i + 1] === "[") {
      const end = text.indexOf("m", i + 2);
      if (end === -1) {
        html += escapeHtml(text[i]);
        i += 1;
        continue;
      }
      const params = text.slice(i + 2, end).split(";").map(Number);
      i = end + 1;
      if (params.length === 1 && params[0] === 0) {
        flushOpen();
        styles.color = null;
        styles.bold = false;
        styles.dim = false;
        continue;
      }
      let p = 0;
      while (p < params.length) {
        const code = params[p];
        if (code === 1) {
          styles.bold = true;
          p += 1;
        } else if (code === 2) {
          styles.dim = true;
          p += 1;
        } else if (code === 22) {
          styles.bold = false;
          styles.dim = false;
          p += 1;
        } else if (code === 38 && params[p + 1] === 2) {
          const r = params[p + 2];
          const g = params[p + 3];
          const b = params[p + 4];
          styles.color = `rgb(${r},${g},${b})`;
          p += 5;
        } else if (code === 38 && params[p + 1] === 5) {
          styles.color = `var(--c256-${params[p + 2]}, #ccc)`;
          p += 3;
        } else if (code >= 30 && code <= 37) {
          const map = [
            "#000",
            "#b42318",
            "#2d5a3d",
            "#a16207",
            "#1d4ed8",
            "#6366f1",
            "#0e7490",
            "#e5e5e5",
          ];
          styles.color = map[code - 30];
          p += 1;
        } else if (code >= 90 && code <= 97) {
          styles.color = "#6f6a65";
          p += 1;
        } else {
          p += 1;
        }
      }
      openSpan();
      continue;
    }
    // Strip readline hide markers if present
    if (text[i] === "\x01" || text[i] === "\x02") {
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] !== ESC && text[j] !== "\x01" && text[j] !== "\x02") {
      j += 1;
    }
    html += escapeHtml(text.slice(i, j));
    i = j;
  }
  flushOpen();
  return html;
}

function renderSession(level) {
  const theme = createTheme({ level });
  const lines = [];
  for (const row of SESSION) {
    if (row.role === "shell") {
      lines.push(theme.muted(row.text));
    } else if (row.role === "question") {
      lines.push(theme.question(row.text));
    } else if (row.role === "answer") {
      // prompt opens body color so typed answers match .writing-input
      if (theme.enabled) {
        const prompt = theme.prompt("> ").replace(/\x01|\x02/g, "");
        lines.push(prompt + row.text + theme.reset);
      } else {
        lines.push("> " + row.text);
      }
    } else if (row.role === "success") {
      lines.push(theme.success(row.text));
    }
  }
  return lines.join("\n");
}

function pageHtml(title, ansiText, label) {
  const body = ansiToHtml(ansiText).replace(/\n/g, "<br>\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  html, body {
    margin: 0;
    background: #1e1e1e;
    color: #d4d4d4;
    font-family: "SF Mono", "Menlo", "Consolas", "Liberation Mono", monospace;
    font-size: 14px;
    line-height: 1.55;
  }
  .label {
    padding: 10px 16px 0;
    color: #9ca3af;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .term {
    margin: 8px 16px 16px;
    padding: 16px 18px;
    background: #fffdf7;
    border-radius: 10px;
    min-height: 220px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.35);
    color: #2d2a26;
  }
</style>
</head>
<body>
  <div class="label">${label}</div>
  <div class="term">${body}</div>
</body>
</html>`;
}

const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "../examples/preview");

fs.mkdirSync(outDir, { recursive: true });

const beforeAnsi = renderSession(0);
const afterAnsi = renderSession(3);

fs.writeFileSync(path.join(outDir, "before.html"), pageHtml("before", beforeAnsi, "Before — plain (NO_COLOR / non-TTY)"));
fs.writeFileSync(path.join(outDir, "after.html"), pageHtml("after", afterAnsi, "After — bold questions in accent purple"));
fs.writeFileSync(path.join(outDir, "before.txt"), beforeAnsi + "\n");
fs.writeFileSync(path.join(outDir, "after.txt"), afterAnsi + "\n");

console.log("Wrote preview HTML to", outDir);
