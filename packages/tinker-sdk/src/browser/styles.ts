/** Injected once per page for the floating Ask pill. */

export const ASK_PILL_CSS = `
.tinker-ask {
  --tinker-ask-fg: #1a1a1a;
  --tinker-ask-bg: #ffffff;
  --tinker-ask-muted: #6b6b6b;
  --tinker-ask-border: rgba(0,0,0,0.12);
  --tinker-ask-accent: #1a1a1a;
  position: fixed;
  z-index: 2147483000;
  right: 20px;
  bottom: 20px;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: var(--tinker-ask-fg);
  pointer-events: none;
}
.tinker-ask * { box-sizing: border-box; }
.tinker-ask__pill,
.tinker-ask__panel {
  pointer-events: auto;
}
.tinker-ask__pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--tinker-ask-border);
  background: var(--tinker-ask-bg);
  color: var(--tinker-ask-fg);
  border-radius: 999px;
  padding: 10px 14px 10px 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.12);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}
.tinker-ask__pill:hover { filter: brightness(0.98); }
.tinker-ask__pill:focus-visible {
  outline: 2px solid var(--tinker-ask-accent);
  outline-offset: 2px;
}
.tinker-ask__pill-logo {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
}
.tinker-ask__pill-logo svg { width: 28px; height: 28px; display: block; }
.tinker-ask__panel {
  display: none;
  width: min(360px, calc(100vw - 32px));
  margin-bottom: 12px;
  border: 1px solid var(--tinker-ask-border);
  background: var(--tinker-ask-bg);
  border-radius: 16px;
  box-shadow: 0 16px 40px rgba(0,0,0,0.16);
  padding: 14px;
  flex-direction: column;
  gap: 10px;
}
.tinker-ask--open .tinker-ask__panel { display: flex; }
.tinker-ask--open .tinker-ask__pill { display: none; }
.tinker-ask__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tinker-ask__title {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.01em;
}
.tinker-ask__close {
  border: 0;
  background: transparent;
  color: var(--tinker-ask-muted);
  cursor: pointer;
  font: inherit;
  padding: 4px 6px;
}
.tinker-ask__modes {
  display: flex;
  gap: 6px;
}
.tinker-ask__mode {
  border: 1px solid var(--tinker-ask-border);
  background: transparent;
  border-radius: 999px;
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  color: var(--tinker-ask-muted);
}
.tinker-ask__mode[aria-pressed="true"] {
  color: var(--tinker-ask-fg);
  border-color: var(--tinker-ask-fg);
  font-weight: 600;
}
.tinker-ask__transcript {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  border: 1px solid var(--tinker-ask-border);
  border-radius: 10px;
  padding: 10px;
  font: inherit;
  color: var(--tinker-ask-fg);
  background: #fafafa;
}
.tinker-ask__transcript:focus {
  outline: 2px solid var(--tinker-ask-accent);
  outline-offset: 1px;
  background: #fff;
}
.tinker-ask__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tinker-ask__btn {
  border: 1px solid var(--tinker-ask-border);
  background: #fff;
  color: var(--tinker-ask-fg);
  border-radius: 999px;
  padding: 8px 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.tinker-ask__btn--primary {
  background: var(--tinker-ask-fg);
  color: #fff;
  border-color: var(--tinker-ask-fg);
}
.tinker-ask__btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.tinker-ask__status {
  margin: 0;
  min-height: 1.2em;
  color: var(--tinker-ask-muted);
  font-size: 12px;
}
.tinker-ask__answer {
  margin: 0;
  white-space: pre-wrap;
  font-size: 13px;
}
@media (max-width: 480px) {
  .tinker-ask { right: 12px; bottom: 12px; }
}
`;

let injected = false;

export function ensureAskPillStyles(doc: Document = document): void {
  if (injected) return;
  if (typeof doc === "undefined") return;
  if (doc.getElementById("tinker-ask-styles")) {
    injected = true;
    return;
  }
  const style = doc.createElement("style");
  style.id = "tinker-ask-styles";
  style.textContent = ASK_PILL_CSS;
  (doc.head || doc.documentElement).appendChild(style);
  injected = true;
}

/** Test helper. */
export function __resetAskPillStylesForTests(): void {
  injected = false;
}
